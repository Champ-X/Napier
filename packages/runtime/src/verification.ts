import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { runSandboxedProcess } from "./sandboxed-process.js";
import {
  assertVerificationToolchainStable,
  resolveVerificationToolchain,
} from "./verification-toolchain.js";
import type {
  SelectedTestExecutionResult,
  VerificationDetails,
  VerificationKind,
  VerificationRequest,
  VerificationResult,
  VerificationRunnerOptions,
  VerificationStatus,
} from "./verification-types.js";
import { createWorkspacePathSnapshot as createPathSnapshot } from "./workspace-snapshot.js";

export type {
  SelectedTestExecutionResult,
  VerificationDetails,
  VerificationKind,
  VerificationRequest,
  VerificationResult,
  VerificationRunnerOptions,
  VerificationStatus,
} from "./verification-types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 32_000;
const VERIFICATION_CLIS = {
  typecheck: "node_modules/typescript/bin/tsc",
  test: "node_modules/vitest/vitest.mjs",
  format: "node_modules/prettier/bin/prettier.cjs",
} as const satisfies Record<VerificationKind, string>;

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
    const workspaceRoot = await realpath(this.workspaceRoot);
    const cwd = await resolveExistingPath(
      workspaceRoot,
      input.cwd ?? ".",
      "verification cwd",
    );
    if (!(await stat(cwd)).isDirectory()) {
      throw new Error("verification cwd must be a directory");
    }
    const toolchain = await resolveVerificationToolchain({
      workspaceRoot,
      ...(this.options.toolchainRoot
        ? { toolchainRoot: this.options.toolchainRoot }
        : {}),
      verifierRelativePath: VERIFICATION_CLIS[input.kind],
    });
    const nodeExecutable = await realpath(
      path.resolve(this.options.nodeExecutable ?? process.execPath),
    );
    const target = await resolveVerificationTarget(workspaceRoot, cwd, input);
    const cwdPath = path.relative(workspaceRoot, cwd) || ".";
    const targetPath = target
      ? path.relative(workspaceRoot, target) || "."
      : undefined;
    const workspaceSnapshot = await createPathSnapshot(workspaceRoot, cwd);
    const targetSnapshot = target
      ? await createPathSnapshot(workspaceRoot, target)
      : undefined;
    const scopeReceipt = {
      kind: input.kind,
      cwdPathSha256: sha256(cwdPath),
      ...(targetPath ? { targetPathSha256: sha256(targetPath) } : {}),
      ...(targetSnapshot
        ? {
            targetKind: targetSnapshot.kind,
            targetSnapshotSha256: targetSnapshot.sha256,
            targetSnapshotFileCount: targetSnapshot.fileCount,
            targetSnapshotBytes: targetSnapshot.bytes,
            targetSnapshotTruncated: targetSnapshot.truncated,
          }
        : {}),
      verifierPathSha256: toolchain.verifierPathSha256,
      verifierSha256: toolchain.verifierSha256,
      toolchainExternal: toolchain.external,
      toolchainSha256: toolchain.contentSha256,
      workspaceSnapshotSha256: workspaceSnapshot.sha256,
      workspaceSnapshotFileCount: workspaceSnapshot.fileCount,
      workspaceSnapshotBytes: workspaceSnapshot.bytes,
      workspaceSnapshotTruncated: workspaceSnapshot.truncated,
    };
    const execution = await runSandboxedProcess({
      sandbox: this.options.sandbox,
      launch: {
        command: nodeExecutable,
        args: verificationArgs(input.kind, toolchain.verifierPath, target),
        cwd,
        env: {
          CI: "1",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        workspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
        ...(toolchain.runtimeReadPaths.length > 0
          ? { runtimeReadPaths: toolchain.runtimeReadPaths }
          : {}),
      },
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputChars: MAX_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "verification was aborted",
    });
    const status: VerificationStatus =
      execution.status === "exited"
        ? execution.exitCode === 0
          ? "passed"
          : "failed"
        : execution.status;
    await assertVerificationToolchainStable(toolchain);
    const detailsBase = {
      kind: input.kind,
      status,
      sandbox: this.options.sandbox.id,
      cwd: cwdPath,
      ...(targetPath ? { target: targetPath } : {}),
      scopeSha256: sha256(canonicalJson(scopeReceipt)),
      cwdPathSha256: scopeReceipt.cwdPathSha256,
      ...(scopeReceipt.targetPathSha256
        ? { targetPathSha256: scopeReceipt.targetPathSha256 }
        : {}),
      ...(targetSnapshot
        ? {
            targetKind: targetSnapshot.kind,
            targetSnapshotSha256: targetSnapshot.sha256,
            targetSnapshotFileCount: targetSnapshot.fileCount,
            targetSnapshotBytes: targetSnapshot.bytes,
            targetSnapshotTruncated: targetSnapshot.truncated,
          }
        : {}),
      verifierPathSha256: scopeReceipt.verifierPathSha256,
      verifierSha256: toolchain.verifierSha256,
      toolchainExternal: toolchain.external,
      toolchainSha256: toolchain.contentSha256,
      workspaceSnapshotSha256: workspaceSnapshot.sha256,
      workspaceSnapshotFileCount: workspaceSnapshot.fileCount,
      workspaceSnapshotBytes: workspaceSnapshot.bytes,
      workspaceSnapshotTruncated: workspaceSnapshot.truncated,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdoutChars: execution.stdout.length,
      stderrChars: execution.stderr.length,
      stdoutSha256: sha256(execution.stdout),
      stderrSha256: sha256(execution.stderr),
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    };
    return {
      details: {
        ...detailsBase,
        resultSha256: sha256(canonicalJson(detailsBase)),
      },
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
  }

  async runSelectedTests(
    targets: string[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<SelectedTestExecutionResult> {
    if (
      targets.length < 1 ||
      targets.length > 8 ||
      new Set(targets).size !== targets.length ||
      targets.some(
        (target) =>
          !target ||
          target.length > 500 ||
          path.isAbsolute(target) ||
          /[\u0000-\u001f\u007f]/u.test(target),
      ) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error("Selected test verification request is invalid");
    }
    const workspaceRoot = await realpath(this.workspaceRoot);
    const toolchain = await resolveVerificationToolchain({
      workspaceRoot,
      ...(this.options.toolchainRoot
        ? { toolchainRoot: this.options.toolchainRoot }
        : {}),
      verifierRelativePath: VERIFICATION_CLIS.test,
    });
    const resolvedTargets = [];
    for (const target of targets) {
      const resolved = await resolveExistingPath(
        workspaceRoot,
        target,
        "selected test target",
      );
      if (!(await stat(resolved)).isFile()) {
        throw new Error("selected test target must be a file");
      }
      resolvedTargets.push(resolved);
    }
    const nodeExecutable = await realpath(
      path.resolve(this.options.nodeExecutable ?? process.execPath),
    );
    const execution = await runSandboxedProcess({
      sandbox: this.options.sandbox,
      launch: {
        command: nodeExecutable,
        args: [
          toolchain.verifierPath,
          "run",
          "--pool=threads",
          "--maxWorkers=2",
          ...resolvedTargets,
        ],
        cwd: workspaceRoot,
        env: {
          CI: "1",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        workspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
        ...(toolchain.runtimeReadPaths.length > 0
          ? { runtimeReadPaths: toolchain.runtimeReadPaths }
          : {}),
      },
      timeoutMs,
      maxOutputChars: MAX_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "selected test verification was aborted",
    });
    const status: VerificationStatus =
      execution.status === "exited"
        ? execution.exitCode === 0
          ? "passed"
          : "failed"
        : execution.status;
    await assertVerificationToolchainStable(toolchain);
    return {
      status,
      sandbox: this.options.sandbox.id,
      verifierSha256: toolchain.verifierSha256,
      toolchainSha256: toolchain.contentSha256,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdout: execution.stdout,
      stderr: execution.stderr,
      stdoutSha256: sha256(execution.stdout),
      stderrSha256: sha256(execution.stderr),
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    };
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

function formatVerificationResult(result: VerificationResult): string {
  const { details } = result;
  const sections = [
    `Verification ${details.status.toUpperCase()}: ${details.kind}`,
    `Sandbox: ${details.sandbox}`,
    `CWD: ${details.cwd}`,
    ...(details.target ? [`Target: ${details.target}`] : []),
    `Scope SHA-256: ${details.scopeSha256}`,
    `CWD path SHA-256: ${details.cwdPathSha256}`,
    ...(details.targetPathSha256
      ? [`Target path SHA-256: ${details.targetPathSha256}`]
      : []),
    ...(details.targetSnapshotSha256
      ? [
          `Target snapshot SHA-256: ${details.targetSnapshotSha256}`,
          `Target snapshot: ${details.targetSnapshotFileCount ?? 0} files / ${details.targetSnapshotBytes ?? 0} bytes${
            details.targetSnapshotTruncated ? " / truncated" : ""
          }`,
        ]
      : []),
    `Verifier SHA-256: ${details.verifierSha256}`,
    `Toolchain: ${details.toolchainExternal ? "external-read-only" : "workspace-local"}`,
    `Toolchain SHA-256: ${details.toolchainSha256}`,
    `Workspace snapshot SHA-256: ${details.workspaceSnapshotSha256}`,
    `Workspace snapshot: ${details.workspaceSnapshotFileCount} files / ${details.workspaceSnapshotBytes} bytes${
      details.workspaceSnapshotTruncated ? " / truncated" : ""
    }`,
    `Exit: ${String(details.exitCode)} / ${String(details.signal)}`,
    `Duration: ${details.durationMs} ms`,
    `stdout SHA-256: ${details.stdoutSha256}`,
    `stderr SHA-256: ${details.stderrSha256}`,
    `Result SHA-256: ${details.resultSha256}`,
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

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
