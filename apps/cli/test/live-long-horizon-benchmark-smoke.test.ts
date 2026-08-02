import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyWorkflowBenchmarkArtifacts } from "../src/workflow-benchmark-contract.js";
import { runWorkflowBenchmark } from "../src/workflow-benchmark.js";

const describeLive =
  process.env["NAPIER_LIVE_LONG_HORIZON_BENCHMARK"] === "1"
    ? describe
    : describe.skip;
const roots: string[] = [];
const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/restart-approval-map-reduce-v1",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek Long-horizon outcome benchmark", () => {
  it("recovers Approval and reuses Map Runs after Runtime restart", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live Long-horizon benchmark",
      );
    }
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-long-horizon-benchmark-"),
    );
    roots.push(outputDir);
    const artifacts = await runWorkflowBenchmark({
      caseRoot: CASE_ROOT,
      outputDir,
      model: {
        provider: "deepseek",
        id: process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash",
      },
      env: { DEEPSEEK_API_KEY: apiKey },
      credentialEnv: "DEEPSEEK_API_KEY",
    });

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        evaluation: expect.objectContaining({
          schemaVersion: 4,
          outputMatch: true,
          mapOutputMatch: true,
          runtimeRestartCount: 1,
          approvalRecovered: true,
          completedMapRunsReused: true,
          postRestartModelResponseCount: 0,
          replayValid: true,
          credentialLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    expect(
      verifyWorkflowBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    expect(JSON.stringify(artifacts)).not.toContain(apiKey);
  }, 180_000);
});
