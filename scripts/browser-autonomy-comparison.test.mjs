import { describe, expect, it } from "vitest";

import {
  createBrowserAutonomyComparison,
  summarizeBrowserAutonomyTrials,
  verifyBrowserAutonomyComparison,
} from "./browser-autonomy-comparison.mjs";

describe("Browser autonomy comparison", () => {
  it("locks same-model, same-prompt, isolated alternating Trial evidence", () => {
    const trials = [
      pair(1, "passed", "passed"),
      pair(2, "passed", "failed"),
      pair(3, "failed", "passed"),
    ];
    const report = createBrowserAutonomyComparison(content(trials));
    expect(verifyBrowserAutonomyComparison(report)).toEqual({
      valid: true,
      diagnostics: [],
      reportSha256: report.contentSha256,
      summary: expect.objectContaining({
        pairCount: 3,
        decisivePairCount: 3,
        napierPassed: 2,
        browserUsePassed: 2,
        verdict: "napier_not_worse",
      }),
    });
    expect(
      verifyBrowserAutonomyComparison({ ...report, trialCount: 2 }),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "report_hash_invalid",
          "trials_invalid",
        ]),
      }),
    );
  });

  it("does not claim a result when infrastructure is excluded or Browser Use wins", () => {
    expect(
      summarizeBrowserAutonomyTrials([
        pair(1, "infrastructure_failure", "passed"),
      ]).verdict,
    ).toBe("not_proven");
    expect(
      summarizeBrowserAutonomyTrials([pair(1, "failed", "passed")]).verdict,
    ).toBe("napier_below_baseline");
  });
});

function content(trials) {
  return {
    type: "napier.browser-autonomy-comparison",
    schemaVersion: 1,
    generatedAt: "2026-08-13T00:00:00.000Z",
    seed: 20260813,
    trialCount: trials.length,
    timeoutMs: 180_000,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    case: {
      caseId: "open_web_20260813_browser",
      taskFamily: "dynamic_browser_evidence",
      promptSha256: "1".repeat(64),
      oracleSha256: "2".repeat(64),
      caseSha256: "3".repeat(64),
    },
    fairness: {
      sameModel: true,
      samePrompt: true,
      freshProfilePerTrial: true,
      isolatedStatePerExecutor: true,
      sameReadOnlyPolicy: true,
      alternatingOrder: true,
    },
    environment: {
      platform: "darwin",
      architecture: "arm64",
      nodeVersion: "24.16.0",
      napierVersion: "0.1.0",
      browserUseVersion: "0.13.7",
      browserProduct: "system_chrome",
      browserVersion: "140.0.0.0",
    },
    trials,
    summary: summarizeBrowserAutonomyTrials(trials),
    notes: ["Narrow retained evidence."],
  };
}

function pair(trial, napierStatus, browserUseStatus) {
  return {
    trial,
    order:
      trial % 2 === 1
        ? ["napier", "browser_use_local"]
        : ["browser_use_local", "napier"],
    napier: outcome("napier", napierStatus),
    browserUse: outcome("browser_use_local", browserUseStatus),
  };
}

function outcome(executor, status) {
  return {
    executor,
    status,
    outcomePassed: status === "passed",
    durationMs: 1_000,
    stepCount: 2,
    toolFailureCount: 0,
    secretLeakDetected: false,
    freshProfile: true,
    finalOutputSha256: "4".repeat(64),
    diagnosticSetSha256: "5".repeat(64),
    costUsd: 0.01,
    totalTokens: 100,
  };
}
