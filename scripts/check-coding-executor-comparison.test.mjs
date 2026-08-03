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

describe("coding executor comparison verifier", () => {
  it("verifies the committed calibration without overstating its verdict", async () => {
    await expect(verifyCodingExecutorComparison(artifact)).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        caseCount: 3,
        verdict: "not_proven",
        napierOfficialPassed: 0,
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
});
