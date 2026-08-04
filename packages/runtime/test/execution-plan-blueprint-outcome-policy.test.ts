import type { ExecutionPlanBlueprintRecordOutcomeBaseline } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createExecutionPlanBlueprintOutcomeQualification,
  DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY,
  DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE,
  executionPlanBlueprintOutcomePolicyDiagnostics,
  normalizeExecutionPlanBlueprintOutcomeBaselinePolicy,
  normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate,
} from "../src/execution-plan-blueprint-outcome-policy.js";
import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcomes,
} from "../src/execution-plan-blueprint-replay-projection.js";

const RECORD_ID = "blueprint_record_1";
const DIGEST = "a".repeat(64);

describe("Execution Plan Blueprint outcome policy", () => {
  it("normalizes bounded defaults and rejects invalid policy values", () => {
    expect(normalizeExecutionPlanBlueprintOutcomeBaselinePolicy()).toEqual(
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY,
    );
    expect(normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate()).toEqual(
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE,
    );
    expect(
      normalizeExecutionPlanBlueprintOutcomeBaselinePolicy({
        minReplayCount: 2,
        maxBlockedCount: 1,
      }),
    ).toEqual({
      minReplayCount: 2,
      minCompletionRateBps: 10_000,
      maxBlockedCount: 1,
      maxInvalidCount: 0,
    });
    expect(() =>
      normalizeExecutionPlanBlueprintOutcomeBaselinePolicy({
        minCompletionRateBps: 10_001,
      }),
    ).toThrow("outcome baseline policy is invalid");
    expect(() =>
      normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate({
        minScore: 101,
      }),
    ).toThrow("outcome baseline review gate is invalid");
  });

  it("orders diagnostics and projects missing or failed qualification", () => {
    const history = createExecutionPlanBlueprintRecordReplayHistory(
      RECORD_ID,
      [],
    );
    const outcomes = createExecutionPlanBlueprintRecordReplayOutcomes(
      RECORD_ID,
      history.contentSha256,
      [],
    );
    expect(
      executionPlanBlueprintOutcomePolicyDiagnostics(outcomes, {
        minReplayCount: 1,
        minCompletionRateBps: 10_000,
        maxBlockedCount: 0,
        maxInvalidCount: 0,
      }),
    ).toEqual(["replay_count_below_min", "completion_rate_below_min"]);
    expect(
      createExecutionPlanBlueprintOutcomeQualification(
        RECORD_ID,
        outcomes,
        undefined,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "missing_baseline",
        diagnostics: ["baseline_missing"],
      }),
    );
    expect(
      createExecutionPlanBlueprintOutcomeQualification(
        RECORD_ID,
        outcomes,
        baseline(),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["replay_count_below_min", "completion_rate_below_min"],
        baselineId: "outcome_base_1",
      }),
    );
  });
});

function baseline(): ExecutionPlanBlueprintRecordOutcomeBaseline {
  return {
    id: "outcome_base_1",
    recordId: RECORD_ID,
    replayOutcomesSha256: DIGEST,
    replayHistorySha256: DIGEST,
    outcomeSetSha256: DIGEST,
    replayCount: 1,
    completedCount: 1,
    blockedCount: 0,
    invalidCount: 0,
    completionRateBps: 10_000,
    policy: DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY,
    promotedAt: "2026-08-04T00:00:00.000Z",
    contentSha256: DIGEST,
  };
}
