import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./ed25519.js";
import { runSandboxedProcess } from "./sandboxed-process.js";
import {
  assertVerificationRuntimeStable,
  resolveVerificationRuntime,
} from "./verification-runtime.js";
import { selectVerificationTestRunner } from "./verification-test-runner.js";
import { verificationArgs } from "./verification-arguments.js";
import { containerVerificationArgs } from "./verification-container-entry.js";
import { resolveExistingPath } from "./verification-paths.js";
import type {
  SelectedTestExecutionResult,
  VerificationRunnerOptions,
  VerificationStatus,
} from "./verification-types.js";
export async function runSelectedVerificationTests(
  options: VerificationRunnerOptions,
  targets: string[],
  timeoutMs = 60_000,
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
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw new Error("Selected test verification request is invalid");
  }
  const workspaceRoot = await realpath(options.workspaceRoot);
  const nodeExecutable = await realpath(
    path.resolve(options.nodeExecutable ?? process.execPath),
  );
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
  const selection = await selectVerificationTestRunner(
    workspaceRoot,
    resolvedTargets,
  );
  const runtime = await resolveVerificationRuntime({
    workspaceRoot,
    sandbox: options.sandbox,
    kind: "test",
    testRunner: selection.runner,
    nodeExecutable,
    nodeExecutableExplicit: options.nodeExecutable !== undefined,
    ...(options.toolchainRoot ? { toolchainRoot: options.toolchainRoot } : {}),
  });
  const execution = await runSandboxedProcess({
    sandbox: options.sandbox,
    launch: {
      command: runtime.nodeExecutable,
      args: containerVerificationArgs(
        options.sandbox.id,
        workspaceRoot,
        selection.runner === "node-test"
          ? verificationArgs(
              "test",
              runtime.verifierPath,
              undefined,
              selection.targets,
            )
          : [
              runtime.verifierPath,
              "run",
              "--pool=threads",
              "--maxWorkers=2",
              ...resolvedTargets,
            ],
      ),
      cwd: workspaceRoot,
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
    timeoutMs,
    maxOutputChars: 32_000,
    ...(signal ? { signal } : {}),
    abortedMessage: "selected test verification was aborted",
  });
  const status: VerificationStatus =
    execution.status === "exited"
      ? execution.exitCode === 0
        ? "passed"
        : "failed"
      : execution.status;
  await assertVerificationRuntimeStable(runtime, options.sandbox);
  if (
    (await selectVerificationTestRunner(workspaceRoot, resolvedTargets))
      .sourceSha256 !== selection.sourceSha256
  )
    throw new Error("Test runner selection changed during execution");
  return {
    status,
    sandbox: options.sandbox.id,
    verifierSha256: runtime.verifierSha256,
    ...(runtime.verifierVersion
      ? { verifierVersion: runtime.verifierVersion }
      : {}),
    toolchainSha256: runtime.toolchainSha256,
    ...(runtime.runtimeIdentitySha256
      ? { runtimeIdentitySha256: runtime.runtimeIdentitySha256 }
      : {}),
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
