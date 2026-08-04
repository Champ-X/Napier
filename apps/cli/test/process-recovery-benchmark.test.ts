import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadProcessRecoveryBenchmarkCase,
  validateProcessRecoveryBenchmarkCase,
} from "../src/process-recovery-benchmark-case.js";
import { verifyProcessRecoveryBenchmarkArtifacts } from "../src/process-recovery-benchmark-contract.js";
import {
  processRecoveryLedgerFileName,
  processRecoveryResultFileName,
} from "../src/process-recovery-benchmark-evidence.js";
import { createTrustedOuterProcessBenchmarkSandbox } from "../src/process-recovery-benchmark-sandbox.js";
import {
  processRecoverySeriesArtifactReferences,
  runProcessRecoveryBenchmarkSeries,
  verifyProcessRecoveryBenchmarkSeries,
} from "../src/process-recovery-benchmark-series.js";
import type {
  ProcessRecoveryBenchmarkLedger,
  ProcessRecoveryBenchmarkResult,
} from "../src/process-recovery-benchmark-types.js";
import { runProcessRecoveryBenchmark } from "../src/process-recovery-benchmark.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/process-write-compensation-v1",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Process recovery benchmark", () => {
  it("loads an exact hash-bound case and rejects drift", async () => {
    const benchmarkCase = await loadProcessRecoveryBenchmarkCase(CASE_ROOT);
    expect(benchmarkCase).toEqual(
      expect.objectContaining({
        id: "long_horizon_process_write_compensation_v1",
        expectedExitCode: 17,
        expectedCompensationStatus: "restored",
      }),
    );
    expect(() =>
      validateProcessRecoveryBenchmarkCase({
        ...benchmarkCase,
        targetPath: "../outside.txt",
      }),
    ).toThrow("case hash mismatch");
    expect(() =>
      validateProcessRecoveryBenchmarkCase({
        ...benchmarkCase,
        unexpected: true,
      }),
    ).toThrow("case is invalid");
  });

  it("rejects malformed deep artifact shapes without throwing", () => {
    const verification = verifyProcessRecoveryBenchmarkArtifacts(
      {
        kind: "napier.process-recovery-benchmark-result",
        schemaVersion: 1,
        caseId: "long_horizon_process_write_compensation_v1",
        caseSha256: "0".repeat(64),
        contentSha256: "0".repeat(64),
      },
      {
        kind: "napier.process-recovery-benchmark-ledger",
        schemaVersion: 1,
        caseId: "long_horizon_process_write_compensation_v1",
        caseSha256: "0".repeat(64),
        contentSha256: "0".repeat(64),
      },
    );
    expect(verification).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["result_shape_invalid", "ledger_shape_invalid"],
      }),
    );
  });

  it("rejects an empty or malformed Series before resolving artifact paths", () => {
    const malformed = {
      kind: "napier.process-recovery-benchmark-series",
      schemaVersion: 1,
      trials: [],
    };
    expect(verifyProcessRecoveryBenchmarkSeries(malformed, [])).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["series_shape_invalid"],
        trialDiagnostics: [],
      }),
    );
    expect(() => processRecoverySeriesArtifactReferences(malformed)).toThrow(
      "Process recovery Series is invalid",
    );
  });

  it("runs a real failed scoped write, compensates it, and reopens evidence", async () => {
    const outputDir = await createOutputRoot();
    const artifacts = await runProcessRecoveryBenchmark(
      { caseRoot: CASE_ROOT, outputDir },
      {
        createSandbox: createTrustedOuterProcessBenchmarkSandbox,
        now: () => new Date("2026-08-04T00:00:00.000Z"),
      },
    );
    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        executor: expect.objectContaining({
          sandboxBoundary: "trusted_outer_test",
        }),
        evaluation: expect.objectContaining({
          processStatus: "failed",
          processExitCode: 17,
          workspaceCompensationStatus: "restored",
          targetRestored: true,
          recoveredAfterReopen: true,
          replayValid: true,
          diagnostics: [],
        }),
      }),
    );
    expect(artifacts.bundle.processEvents.map((event) => event.type)).toEqual([
      "workspace.process.started",
      "workspace.process.settled",
      "workspace.process.rollback_started",
      "workspace.process.rolled_back",
    ]);
    expect(artifacts.bundle.target.finalSha256).toBe(
      artifacts.bundle.target.initialSha256,
    );
    expect(artifacts.bundle.target.mutatedSha256).not.toBe(
      artifacts.bundle.target.initialSha256,
    );
    expect(
      verifyProcessRecoveryBenchmarkArtifacts(
        artifacts.result,
        artifacts.bundle,
      ),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
      }),
    );
    expect(await readFile(artifacts.resultPath, "utf8")).toContain(
      artifacts.result.contentSha256,
    );
    expect(await readFile(artifacts.ledgerPath, "utf8")).toContain(
      artifacts.bundle.contentSha256,
    );
    const serialized = JSON.stringify({
      result: artifacts.result,
      bundle: artifacts.bundle,
    });
    expect(serialized).not.toContain("baseline-v1");
    expect(serialized).not.toContain("uncommitted-v2");
    expect(serialized).not.toContain("generated/result.txt");
  });

  it("detects restoration tampering even when outer hashes are recomputed", async () => {
    const outputDir = await createOutputRoot();
    const artifacts = await runProcessRecoveryBenchmark(
      { caseRoot: CASE_ROOT, outputDir },
      {
        createSandbox: createTrustedOuterProcessBenchmarkSandbox,
        now: () => new Date("2026-08-04T00:00:00.000Z"),
      },
    );
    const bundle = structuredClone(artifacts.bundle);
    bundle.target.finalSha256 = bundle.target.mutatedSha256;
    rehash(bundle);
    const result = structuredClone(artifacts.result);
    result.ledger.bundleSha256 = bundle.contentSha256;
    result.ledger.bundleFileName = processRecoveryLedgerFileName(
      result.caseId,
      bundle.contentSha256,
    );
    result.ledger.bundleBytes = Buffer.byteLength(
      `${JSON.stringify(bundle, null, 2)}\n`,
      "utf8",
    );
    rehash(result);
    expect(
      processRecoveryResultFileName(result.caseId, result.contentSha256),
    ).toMatch(/^napier-process-recovery-benchmark-result-/u);
    expect(verifyProcessRecoveryBenchmarkArtifacts(result, bundle)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "evaluation_evidence_mismatch",
          "target_binding_mismatch",
        ]),
      }),
    );
  });

  it("binds multiple independent trials into a verifiable Series", async () => {
    const outputDir = await createOutputRoot();
    const artifacts = await runProcessRecoveryBenchmarkSeries(
      { caseRoot: CASE_ROOT, outputDir, trialCount: 2 },
      {
        createSandbox: createTrustedOuterProcessBenchmarkSandbox,
        now: () => new Date("2026-08-04T00:00:00.000Z"),
      },
    );
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        completedTrialCount: 2,
        passedTrialCount: 2,
        failedTrialCount: 0,
        successRate: 1,
        passRate: 1,
      }),
    );
    expect(
      verifyProcessRecoveryBenchmarkSeries(artifacts.series, artifacts.trials),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        trialDiagnostics: [],
      }),
    );
    const tampered = structuredClone(artifacts.series);
    tampered.trials[0]!.ledgerFileName = "substituted-ledger.json";
    const { contentSha256: _contentSha256, ...content } = tampered;
    tampered.contentSha256 = sha256(
      canonicalJson(content as unknown as JsonValue),
    );
    expect(
      verifyProcessRecoveryBenchmarkSeries(tampered, artifacts.trials),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["series_trial_invalid"]),
        trialDiagnostics: [
          expect.objectContaining({
            index: 1,
            diagnostics: expect.arrayContaining(["trial_binding_mismatch"]),
          }),
        ],
      }),
    );
  });
});

async function createOutputRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-process-bench-test-"));
  temporaryRoots.push(root);
  return root;
}

function rehash<
  T extends ProcessRecoveryBenchmarkResult | ProcessRecoveryBenchmarkLedger,
>(value: T): void {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content as unknown as JsonValue));
}
