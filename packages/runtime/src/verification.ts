import { verificationScopeReceipt } from "./verification-scope.js";
import {
  captureVerificationWorkspace,
  settleVerificationWorkspace,
} from "./verification-workspace-snapshot.js";
import { resolveExistingPath, isPathInside } from "./verification-paths.js";
import { runSelectedVerificationTests } from "./verification-selected-tests.js";
import { selectVerificationTestRunner } from "./verification-test-runner.js";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { canonicalJson, sha256 } from "./ed25519.js";
import { runSandboxedProcess } from "./sandboxed-process.js";
import { verificationArgs } from "./verification-arguments.js";
import { containerVerificationArgs } from "./verification-container-entry.js";
import {
  assertVerificationRuntimeStable,
  resolveVerificationRuntime,
} from "./verification-runtime.js";
import type {
  SelectedTestExecutionResult,
  VerificationKind,
  VerificationRequest,
  VerificationResult,
  VerificationRunnerOptions,
  VerificationStatus,
} from "./verification-types.js";
import { defineVerificationToolProgress } from "./verification-tool-progress.js";
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
const VERIFICATION_KINDS = new Set<VerificationKind>([
  "typecheck",
  "test",
  "format",
]);

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
      }),
    ),
    target: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
      }),
    ),
    testRunner: Type.Optional(
      Type.Union([Type.Literal("node-test"), Type.Literal("vitest")]),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: MIN_TIMEOUT_MS,
        maximum: MAX_TIMEOUT_MS,
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
    const nodeExecutable = await realpath(
      path.resolve(this.options.nodeExecutable ?? process.execPath),
    );
    const target = await resolveVerificationTarget(workspaceRoot, cwd, input);
    const selection =
      input.kind === "test"
        ? await selectVerificationTestRunner(
            workspaceRoot,
            [target ?? cwd],
            input.testRunner,
          )
        : undefined;
    const runtime = await resolveVerificationRuntime({
      workspaceRoot,
      sandbox: this.options.sandbox,
      kind: input.kind,
      ...(selection ? { testRunner: selection.runner } : {}),
      nodeExecutable,
      nodeExecutableExplicit: this.options.nodeExecutable !== undefined,
      ...(this.options.toolchainRoot
        ? { toolchainRoot: this.options.toolchainRoot }
        : {}),
    });
    const cwdPath = path.relative(workspaceRoot, cwd) || ".";
    const targetPath = target
      ? path.relative(workspaceRoot, target) || "."
      : undefined;
    const workspaceSnapshot = await captureVerificationWorkspace(
      workspaceRoot,
      signal,
    );
    const targetSnapshot = target
      ? await createPathSnapshot(workspaceRoot, target)
      : undefined;
    const scopeReceipt = verificationScopeReceipt({
      kind: input.kind,
      cwdPath,
      targetPath,
      targetSnapshot,
      workspaceSnapshot,
      runtime,
      selection,
    });
    const execution = await runSandboxedProcess({
      sandbox: this.options.sandbox,
      launch: {
        command: runtime.nodeExecutable,
        args: containerVerificationArgs(
          this.options.sandbox.id,
          workspaceRoot,
          verificationArgs(
            input.kind,
            runtime.verifierPath,
            target,
            selection?.runner === "node-test" ? selection.targets : undefined,
          ),
        ),
        cwd,
        env: {
          CI: "1",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        workspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
        ...(runtime.runtimeReadPaths.length > 0
          ? { runtimeReadPaths: runtime.runtimeReadPaths }
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
    await assertVerificationRuntimeStable(runtime, this.options.sandbox);
    if (
      selection &&
      (
        await selectVerificationTestRunner(
          workspaceRoot,
          [target ?? cwd],
          input.testRunner,
        )
      ).sourceSha256 !== selection.sourceSha256
    )
      throw new Error("Test runner selection changed during execution");
    const detailsBase = {
      ...scopeReceipt,
      ...(await settleVerificationWorkspace(
        workspaceRoot,
        workspaceSnapshot,
        status,
        signal,
      )),
      sandbox: this.options.sandbox.id,
      cwd: cwdPath,
      ...(targetPath ? { target: targetPath } : {}),
      scopeSha256: sha256(canonicalJson(scopeReceipt)),
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

  runSelectedTests(
    targets: string[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<SelectedTestExecutionResult> {
    return runSelectedVerificationTests(
      this.options,
      targets,
      timeoutMs,
      signal,
    );
  }
}

export function createVerificationTool(options: VerificationRunnerOptions) {
  const runner = new VerificationRunner(options);
  return defineVerificationToolProgress({
    name: "verify_workspace",
    label: "Verify workspace",
    description:
      "Read-only offline typecheck/test/format, pinned toolchain. cwd=root (relative); target defaults: tsconfig/all tests/cwd. testRunner overrides inference. No package script/shell.",
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
  });
}

function validateVerificationRequest(input: VerificationRequest): void {
  if (
    (input.testRunner !== undefined &&
      (input.kind !== "test" ||
        !["node-test", "vitest"].includes(input.testRunner))) ||
    typeof input.kind !== "string" ||
    !VERIFICATION_KINDS.has(input.kind as VerificationKind)
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
    `Toolchain: ${
      details.runtimeIdentitySha256
        ? "image-bound"
        : details.toolchainExternal
          ? "external-read-only"
          : "workspace-local"
    }`,
    ...(details.verifierVersion
      ? [`Verifier version: ${details.verifierVersion}`]
      : []),
    `Toolchain SHA-256: ${details.toolchainSha256}`,
    `Workspace snapshot SHA-256: ${details.workspaceSnapshotSha256}`,
    `Workspace stability: ${details.snapshotStatus ?? "not observed"}`,
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
