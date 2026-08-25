import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime/core";
import { CommandRunner } from "@napier/runtime/tools";

import type { CodingBenchmarkRuntimeFactory } from "./coding-benchmark-session.js";
import type { CodingBenchmarkOutcomeTestEvidence } from "./coding-benchmark-types.js";

const HIDDEN_TEST_FILE = ".napier-benchmark-outcome.mjs";
const OUTCOME_TIMEOUT_MS = 30_000;
const SANDBOX_STARTED_MARKER = "NAPIER_BENCHMARK_SANDBOX_STARTED\n";

export interface RunCodingBenchmarkOutcomeTestInput {
  workspaceRoot: string;
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>;
  testSource: string;
  testSha256: string;
  runtimeFactory: CodingBenchmarkRuntimeFactory;
  signal?: AbortSignal;
}

export async function runCodingBenchmarkOutcomeTest(
  input: RunCodingBenchmarkOutcomeTestInput,
): Promise<CodingBenchmarkOutcomeTestEvidence> {
  if (sha256(input.testSource) !== input.testSha256) {
    throw new Error("Coding benchmark outcome test hash mismatch");
  }
  const hiddenTestPath = path.join(input.workspaceRoot, HIDDEN_TEST_FILE);
  let hiddenTestCreated = false;
  let runtime:
    | Awaited<ReturnType<CodingBenchmarkRuntimeFactory["createRuntime"]>>
    | undefined;
  try {
    await writeFile(hiddenTestPath, input.testSource, {
      encoding: "utf8",
      flag: "wx",
    });
    hiddenTestCreated = true;
    runtime = await input.runtimeFactory.createRuntime({
      workspaceRoot: input.workspaceRoot,
      dataRoot: input.dataRoot,
      env: input.env,
    });
    const runner = new CommandRunner({
      workspaceRoot: input.workspaceRoot,
      sandbox: runtime.sandbox,
    });
    const result = await runner.run(
      {
        runtime: "node",
        args: [HIDDEN_TEST_FILE],
        timeoutMs: OUTCOME_TIMEOUT_MS,
      },
      input.signal,
    );
    const status = sandboxBackendUnavailable(
      result.details.sandbox,
      result.details.exitCode,
      result.stdout,
      result.stderr,
    )
      ? ("unavailable" as const)
      : result.details.status;
    return {
      testSha256: input.testSha256,
      status,
      sandboxId: result.details.sandbox,
      resultSha256: result.details.resultSha256,
      durationMs: result.details.durationMs,
      exitCode: result.details.exitCode,
      stdoutSha256: result.details.stdoutSha256,
      stderrSha256: result.details.stderrSha256,
      passed: status === "succeeded",
    };
  } catch (error) {
    const status = input.signal?.aborted ? "cancelled" : "unavailable";
    const diagnostic = error instanceof Error ? error.message : String(error);
    const sandboxId = runtime?.sandbox.id ?? "unavailable";
    return {
      testSha256: input.testSha256,
      status,
      sandboxId,
      resultSha256: sha256(
        canonicalJson({
          status,
          sandboxId,
          diagnosticSha256: sha256(diagnostic),
          diagnosticBytes: Buffer.byteLength(diagnostic, "utf8"),
        }),
      ),
      durationMs: 0,
      exitCode: null,
      stdoutSha256: sha256(""),
      stderrSha256: sha256(""),
      passed: false,
    };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    if (hiddenTestCreated) await rm(hiddenTestPath, { force: true });
  }
}

function sandboxBackendUnavailable(
  sandboxId: string,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): boolean {
  return (
    !stdout.startsWith(SANDBOX_STARTED_MARKER) &&
    ((sandboxId === "macos-sandbox-exec" &&
      exitCode === 71 &&
      stderr.startsWith("sandbox-exec: sandbox_apply:")) ||
      (sandboxId === "linux-bubblewrap" && stderr.startsWith("bwrap:")))
  );
}
