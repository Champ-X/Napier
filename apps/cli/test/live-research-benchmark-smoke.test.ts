import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyResearchBenchmarkArtifacts } from "../src/research-benchmark-contract.js";
import { runResearchBenchmark } from "../src/research-benchmark.js";

const describeLive =
  process.env["NAPIER_LIVE_RESEARCH_BENCHMARK"] === "1"
    ? describe
    : describe.skip;
const roots: string[] = [];
const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/research/aurora-contradiction-v1",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek Research outcome benchmark", () => {
  it("captures, cites, reconciles, and verifies fixed sources", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live Research benchmark",
      );
    }
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-research-benchmark-"),
    );
    roots.push(outputDir);
    const artifacts = await runResearchBenchmark({
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
          claimsMatch: true,
          citationEvidenceMatch: true,
          sourceCaptureMatch: true,
          captureCount: 3,
          citationCount: 7,
          primarySourceCount: 2,
          secondarySourceCount: 1,
          contradictionFound: true,
          reportVerified: true,
          replayValid: true,
          credentialLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    expect(
      verifyResearchBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    expect(JSON.stringify(artifacts)).not.toContain(apiKey);
  }, 180_000);
});
