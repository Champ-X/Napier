import type { ExecutionPlanBlueprintRecordOutcomeReview } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { createExecutionPlanBlueprintOutcomeQualification } from "../src/execution-plan-blueprint-outcome-policy.js";
import {
  createExecutionPlanBlueprintOutcomeBaselineReviewEvidence,
  validateExecutionPlanBlueprintOutcomeReview,
} from "../src/execution-plan-blueprint-outcome-review-evidence.js";
import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcomes,
} from "../src/execution-plan-blueprint-replay-projection.js";
import { storeCanonicalJson, storeSha256 } from "../src/store-hashing.js";

const RECORD_ID = "blueprint_record_1";
const DIGEST = "a".repeat(64);

describe("Execution Plan Blueprint outcome review evidence", () => {
  it("validates a hash-bound review and creates promotion evidence", () => {
    const outcomes = emptyOutcomes();
    const review = reviewArtifact(outcomes);
    expect(validateExecutionPlanBlueprintOutcomeReview(review)).toEqual(review);
    expect(
      createExecutionPlanBlueprintOutcomeBaselineReviewEvidence({
        recordId: RECORD_ID,
        review,
        outcomes,
        sourceQualification: sourceQualification(),
        outcomeQualification: createExecutionPlanBlueprintOutcomeQualification(
          RECORD_ID,
          outcomes,
          undefined,
        ),
        reviewGate: { minScore: 80, maxRisk: "medium" },
      }),
    ).toEqual(
      expect.objectContaining({
        reviewSha256: review.reviewSha256,
        reviewVerdict: "promote",
        reviewScore: 90,
        reviewRisk: "low",
      }),
    );
    expect(() =>
      validateExecutionPlanBlueprintOutcomeReview({
        ...review,
        score: 91,
      }),
    ).toThrow("outcome review hash mismatch");
  });

  it("preserves ordered identity and review-gate diagnostics", () => {
    const outcomes = emptyOutcomes();
    const review = reviewArtifact(outcomes, {
      recordId: "blueprint_record_other",
      score: 10,
      risk: "high",
    });
    expect(() =>
      createExecutionPlanBlueprintOutcomeBaselineReviewEvidence({
        recordId: RECORD_ID,
        review,
        outcomes,
        sourceQualification: sourceQualification(),
        outcomeQualification: createExecutionPlanBlueprintOutcomeQualification(
          RECORD_ID,
          outcomes,
          undefined,
        ),
        reviewGate: { minScore: 80, maxRisk: "medium" },
      }),
    ).toThrow(
      "review failed: record_mismatch,review_score_below_min,review_risk_above_max",
    );
  });
});

function emptyOutcomes() {
  const history = createExecutionPlanBlueprintRecordReplayHistory(
    RECORD_ID,
    [],
  );
  return createExecutionPlanBlueprintRecordReplayOutcomes(
    RECORD_ID,
    history.contentSha256,
    [],
  );
}

function sourceQualification() {
  return {
    status: "qualified" as const,
    diagnostics: [],
    recordId: RECORD_ID,
    blueprintSha256: DIGEST,
    stepCount: 1,
    artifactCount: 0,
    qualifiedAt: "2026-08-04T00:00:00.000Z",
  };
}

function reviewArtifact(
  outcomes: ReturnType<typeof emptyOutcomes>,
  overrides: Partial<ExecutionPlanBlueprintRecordOutcomeReview> = {},
): ExecutionPlanBlueprintRecordOutcomeReview {
  const content = {
    kind: "napier.execution-plan-blueprint-outcome-review" as const,
    schemaVersion: 1 as const,
    policyId: "napier.blueprint-outcome-review.v1",
    recordId: RECORD_ID,
    blueprintSha256: DIGEST,
    model: { provider: "napier", id: "demo" },
    criteria: { name: "Delivery", criteria: [] },
    verdict: "promote" as const,
    score: 90,
    risk: "low" as const,
    reason: "Bound review.",
    concerns: [],
    scores: [],
    sourceQualificationStatus: "qualified" as const,
    outcomeQualificationStatus: "missing_baseline" as const,
    replayOutcomesSha256: outcomes.contentSha256,
    replayHistorySha256: outcomes.replayHistorySha256,
    outcomeSetSha256: outcomes.outcomeSetSha256,
    replayCount: outcomes.replayCount,
    completedCount: outcomes.completedCount,
    blockedCount: outcomes.blockedCount,
    invalidCount: outcomes.invalidCount,
    completionRateBps: outcomes.completionRateBps,
    inputSha256: DIGEST,
    promptSha256: DIGEST,
    responseSha256: DIGEST,
    reviewSchemaSha256: DIGEST,
    createdAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
  return {
    ...content,
    reviewSha256: storeSha256(storeCanonicalJson(content)),
  };
}
