import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { verifyCodingExecutorComparison } from "./check-coding-executor-comparison.mjs";

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

  it("verifies the seeded comparison as Napier not worse", async () => {
    await expect(
      verifyCodingExecutorComparison(seededArtifact),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        caseCount: 3,
        verdict: "napier_not_worse",
        napierOfficialPassed: 3,
        ompHiddenOutcomePassed: 3,
      }),
    );
  });
});
