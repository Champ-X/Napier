import { describe, expect, it } from "vitest";

import type { RunRecord } from "@napier/contracts";

import { createEvaluationCasebook } from "../src/evaluation-casebooks.js";
import {
  evaluationCasebookTemplates,
  RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
} from "../src/evaluation-casebook-templates.js";
import {
  createReleaseProductTrial,
  NAPIER_PRODUCT_VERSION,
  parseReleaseProductTrial,
  projectReleaseProductGate,
} from "../src/release-product-gate.js";

describe("Release Product Gate", () => {
  it("requires fixed coverage, 90% success, critical cases, and three current versions", () => {
    const casebook = createEvaluationCasebook({
      name: "Release Product Casebook",
      templateId: RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
    });
    const cases = evaluationCasebookTemplates()[0]!.cases;
    const trials = ["0.0.9", "0.1.0", NAPIER_PRODUCT_VERSION].flatMap(
      (productVersion, versionIndex) =>
        cases.map((item, caseIndex) =>
          createReleaseProductTrial(
            casebook,
            completedRun(
              `run_release_${String(versionIndex)}_${String(caseIndex)}`,
            ),
            {
              casebookId: casebook.id,
              templateCaseId: item.id,
              runId: `run_release_${String(versionIndex)}_${String(caseIndex)}`,
              productVersion,
              status: "passed",
              configurationInterventions: caseIndex === 0 ? 1 : 0,
              humanInterventions: 0,
              recoveryEvents: item.id === "long-task-recovery" ? 1 : 0,
              uxScore: 4,
            },
            {
              id: `release_trial_${String(versionIndex).padStart(2, "0")}${String(caseIndex).padStart(6, "0")}`,
              recordedAt: `2026-08-${String(10 + versionIndex).padStart(2, "0")}T00:${String(caseIndex).padStart(2, "0")}:00.000Z`,
              currentProductVersion: productVersion,
            },
          ),
        ),
    );

    const projection = projectReleaseProductGate(casebook, trials);
    expect(projection.defaultTrackReady).toBe(true);
    expect(projection.consecutivePassingVersions).toEqual([
      "0.0.9",
      "0.1.0",
      NAPIER_PRODUCT_VERSION,
    ]);
    expect(projection.versions.at(-1)).toEqual(
      expect.objectContaining({
        productVersion: NAPIER_PRODUCT_VERSION,
        coveredCaseCount: 10,
        successRate: 1,
        meanUxScore: 4,
        configurationInterventions: 1,
        recoveryEvents: 1,
        status: "passed",
      }),
    );

    const criticalFailure = {
      ...trials.at(-6)!,
      status: "failed" as const,
      failureReason: "manual_intervention" as const,
      contentSha256: "",
    };
    const correctedFailure = createReleaseProductTrial(
      casebook,
      completedRun(criticalFailure.runId),
      {
        casebookId: casebook.id,
        templateCaseId: "high-risk-confirmation",
        runId: criticalFailure.runId,
        productVersion: NAPIER_PRODUCT_VERSION,
        status: "failed",
        failureReason: "manual_intervention",
        configurationInterventions: 0,
        humanInterventions: 1,
        recoveryEvents: 0,
        uxScore: 2,
      },
      {
        id: criticalFailure.id,
        recordedAt: criticalFailure.recordedAt,
        currentProductVersion: NAPIER_PRODUCT_VERSION,
      },
    );
    const failed = projectReleaseProductGate(casebook, [
      ...trials.slice(0, -6),
      correctedFailure,
      ...trials.slice(-5),
    ]);
    expect(failed.defaultTrackReady).toBe(false);
    expect(failed.versions.at(-1)).toEqual(
      expect.objectContaining({
        successRate: 0.9,
        failedCriticalCaseIds: ["high-risk-confirmation"],
        status: "failed",
      }),
    );
  });

  it("rejects tampered durable trial payloads", () => {
    const casebook = createEvaluationCasebook({
      name: "Release",
      templateId: RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
    });
    const trial = createReleaseProductTrial(
      casebook,
      completedRun("run_releaseparse01"),
      {
        casebookId: casebook.id,
        templateCaseId: "settings",
        runId: "run_releaseparse01",
        productVersion: NAPIER_PRODUCT_VERSION,
        status: "passed",
        configurationInterventions: 0,
        humanInterventions: 0,
        recoveryEvents: 0,
        uxScore: 5,
      },
      { id: "release_trial_00000001", recordedAt: "2026-08-13T00:00:00.000Z" },
    );
    expect(parseReleaseProductTrial(trial)).toEqual(trial);
    expect(parseReleaseProductTrial({ ...trial, uxScore: 1 })).toBeUndefined();
  });

  it("binds new trials to the running version and scores the latest Case outcome", () => {
    const casebook = createEvaluationCasebook({
      name: "Release",
      templateId: RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
    });
    const request = {
      casebookId: casebook.id,
      templateCaseId: "settings",
      productVersion: NAPIER_PRODUCT_VERSION,
      configurationInterventions: 0,
      humanInterventions: 0,
      recoveryEvents: 0,
      uxScore: 5,
    } as const;
    expect(() =>
      createReleaseProductTrial(casebook, completedRun("run_releasewrong01"), {
        ...request,
        runId: "run_releasewrong01",
        productVersion: "0.0.9",
        status: "passed",
      }),
    ).toThrow(`running product version: ${NAPIER_PRODUCT_VERSION}`);
    const failed = createReleaseProductTrial(
      casebook,
      completedRun("run_releaseattempt1"),
      {
        ...request,
        runId: "run_releaseattempt1",
        status: "failed",
        failureReason: "task_result",
        uxScore: 2,
      },
      { recordedAt: "2026-08-13T00:00:00.000Z" },
    );
    const passed = createReleaseProductTrial(
      casebook,
      completedRun("run_releaseattempt2"),
      { ...request, runId: "run_releaseattempt2", status: "passed" },
      { recordedAt: "2026-08-13T00:01:00.000Z" },
    );
    expect(
      projectReleaseProductGate(casebook, [failed, passed]).versions[0],
    ).toMatchObject({
      coveredCaseCount: 1,
      trialCount: 1,
      passedCount: 1,
      failedCount: 0,
      successRate: 1,
      meanUxScore: 5,
    });
  });
});

function completedRun(id: string): RunRecord {
  return {
    id,
    threadId: "thread_release01",
    agentId: "agent_release01",
    status: "completed",
    startedAt: "2026-08-13T00:00:00.000Z",
    finishedAt: "2026-08-13T00:01:00.000Z",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}
