import { describe, expect, it } from "vitest";

import type {
  ControlledHarnessComparisonDomain,
  ControlledHarnessEvidenceContent,
} from "@napier/contracts/controlled-harness-evidence";

import {
  createControlledHarnessEvidence,
  parseControlledHarnessEvidence,
  projectControlledHarnessGate,
} from "../src/controlled-harness-evidence.js";

describe("Controlled Harness evidence", () => {
  it("keeps narrow or excluded competitor evidence blocked", () => {
    const evidence = createControlledHarnessEvidence(content());
    expect(evidence.controlledTrackReady).toBe(false);
    expect(evidence.blockers).toEqual([
      "sample_not_proven:browser_omp",
      "sample_not_proven:browser_autonomy",
      "quantified_advantage_not_proven",
    ]);
    expect(
      evidence.comparisonGates.find((gate) => gate.domain === "coding"),
    ).toMatchObject({
      sampleReady: true,
      verdict: "napier_not_worse",
      comparisonReady: true,
    });
  });

  it("requires all comparisons plus a quantified advantage", () => {
    const input = content();
    const browserOmp = input.comparisons.find(
      (comparison) => comparison.domain === "browser_omp",
    )!;
    browserOmp.trialCount = 3;
    browserOmp.decisiveTrialCount = 2;
    browserOmp.excludedTrialCount = 1;
    browserOmp.napierPassed = 2;
    browserOmp.napierOnlyPassed = 1;
    const browserUse = input.comparisons.find(
      (comparison) => comparison.domain === "browser_autonomy",
    )!;
    browserUse.trialCount = 3;
    browserUse.decisiveTrialCount = 3;
    browserUse.napierPassed = 3;
    browserUse.napierOnlyPassed = 3;
    input.advantage = {
      metric: "evidence",
      baseline: "omp",
      direction: "higher",
      unit: "verifiable_final_evidence_rate",
      napierValue: 1,
      baselineValue: 0.666667,
      napierSampleCount: 6,
      baselineSampleCount: 6,
      sourceArtifactSha256s: [input.sources[0]!.contentSha256],
    };
    const evidence = createControlledHarnessEvidence(input);
    expect(evidence.controlledTrackReady).toBe(true);
    expect(evidence.blockers).toEqual([]);
    expect(evidence.advantageGate).toMatchObject({
      baseline: "omp",
      unit: "verifiable_final_evidence_rate",
      advantageReady: true,
    });
    expect(
      projectControlledHarnessGate("casebook_release", [evidence], "0.1.0"),
    ).toMatchObject({
      evidenceCount: 1,
      controlledTrackReady: true,
      blockers: [],
    });
  });

  it("rejects a tampered self-reported verdict", () => {
    const evidence = createControlledHarnessEvidence(content());
    expect(
      parseControlledHarnessEvidence({
        ...evidence,
        controlledTrackReady: true,
      }),
    ).toBeUndefined();
  });
});

function content(): ControlledHarnessEvidenceContent {
  const openWebSha = "1".repeat(64);
  const codingSha = "2".repeat(64);
  const browserUseSha = "3".repeat(64);
  return {
    kind: "napier.controlled-harness-evidence",
    schemaVersion: 1,
    generatedAt: "2026-08-13T00:00:00.000Z",
    productVersion: "0.1.0",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    sources: [
      { role: "open_web_campaign", contentSha256: openWebSha },
      { role: "coding_seed", contentSha256: codingSha },
      { role: "browser_autonomy", contentSha256: browserUseSha },
    ],
    comparisons: [
      comparison("search", 2, 2, 2, 0, 1, 1, 1, 1, openWebSha),
      comparison("browser_omp", 2, 2, 1, 1, 1, 1, 0, 0, openWebSha),
      comparison("coding", 10, 13, 13, 0, 13, 12, 1, 0, codingSha),
      comparison("browser_autonomy", 1, 1, 1, 0, 1, 0, 1, 0, browserUseSha),
    ],
    advantage: {
      metric: "recovery",
      baseline: "omp",
      direction: "higher",
      unit: "successful_recovery_rate",
      napierValue: null,
      baselineValue: null,
      napierSampleCount: 0,
      baselineSampleCount: 0,
      sourceArtifactSha256s: [],
    },
  };
}

function comparison(
  domain: ControlledHarnessComparisonDomain,
  caseCount: number,
  trialCount: number,
  decisiveTrialCount: number,
  excludedTrialCount: number,
  napierPassed: number,
  baselinePassed: number,
  napierOnlyPassed: number,
  baselineOnlyPassed: number,
  sourceSha: string,
) {
  return {
    domain,
    baseline: domain === "browser_autonomy" ? "browser_use" : "omp",
    caseCount,
    trialCount,
    decisiveTrialCount,
    excludedTrialCount,
    napierPassed,
    baselinePassed,
    napierOnlyPassed,
    baselineOnlyPassed,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: [sourceSha],
  } as const;
}
