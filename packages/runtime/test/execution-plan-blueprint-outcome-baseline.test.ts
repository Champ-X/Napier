import { describe, expect, it } from "vitest";

import {
  createExecutionPlanBlueprintOutcomeBaseline,
  validateExecutionPlanBlueprintOutcomeBaseline,
} from "../src/execution-plan-blueprint-outcome-baseline.js";
import { DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY } from "../src/execution-plan-blueprint-outcome-policy.js";
import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcomes,
} from "../src/execution-plan-blueprint-replay-projection.js";

const RECORD_ID = "blueprint_record_1";

describe("Execution Plan Blueprint outcome baseline", () => {
  it("creates and validates a hash-bound baseline", () => {
    const baseline = createExecutionPlanBlueprintOutcomeBaseline({
      id: "outcome_base_1",
      recordId: RECORD_ID,
      outcomes: emptyOutcomes(),
      policy: {
        ...DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY,
        minCompletionRateBps: 0,
      },
      promotedAt: "2026-08-04T00:00:00.000Z",
    });

    expect(validateExecutionPlanBlueprintOutcomeBaseline(baseline)).toEqual(
      baseline,
    );
    expect(() =>
      validateExecutionPlanBlueprintOutcomeBaseline({
        ...baseline,
        replayCount: 1,
      }),
    ).toThrow("outcome baseline hash mismatch");
  });

  it("rejects partial review evidence before hash verification", () => {
    const baseline = createExecutionPlanBlueprintOutcomeBaseline({
      id: "outcome_base_2",
      recordId: RECORD_ID,
      outcomes: emptyOutcomes(),
      policy: DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY,
      promotedAt: "2026-08-04T00:00:00.000Z",
    });

    expect(() =>
      validateExecutionPlanBlueprintOutcomeBaseline({
        ...baseline,
        reviewSha256: "a".repeat(64),
      }),
    ).toThrow("outcome baseline is invalid");
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
