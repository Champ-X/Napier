import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { OsSandboxAdapter } from "./sandbox.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 32_000;
const VERIFICATION_CLIS = {
  typecheck: "node_modules/typescript/bin/tsc",
  test: "node_modules/vitest/vitest.mjs",
  format: "node_modules/prettier/bin/prettier.cjs",
} as const;

const verifyWorkspaceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("typecheck"),
      Type.Literal("test"),
      Type.Literal("format"),
    ]),
    cwd: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description:
          "Workspace-relative working directory. Defaults to the workspace root.",
      }),
    ),
    target: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description:
          "Path relative to cwd for a config, test, or format target. Typecheck defaults to cwd/tsconfig.json; test defaults to all tests in cwd; format defaults to cwd.",
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

export type VerificationKind = keyof typeof VERIFICATION_CLIS;

export interface VerificationRequest {
  kind: VerificationKind;
  cwd?: string;
  target?: string;
  timeoutMs?: number;
}

export type VerificationStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "output_capped";

export interface VerificationDetails {
  kind: VerificationKind;
  status: VerificationStatus;
  sandbox: string;
  cwd: string;
  target?: string;
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

export interface VerificationResult {
  details: VerificationDetails;
  stdout: string;
  stderr: string;
}

export interface VerificationRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  nodeExecutable?: string;
}

interface OutputCollector {
  readonly completion: Promise<void>;
  readonly text: string;
  readonly truncated: boolean;
}

export class VerificationRunner {
  private readonly workspaceRoot: string;

  constructor(private readonly options: VerificationRunnerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  async run(
    input: VerificationRequest,
    signal?: AbortSignal,
  ): Promise<VerificationResult> {
    validateVerificationRequest(input);
    const startedAt = Date.now();
    const workspaceRoot = await realpath(this.workspaceRoot);
    const cwd = await resolveExistingPath(
      workspaceRoot,
      input.cwd ?? ".",
      "verification cwd",
    );
    if (!(await stat(cwd)).isDirectory()) {
      throw new Error("verification cwd must be a directory");
    }
    const cli = await resolveExistingPath(
      workspaceRoot,
      VERIFICATION_CLIS[input.kind],
      `${input.kind} verifier`,
    );
    if (!(await stat(cli)).isFile()) {
      throw new Error(`${input.kind} verifier must be a file`);
    }
    const nodeExecutable = await realpath(
      path.resolve(this.options.nodeExecutable ?? process.execPath),
    );
    const target = await resolveVerificationTarget(workspaceRoot, cwd, input);
    const child = await this.options.sandbox.launch({
      command: nodeExecutable,
      args: verificationArgs(input.kind, cli, target),
      cwd,
      env: {
        CI: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
    });
    child.stdin.end();

    let forcedStatus:
      | Exclude<VerificationStatus, "passed" | "failed">
      | undefined;
    let termination: Promise<void> | undefined;
    const forceStop = (
      status: Exclude<VerificationStatus, "passed" | "failed">,
    ): void => {
      if (forcedStatus) return;
      forcedStatus = status;
      termination = child.terminate();
    };
    const stdout = collectOutput(child.stdout, () =>
      forceStop("output_capped"),
    );
    const stderr = collectOutput(child.stderr, () =>
      forceStop("output_capped"),
    );
    const timeout = setTimeout(
      () => forceStop("timed_out"),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const abort = (): void => {
      if (!termination) termination = child.terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    try {
      const exit = await child.exit;
      await termination;
      await Promise.all([stdout.completion, stderr.completion]);
      if (signal?.aborted) throw new Error("verification was aborted");
      const status: VerificationStatus =
        forcedStatus ?? (exit.code === 0 ? "passed" : "failed");
      const stdoutText = stdout.text;
      const stderrText = stderr.text;
      return {
        details: {
          kind: input.kind,
          status,
          sandbox: this.options.sandbox.id,
          cwd: path.relative(workspaceRoot, cwd) || ".",
          ...(target
            ? { target: path.relative(workspaceRoot, target) || "." }
            : {}),
          durationMs: Math.max(0, Date.now() - startedAt),
          exitCode: exit.code,
          signal: exit.signal,
          stdoutChars: stdoutText.length,
          stderrChars: stderrText.length,
          stdoutSha256: sha256(stdoutText),
          stderrSha256: sha256(stderrText),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        },
        stdout: stdoutText,
        stderr: stderrText,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted && !termination) {
        await child.terminate();
      }
    }
  }
}

export function createVerificationTool(
  options: VerificationRunnerOptions,
): AgentTool<typeof verifyWorkspaceSchema, VerificationDetails> {
  const runner = new VerificationRunner(options);
  return {
    name: "verify_workspace",
    label: "Verify workspace",
    description:
      "Run a bounded TypeScript typecheck, Vitest test, or Prettier format check through Napier's OS sandbox. The workspace is read-only, networking is disabled, no package script or shell is used, and stdout/stderr are bounded.",
    parameters: verifyWorkspaceSchema,
    async execute(_toolCallId, input, signal) {
      const result = await runner.run(input, signal);
      return {
        content: [
          {
            type: "text",
            text: formatVerificationResult(result),
          },
        ],
        details: result.details,
      };
    },
  };
}

function validateVerificationRequest(input: VerificationRequest): void {
  if (
    typeof input.kind !== "string" ||
    !Object.hasOwn(VERIFICATION_CLIS, input.kind)
  ) {
    throw new Error(`Unsupported verification kind: ${String(input.kind)}`);
  }
  for (const [label, value] of [
    ["cwd", input.cwd],
    ["target", input.target],
  ] as const) {
    if (
      value !== undefined &&
      (!value ||
        path.isAbsolute(value) ||
        value.length > 500 ||
        /[\u0000-\u001f\u007f]/.test(value))
    ) {
      throw new Error(`verification ${label} must be workspace-relative`);
    }
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < MIN_TIMEOUT_MS ||
      input.timeoutMs > MAX_TIMEOUT_MS)
  ) {
    throw new Error(
      `verification timeoutMs must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`,
    );
  }
}

async function resolveExistingPath(
  workspaceRoot: string,
  candidate: string,
  label: string,
): Promise<string> {
  const lexical = path.resolve(workspaceRoot, candidate);
  if (!isPathInside(lexical, workspaceRoot)) {
    throw new Error(`${label} escapes the workspace`);
  }
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`${label} does not exist: ${candidate}`);
    }
    throw error;
  }
  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error(`${label} resolves outside the workspace`);
  }
  return resolved;
}

async function resolveVerificationTarget(
  workspaceRoot: string,
  cwd: string,
  input: VerificationRequest,
): Promise<string | undefined> {
  const candidate =
    input.target ?? (input.kind === "typecheck" ? "tsconfig.json" : undefined);
  if (!candidate) return input.kind === "format" ? cwd : undefined;
  const lexical = path.resolve(cwd, candidate);
  if (!isPathInside(lexical, workspaceRoot)) {
    throw new Error("verification target escapes the workspace");
  }
  const relative = path.relative(workspaceRoot, lexical);
  return resolveExistingPath(workspaceRoot, relative, "verification target");
}

function verificationArgs(
  kind: VerificationKind,
  cli: string,
  target: string | undefined,
): string[] {
  if (kind === "typecheck") {
    if (!target) throw new Error("typecheck requires a tsconfig target");
    return [cli, "-p", target, "--noEmit", "--pretty", "false"];
  }
  if (kind === "test") {
    return [
      cli,
      "run",
      "--pool=threads",
      "--maxWorkers=2",
      ...(target ? [target] : []),
    ];
  }
  return [cli, "--check", target ?? "."];
}

function collectOutput(stream: Readable, onLimit: () => void): OutputCollector {
  let text = "";
  let truncated = false;
  const completion = new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    stream.once("end", finish);
    stream.once("close", finish);
    stream.once("error", finish);
    stream.on("data", (chunk: Buffer | string) => {
      if (truncated) return;
      const value = chunk.toString();
      const remaining = MAX_OUTPUT_CHARS - text.length;
      if (value.length <= remaining) {
        text += value;
        return;
      }
      text += value.slice(0, Math.max(0, remaining));
      truncated = true;
      onLimit();
    });
  });
  return {
    completion,
    get text() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}

function formatVerificationResult(result: VerificationResult): string {
  const { details } = result;
  const sections = [
    `Verification ${details.status.toUpperCase()}: ${details.kind}`,
    `Sandbox: ${details.sandbox}`,
    `CWD: ${details.cwd}`,
    ...(details.target ? [`Target: ${details.target}`] : []),
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
  ];
  return sections.join("\n");
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
