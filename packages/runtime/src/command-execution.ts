import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
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
const MAX_RUNTIME_ASSET_FILES = 128;
const MACOS_PYTHON_CANDIDATES = [
  "/Library/Developer/CommandLineTools/usr/bin/python3",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/python3",
] as const;
const UNIX_PYTHON_EXECUTABLE = "/usr/bin/python3";
const PYTHON_RUNTIME_REQUIRED_ASSETS = [
  "ast.py",
  "base64.py",
  "contextlib.py",
  "enum.py",
  "functools.py",
  "io.py",
  "json/__init__.py",
  "json/decoder.py",
  "json/encoder.py",
  "json/scanner.py",
  "operator.py",
  "os.py",
  "signal.py",
  "threading.py",
  "tracemalloc.py",
  "types.py",
] as const;
const PYTHON_RUNTIME_OPTIONAL_ASSETS = [
  "_bootlocale.py",
  "_collections_abc.py",
  "_compat_pickle.py",
  "_py_abc.py",
  "_weakrefset.py",
  "abc.py",
  "codecs.py",
  "collections/__init__.py",
  "collections/abc.py",
  "copyreg.py",
  "encodings/__init__.py",
  "encodings/aliases.py",
  "encodings/ascii.py",
  "encodings/cp437.py",
  "encodings/latin_1.py",
  "encodings/utf_16_le.py",
  "encodings/utf_8.py",
  "fnmatch.py",
  "genericpath.py",
  "heapq.py",
  "keyword.py",
  "linecache.py",
  "pickle.py",
  "posixpath.py",
  "re.py",
  "re/__init__.py",
  "re/_casefix.py",
  "re/_compiler.py",
  "re/_constants.py",
  "re/_parser.py",
  "reprlib.py",
  "sre_compile.py",
  "sre_constants.py",
  "sre_parse.py",
  "stat.py",
  "struct.py",
  "token.py",
  "tokenize.py",
  "traceback.py",
  "warnings.py",
  "weakref.py",
] as const;
const PYTHON_RUNTIME_EXTENSION_PREFIXES = [
  "_heapq.",
  "_json.",
  "_pickle.",
  "_struct.",
  "binascii.",
  "resource.",
  "zlib.",
] as const;

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

export type CommandRuntime = "node" | "python";

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
  runtimeAssetSetSha256?: string;
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
  runtimeAssets: CommandRuntimeAsset[];
  timeoutMs: number;
  launch: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    workspaceRoot: string;
    approvedCapabilities: ["process.spawn", "workspace.read"];
    runtimeReadPaths?: string[];
  };
  receipt: {
    runtime: CommandRuntime;
    cwdPathSha256: string;
    executablePathSha256: string;
    executableSha256: string;
    argumentCount: number;
    argumentSetSha256: string;
    environmentSha256: string;
    runtimeAssetSetSha256?: string;
    resourceLimitsSha256: string;
    timeoutMs: number;
    outputLimitChars: number;
    workspaceAccess: "read_only";
    networkAccess: "denied";
  };
}

export interface CommandRuntimeAsset {
  path: string;
  sha256: string;
}

interface CommandRuntimeBinding {
  executable: string;
  executableSha256: string;
  runtimeReadPaths: string[];
  runtimeAssets: CommandRuntimeAsset[];
  runtimeAssetSetSha256?: string;
}

const FIXED_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
} as const;
const FIXED_PYTHON_ENVIRONMENT = {
  ...FIXED_ENVIRONMENT,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONHASHSEED: "0",
  PYTHONNOUSERSITE: "1",
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
  const binding = await resolveRuntimeBinding(
    input.runtime,
    options.executables,
  );
  const environment =
    input.runtime === "python" ? FIXED_PYTHON_ENVIRONMENT : FIXED_ENVIRONMENT;
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const resourceLimits = {
    wallTimeMs: timeoutMs,
    outputCharsPerStream: MAX_COMMAND_OUTPUT_CHARS,
    processGroupTermination: true,
    cpuLimit: "sandbox_backend_default",
    memoryLimit: "sandbox_backend_default",
    runtimeAssetCount: binding.runtimeAssets.length,
  };
  const receipt = {
    runtime: input.runtime,
    cwdPathSha256: sha256(cwdPath),
    executablePathSha256: sha256(binding.executable),
    executableSha256: binding.executableSha256,
    argumentCount: input.args.length,
    argumentSetSha256: sha256(canonicalJson(input.args)),
    environmentSha256: sha256(canonicalJson(environment)),
    ...(binding.runtimeAssetSetSha256
      ? { runtimeAssetSetSha256: binding.runtimeAssetSetSha256 }
      : {}),
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
    executable: binding.executable,
    executableSha256: binding.executableSha256,
    runtimeAssets: binding.runtimeAssets,
    timeoutMs,
    launch: {
      command: binding.executable,
      args: [...input.args],
      cwd,
      env: { ...environment },
      workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
      ...(binding.runtimeReadPaths.length > 0
        ? { runtimeReadPaths: binding.runtimeReadPaths }
        : {}),
    },
    receipt,
  };
}

export async function assertCommandRuntimeStable(
  prepared: PreparedCommandExecution,
): Promise<void> {
  let executableSha256: string;
  try {
    executableSha256 = await sha256File(prepared.executable);
  } catch {
    throw new Error("command runtime changed during execution");
  }
  if (executableSha256 !== prepared.executableSha256) {
    throw new Error("command runtime changed during execution");
  }
  for (const asset of prepared.runtimeAssets) {
    let observed: string;
    try {
      observed = await sha256File(asset.path);
    } catch {
      throw new Error("command runtime assets changed during execution");
    }
    if (observed !== asset.sha256) {
      throw new Error("command runtime assets changed during execution");
    }
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
      ...(prepared.receipt.runtimeAssetSetSha256
        ? {
            runtimeAssetSetSha256: prepared.receipt.runtimeAssetSetSha256,
          }
        : {}),
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
  if (input.runtime !== "node" && input.runtime !== "python") {
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

async function resolveRuntimeBinding(
  runtime: CommandRuntime,
  overrides: CommandRunnerOptions["executables"],
): Promise<CommandRuntimeBinding> {
  const candidate =
    overrides?.[runtime] ??
    (runtime === "node"
      ? process.execPath
      : await defaultPythonExecutable(process.platform));
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${runtime} executable must use an absolute path`);
  }
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    throw new Error(`${runtime} runtime is unavailable`);
  }
  let resolved: string;
  let executableSha256: string;
  try {
    resolved = await realpath(candidate);
    if (!(await stat(resolved)).isFile()) throw new Error();
    executableSha256 = await sha256File(resolved);
  } catch {
    throw new Error(`${runtime} runtime is unavailable`);
  }
  if (runtime === "node") {
    return {
      executable: resolved,
      executableSha256,
      runtimeReadPaths: [],
      runtimeAssets: [],
    };
  }
  const runtimeRoot = await pythonRuntimeRoot(resolved, process.platform);
  let runtimeAssets: CommandRuntimeAsset[];
  try {
    runtimeAssets = await pythonRuntimeAssets(runtimeRoot);
  } catch {
    throw new Error("python runtime assets are unavailable");
  }
  return {
    executable: resolved,
    executableSha256,
    runtimeReadPaths: [runtimeRoot],
    runtimeAssets,
    runtimeAssetSetSha256: sha256(
      canonicalJson(
        runtimeAssets.map((asset) => ({
          pathSha256: sha256(asset.path),
          sha256: asset.sha256,
        })),
      ),
    ),
  };
}

async function defaultPythonExecutable(
  platform: NodeJS.Platform,
): Promise<string> {
  const candidates =
    platform === "darwin"
      ? MACOS_PYTHON_CANDIDATES
      : ([UNIX_PYTHON_EXECUTABLE] as const);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed system location.
    }
  }
  throw new Error("python runtime is unavailable");
}

async function pythonRuntimeRoot(
  executable: string,
  platform: NodeJS.Platform,
): Promise<string> {
  if (platform === "darwin") {
    const versionRoot = path.resolve(executable, "../..");
    const frameworkMarker = "/Library/Frameworks/Python3.framework/Versions/";
    if (
      !versionRoot.includes(frameworkMarker) ||
      !/^python3(?:\.\d+)?$/u.test(path.basename(executable))
    ) {
      throw new Error(
        "python runtime must use a recognized Xcode or Command Line Tools executable",
      );
    }
    try {
      const resolved = await realpath(versionRoot);
      if (!(await stat(resolved)).isDirectory()) throw new Error();
      return resolved;
    } catch {
      throw new Error("python runtime assets are unavailable");
    }
  }
  if (platform === "linux") {
    const version = path.basename(executable).match(/^python(\d+\.\d+)$/u)?.[1];
    if (!version) {
      throw new Error("python runtime executable version is unavailable");
    }
    const candidates = [
      `/usr/lib/python${version}`,
      `/usr/local/lib/python${version}`,
    ];
    for (const candidate of candidates) {
      try {
        const resolved = await realpath(candidate);
        if ((await stat(resolved)).isDirectory()) return resolved;
      } catch {
        // Try the next fixed library root.
      }
    }
  }
  throw new Error(`python runtime assets are unavailable on ${platform}`);
}

async function pythonRuntimeAssets(
  runtimeRoot: string,
): Promise<CommandRuntimeAsset[]> {
  let stdlib = runtimeRoot;
  const paths: string[] = [];
  if (!/^python\d+\.\d+$/u.test(path.basename(runtimeRoot))) {
    const libraryRoot = path.join(runtimeRoot, "lib");
    const versions = (await readdir(libraryRoot, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && /^python\d+\.\d+$/u.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
    const version = versions.at(-1);
    if (!version) throw new Error("python stdlib version is unavailable");
    stdlib = path.join(libraryRoot, version);
    paths.push(path.join(runtimeRoot, "Python3"));
  }
  for (const relative of PYTHON_RUNTIME_REQUIRED_ASSETS) {
    await addPythonRuntimeAsset(paths, stdlib, relative, true);
  }
  for (const relative of PYTHON_RUNTIME_OPTIONAL_ASSETS) {
    await addPythonRuntimeAsset(paths, stdlib, relative, false);
  }
  const extensionRoot = path.join(stdlib, "lib-dynload");
  for (const entry of await readdir(extensionRoot, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      PYTHON_RUNTIME_EXTENSION_PREFIXES.some((prefix) =>
        entry.name.startsWith(prefix),
      )
    ) {
      paths.push(path.join(extensionRoot, entry.name));
    }
  }
  const unique = [...new Set(paths)].sort();
  if (unique.length > MAX_RUNTIME_ASSET_FILES) {
    throw new Error("python runtime assets exceed the file limit");
  }
  return Promise.all(
    unique.map(async (assetPath) => {
      const resolved = await realpath(assetPath);
      if (!(await stat(resolved)).isFile()) throw new Error();
      return { path: resolved, sha256: await sha256File(resolved) };
    }),
  );
}

async function addPythonRuntimeAsset(
  paths: string[],
  stdlib: string,
  relative: string,
  required: boolean,
): Promise<void> {
  const source = path.join(stdlib, relative);
  try {
    if (!(await stat(source)).isFile()) throw new Error();
    paths.push(source);
  } catch {
    if (required) throw new Error("python runtime asset is unavailable");
    return;
  }
  if (!source.endsWith(".py")) return;
  const cacheRoot = path.join(path.dirname(source), "__pycache__");
  const prefix = `${path.basename(source, ".py")}.`;
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.startsWith(prefix) &&
      entry.name.endsWith(".pyc")
    ) {
      paths.push(path.join(cacheRoot, entry.name));
    }
  }
}

export async function sha256File(file: string): Promise<string> {
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
