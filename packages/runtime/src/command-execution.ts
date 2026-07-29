import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import {
  runSandboxedProcess,
  type SandboxedProcessResult,
} from "./sandboxed-process.js";

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_CHARS = 2_048;
const MAX_TOTAL_ARGUMENT_CHARS = 16_384;
export const MAX_COMMAND_OUTPUT_CHARS = 32_000;
const ARGUMENT_PATTERN = "^[^\\u0000-\\u001f\\u007f]*$";

const commandSchema = Type.Object(
  {
    runtime: Type.Literal("node"),
    args: Type.Array(
      Type.String({
        maxLength: MAX_ARGUMENT_CHARS,
        pattern: ARGUMENT_PATTERN,
        description:
          "One literal argv item. Shell syntax, interpolation, and environment expansion are not evaluated.",
      }),
      {
        maxItems: MAX_ARGUMENTS,
        description:
          "Explicit argv passed directly to the selected runtime without a shell command string.",
      },
    ),
    cwd: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: ARGUMENT_PATTERN,
        description:
          "Workspace-relative working directory. Defaults to the workspace root.",
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: MIN_TIMEOUT_MS,
        maximum: MAX_TIMEOUT_MS,
        description: "Wall-time budget in milliseconds.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type CommandRuntime = "node";

export interface CommandExecutionRequest {
  runtime: CommandRuntime;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export type CommandExecutionStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped";

export interface CommandExecutionDetails {
  runtime: CommandRuntime;
  status: CommandExecutionStatus;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  cwdPathSha256: string;
  executablePathSha256: string;
  executableSha256: string;
  argumentCount: number;
  argumentSetSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  outputLimitChars: number;
  commandSha256: string;
  resultSha256: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutChars: number;
  stderrChars: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface CommandExecutionResult {
  details: CommandExecutionDetails;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  executables?: Partial<Record<CommandRuntime, string>>;
}

export interface PreparedCommandExecution {
  runtime: CommandRuntime;
  sandboxId: string;
  args: string[];
  workspaceRoot: string;
  cwd: string;
  executable: string;
  executableSha256: string;
  timeoutMs: number;
  launch: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    workspaceRoot: string;
    approvedCapabilities: ["process.spawn", "workspace.read"];
  };
  receipt: {
    runtime: CommandRuntime;
    cwdPathSha256: string;
    executablePathSha256: string;
    executableSha256: string;
    argumentCount: number;
    argumentSetSha256: string;
    environmentSha256: string;
    resourceLimitsSha256: string;
    timeoutMs: number;
    outputLimitChars: number;
    workspaceAccess: "read_only";
    networkAccess: "denied";
  };
}

const FIXED_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
} as const;

export class CommandRunner {
  constructor(private readonly options: CommandRunnerOptions) {}

  async run(
    input: CommandExecutionRequest,
    signal?: AbortSignal,
  ): Promise<CommandExecutionResult> {
    const prepared = await prepareCommandExecution(this.options, input);
    const execution = await runSandboxedProcess({
      sandbox: this.options.sandbox,
      launch: prepared.launch,
      timeoutMs: prepared.timeoutMs,
      maxOutputChars: MAX_COMMAND_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "command execution was aborted",
    });
    await assertCommandRuntimeStable(prepared);
    return finalizeCommandExecution(prepared, execution);
  }
}

export async function prepareCommandExecution(
  options: CommandRunnerOptions,
  input: CommandExecutionRequest,
): Promise<PreparedCommandExecution> {
  validateCommandRequest(input);
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const cwd = await resolveWorkspaceDirectory(workspaceRoot, input.cwd ?? ".");
  const cwdPath = path.relative(workspaceRoot, cwd) || ".";
  const executable = await resolveExecutable(
    input.runtime,
    options.executables,
  );
  const executableSha256 = await sha256File(executable);
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const resourceLimits = {
    wallTimeMs: timeoutMs,
    outputCharsPerStream: MAX_COMMAND_OUTPUT_CHARS,
    processGroupTermination: true,
    cpuLimit: "sandbox_backend_default",
    memoryLimit: "sandbox_backend_default",
  };
  const receipt = {
    runtime: input.runtime,
    cwdPathSha256: sha256(cwdPath),
    executablePathSha256: sha256(executable),
    executableSha256,
    argumentCount: input.args.length,
    argumentSetSha256: sha256(canonicalJson(input.args)),
    environmentSha256: sha256(canonicalJson(FIXED_ENVIRONMENT)),
    resourceLimitsSha256: sha256(canonicalJson(resourceLimits)),
    timeoutMs,
    outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
    workspaceAccess: "read_only" as const,
    networkAccess: "denied" as const,
  };
  if (options.sandbox.id === "oci-container") {
    throw new Error(
      "run_command requires a local OS sandbox until container runtime identity binding is available",
    );
  }
  return {
    runtime: input.runtime,
    sandboxId: options.sandbox.id,
    args: [...input.args],
    workspaceRoot,
    cwd,
    executable,
    executableSha256,
    timeoutMs,
    launch: {
      command: executable,
      args: [...input.args],
      cwd,
      env: { ...FIXED_ENVIRONMENT },
      workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
    },
    receipt,
  };
}

export async function assertCommandRuntimeStable(
  prepared: PreparedCommandExecution,
): Promise<void> {
  if ((await sha256File(prepared.executable)) !== prepared.executableSha256) {
    throw new Error("command runtime changed during execution");
  }
}

export function finalizeCommandExecution(
  prepared: PreparedCommandExecution,
  execution: SandboxedProcessResult,
): CommandExecutionResult {
  const status: CommandExecutionStatus =
    execution.status === "exited"
      ? execution.exitCode === 0
        ? "succeeded"
        : "failed"
      : execution.status;
  const stdoutSha256 = sha256(execution.stdout);
  const stderrSha256 = sha256(execution.stderr);
  const resultSha256 = sha256(
    canonicalJson({
      status,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdoutSha256,
      stderrSha256,
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    }),
  );
  return {
    details: {
      runtime: prepared.runtime,
      status,
      sandbox: prepared.sandboxId,
      workspaceAccess: "read_only",
      networkAccess: "denied",
      cwdPathSha256: prepared.receipt.cwdPathSha256,
      executablePathSha256: prepared.receipt.executablePathSha256,
      executableSha256: prepared.executableSha256,
      argumentCount: prepared.receipt.argumentCount,
      argumentSetSha256: prepared.receipt.argumentSetSha256,
      environmentSha256: prepared.receipt.environmentSha256,
      resourceLimitsSha256: prepared.receipt.resourceLimitsSha256,
      timeoutMs: prepared.timeoutMs,
      outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
      commandSha256: sha256(canonicalJson(prepared.receipt)),
      resultSha256,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdoutChars: execution.stdout.length,
      stderrChars: execution.stderr.length,
      stdoutSha256,
      stderrSha256,
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    },
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

export function createCommandTool(
  options: CommandRunnerOptions,
): AgentTool<typeof commandSchema, CommandExecutionDetails> {
  const runner = new CommandRunner(options);
  return {
    name: "run_command",
    label: "Run command",
    description:
      "Run Node with explicit argv in a bounded OS sandbox. The workspace is read-only, network and inherited environment access are denied, output and wall time are capped, and no user-provided shell command string is evaluated.",
    parameters: commandSchema,
    async execute(_toolCallId, input, signal) {
      const result = await runner.run(input, signal);
      return {
        content: [
          {
            type: "text",
            text: formatCommandResult(result),
          },
        ],
        details: result.details,
      };
    },
  };
}

export function commandToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;
  const runtime =
    record?.["runtime"] === "node" ? record["runtime"] : "unknown";
  const argumentCount = Array.isArray(record?.["args"])
    ? record["args"].length
    : 0;
  const cwd = typeof record?.["cwd"] === "string" ? record["cwd"] : ".";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    runtime,
    argumentCount,
    cwdPathSha256: sha256(cwd),
    inputSha256: commandCallSha256(args),
  };
}

export function commandToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: commandCallSha256(args),
    inputRedacted: true,
  };
}

export function commandToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    result &&
    typeof result === "object" &&
    "details" in result &&
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : undefined;
  const resultSha256 =
    typeof details?.["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
      ? details["resultSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
  };
}

function commandCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "run_command", args }));
}

function validateCommandRequest(input: CommandExecutionRequest): void {
  if (input.runtime !== "node") {
    throw new Error(`Unsupported command runtime: ${String(input.runtime)}`);
  }
  if (
    !Array.isArray(input.args) ||
    input.args.length > MAX_ARGUMENTS ||
    input.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length > MAX_ARGUMENT_CHARS ||
        /[\u0000-\u001f\u007f]/u.test(argument),
    ) ||
    input.args.reduce((total, argument) => total + argument.length, 0) >
      MAX_TOTAL_ARGUMENT_CHARS
  ) {
    throw new Error("command args exceed the bounded explicit argv contract");
  }
  if (
    input.cwd !== undefined &&
    (!input.cwd ||
      path.isAbsolute(input.cwd) ||
      input.cwd.length > 500 ||
      /[\u0000-\u001f\u007f]/u.test(input.cwd))
  ) {
    throw new Error("command cwd must be workspace-relative");
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < MIN_TIMEOUT_MS ||
      input.timeoutMs > MAX_TIMEOUT_MS)
  ) {
    throw new Error(
      `command timeoutMs must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`,
    );
  }
}

async function resolveWorkspaceDirectory(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  const lexical = path.resolve(workspaceRoot, candidate);
  if (!isPathInside(lexical, workspaceRoot)) {
    throw new Error("command cwd escapes the workspace");
  }
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(`command cwd does not exist: ${candidate}`);
    }
    throw error;
  }
  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error("command cwd resolves outside the workspace");
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error("command cwd must be a directory");
  }
  return resolved;
}

async function resolveExecutable(
  runtime: CommandRuntime,
  overrides: CommandRunnerOptions["executables"],
): Promise<string> {
  const candidate = overrides?.[runtime] ?? process.execPath;
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${runtime} executable must use an absolute path`);
  }
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    throw new Error(`${runtime} runtime is unavailable`);
  }
  const resolved = await realpath(candidate);
  if (!(await stat(resolved)).isFile()) {
    throw new Error(`${runtime} runtime must be an executable file`);
  }
  return resolved;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

function formatCommandResult(result: CommandExecutionResult): string {
  const { details } = result;
  return [
    `Command ${details.status.toUpperCase()}: ${details.runtime}`,
    `Sandbox: ${details.sandbox}`,
    "Workspace: read-only",
    "Network: denied",
    `Command SHA-256: ${details.commandSha256}`,
    `Arguments: ${details.argumentCount} / ${details.argumentSetSha256}`,
    `Executable SHA-256: ${details.executableSha256}`,
    `Exit: ${String(details.exitCode)} / ${String(details.signal)}`,
    `Duration: ${details.durationMs} ms`,
    `stdout SHA-256: ${details.stdoutSha256}`,
    `stderr SHA-256: ${details.stderrSha256}`,
    "",
    "STDOUT",
    result.stdout || "(empty)",
    "",
    "STDERR",
    result.stderr || "(empty)",
  ].join("\n");
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
