import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyWorkflowBenchmarkArtifacts } from "../src/workflow-benchmark-contract.js";
import { runWorkflowBenchmark } from "../src/workflow-benchmark.js";

const describeLive =
  process.env["NAPIER_LIVE_DATA_BENCHMARK"] === "1" ? describe : describe.skip;
const roots: string[] = [];
const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/data/sqlite-metric-map-reduce-v1",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek Data outcome benchmark", () => {
  it("passes SQLite metrics and chart Map Reduce with private evidence", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live Data benchmark",
      );
    }
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-data-benchmark-"),
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
          outputMatch: true,
          mapOutputMatch: true,
          sqliteSchemaCompletedCount: 3,
          sqliteQueryCompletedCount: expect.any(Number),
          sqliteChartCompletedCount: expect.any(Number),
          sqliteProtocolValid: true,
          databaseUnchanged: true,
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
