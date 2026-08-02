import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCodingBenchmark } from "../src/coding-benchmark.js";

const describeLive =
  process.env["NAPIER_LIVE_CODING_BENCHMARK"] === "1"
    ? describe
    : describe.skip;
const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/shipping-boundary-v1",
);
const MULTI_FILE_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/pricing-options-migration-v1",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek coding outcome benchmark", () => {
  it("fixes and deterministically scores the shipping boundary task", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live coding benchmark",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-coding-benchmark-"),
    );
    temporaryRoots.push(outputDir);

    const artifacts = await runCodingBenchmark({
      caseRoot: CASE_ROOT,
      outputDir,
      model: { provider: "deepseek", id: modelId },
      env: { DEEPSEEK_API_KEY: apiKey },
      credentialEnv: "DEEPSEEK_API_KEY",
      timeoutMs: 120_000,
    });

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        model: { provider: "deepseek", id: modelId },
        tooling: expect.objectContaining({
          applyPatchCompleted: true,
          started: expect.any(Number),
        }),
        evaluation: expect.objectContaining({
          status: "passed",
          diagnostics: [],
        }),
      }),
    );
    const serialized = await Promise.all([
      readFile(artifacts.resultPath, "utf8"),
      readFile(artifacts.ledgerPath, "utf8"),
    ]);
    expect(serialized.join("\n")).not.toContain(apiKey);
  }, 180_000);

  it("migrates the multi-file pricing API and every call site", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live coding benchmark",
      );
    }
    const modelId =
      process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-coding-multifile-"),
    );
    temporaryRoots.push(outputDir);

    const artifacts = await runCodingBenchmark({
      caseRoot: MULTI_FILE_CASE_ROOT,
      outputDir,
      model: { provider: "deepseek", id: modelId },
      env: { DEEPSEEK_API_KEY: apiKey },
      credentialEnv: "DEEPSEEK_API_KEY",
      timeoutMs: 120_000,
    });

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        model: { provider: "deepseek", id: modelId },
        tooling: expect.objectContaining({
          applyPatchCompleted: true,
          started: expect.any(Number),
          completed: expect.any(Number),
        }),
        evaluation: expect.objectContaining({
          status: "passed",
          changedFileCount: 3,
          diagnostics: [],
        }),
      }),
    );
    const serialized = await Promise.all([
      readFile(artifacts.resultPath, "utf8"),
      readFile(artifacts.ledgerPath, "utf8"),
    ]);
    expect(serialized.join("\n")).not.toContain(apiKey);
  }, 180_000);
});
