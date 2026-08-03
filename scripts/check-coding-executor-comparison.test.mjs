import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  calculateCodingExecutorComparisonSummary,
  verifyCodingExecutorComparison,
  verifyCodingExecutorComparisonSet,
} from "./check-coding-executor-comparison.mjs";

const artifact = JSON.parse(
  await readFile(
    new URL(
      "../docs/artifacts/benchmarks/napier-omp-coding-comparison-calibration-20260804.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const seededArtifact = JSON.parse(
  await readFile(
    new URL(
      "../docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260804.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const secondSeedArtifact = JSON.parse(
  await readFile(
    new URL(
      "../docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260805.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const structuralSeedArtifact = JSON.parse(
  await readFile(
    new URL(
      "../docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260806.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("coding executor comparison verifier", () => {
  it("verifies the committed calibration without overstating its verdict", async () => {
    await expect(verifyCodingExecutorComparison(artifact)).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        caseCount: 3,
        verdict: "not_proven",
        outerOutcomeVerdict: "napier_not_worse",
        napierOfficialPassed: 0,
        napierOuterHiddenOutcomePassed: 3,
        ompHiddenOutcomePassed: 2,
      }),
    );
  });

  it("rejects substituted summaries and sensitive fields", async () => {
    const tampered = structuredClone(artifact);
    tampered.summary.verdict = "napier_not_worse";
    tampered.model.apiKey = "must-not-appear";
    tampered.cases[0].napier.usage = {
      inputTokens: 100,
      outputTokens: 20,
    };

    await expect(verifyCodingExecutorComparison(tampered)).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          "summary_mismatch",
          "sensitive_key_present",
        ]),
      }),
    );
  });

  it("permits token-count metrics without treating them as credentials", async () => {
    const withUsage = structuredClone(secondSeedArtifact);
    withUsage.cases[0].napier.usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    };

    await expect(verifyCodingExecutorComparison(withUsage)).resolves.toEqual(
      expect.objectContaining({ valid: true, errors: [] }),
    );
  });

  it("verifies the remediated seeded multi-trial comparison", async () => {
    await expect(
      verifyCodingExecutorComparison(seededArtifact),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        caseCount: 3,
        verdict: "napier_not_worse",
        napierOfficialPassed: 3,
        napierTrialPassed: 6,
        ompTrialPassed: 6,
        ompHiddenOutcomePassed: 3,
      }),
    );
  });

  it("verifies an independent seed with complete semantic matches", async () => {
    await expect(
      verifyCodingExecutorComparison(secondSeedArtifact),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        verdict: "napier_not_worse",
        napierOfficialPassed: 3,
        napierCanonicalTargetMatches: 3,
      }),
    );
  });

  it("accepts an extended seed with a distinct structural family", async () => {
    const extended = structuredClone(secondSeedArtifact);
    extended.taskSelection.profile = "extended_v1";
    extended.cases[0].taskFamily = "boundary_repair";
    extended.cases[1].taskFamily = "api_migration";
    extended.cases[2].taskFamily = "runtime_debugging";
    extended.cases.push({
      ...structuredClone(extended.cases[2]),
      caseId: "coding_seed_20260805_async_concurrency",
      caseSha256: "f".repeat(64),
      taskFamily: "test_guided_concurrency",
    });
    const requiredFollowUps = extended.summary.requiredFollowUps;
    extended.summary = {
      ...calculateCodingExecutorComparisonSummary(
        extended.environment,
        extended.cases,
      ),
      requiredFollowUps,
    };

    await expect(verifyCodingExecutorComparison(extended)).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        caseCount: 4,
        verdict: "napier_not_worse",
        resources: expect.objectContaining({
          sampleCount: 4,
          comparableUsageSampleCount: 0,
        }),
      }),
    );
  });

  it("verifies the real structural seed and resource evidence", async () => {
    await expect(
      verifyCodingExecutorComparison(structuralSeedArtifact),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        caseCount: 4,
        napierTrialPassed: 4,
        ompTrialPassed: 3,
        resources: expect.objectContaining({
          napierUsageSampleCount: 4,
          ompUsageSampleCount: 0,
          napierInputTokens: 40_133,
          napierOutputTokens: 19_225,
          napierCostUsd: 0.0118058696,
        }),
        verdict: "napier_not_worse",
      }),
    );
  });

  it("rejects extended profiles without complete unique family bindings", async () => {
    const incomplete = structuredClone(secondSeedArtifact);
    incomplete.taskSelection.profile = "extended_v1";
    incomplete.cases[0].taskFamily = "boundary_repair";
    incomplete.cases[1].taskFamily = "api_migration";
    incomplete.cases[2].taskFamily = "api_migration";

    await expect(verifyCodingExecutorComparison(incomplete)).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining(["task_family_set_invalid"]),
      }),
    );
  });

  it("recomputes the cross-seed pass and latency evidence", async () => {
    await expect(
      verifyCodingExecutorComparisonSet([
        artifact,
        seededArtifact,
        secondSeedArtifact,
        structuralSeedArtifact,
      ]),
    ).resolves.toEqual({
      valid: true,
      errors: [],
      seededReportCount: 3,
      caseCount: 10,
      trialCount: 13,
      napierPassed: 13,
      ompPassed: 12,
      napierLatencyWins: 10,
      verdict: "napier_not_worse",
    });
  });

  it("rejects duplicate seeds and cases in aggregate evidence", async () => {
    await expect(
      verifyCodingExecutorComparisonSet([seededArtifact, seededArtifact]),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        verdict: "not_proven",
        errors: expect.arrayContaining(["duplicate_seed", "duplicate_case"]),
      }),
    );
  });
});
