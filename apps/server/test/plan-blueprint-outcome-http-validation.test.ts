import { describe, expect, it } from "vitest";

import {
  parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  parseReviewExecutionPlanBlueprintRecordOutcomesRequest,
} from "../src/plan-blueprint-outcome-http-validation.js";

describe("Plan Blueprint outcome HTTP validation", () => {
  it("parses bounded review criteria and rejects duplicate IDs", () => {
    const request = {
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      criteria: {
        name: "Delivery",
        criteria: [
          { id: "completion", name: "Completion", description: "Complete." },
          { id: "risk", name: "Risk", description: "Low risk." },
        ],
      },
    };
    expect(
      parseReviewExecutionPlanBlueprintRecordOutcomesRequest(request),
    ).toEqual(request);
    expect(
      parseReviewExecutionPlanBlueprintRecordOutcomesRequest({
        ...request,
        criteria: {
          ...request.criteria,
          criteria: [
            request.criteria.criteria[0],
            { ...request.criteria.criteria[1], id: "completion" },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      parseReviewExecutionPlanBlueprintRecordOutcomesRequest({
        ...request,
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it("bounds baseline policy and requires review evidence for review gates", () => {
    const outcomes = { kind: "outcomes" };
    expect(
      parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest({
        outcomes,
      }),
    ).toEqual({ outcomes, policy: {} });
    expect(
      parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest({
        outcomes,
        policy: {
          minReplayCount: 2,
          minCompletionRateBps: 9_000,
          maxBlockedCount: 0,
          maxInvalidCount: 0,
        },
      }),
    ).toEqual({
      outcomes,
      policy: {
        minReplayCount: 2,
        minCompletionRateBps: 9_000,
        maxBlockedCount: 0,
        maxInvalidCount: 0,
      },
    });
    expect(
      parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest({
        outcomes,
        reviewGate: { minScore: 80, maxRisk: "medium" },
      }),
    ).toBeUndefined();
    expect(
      parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest({
        outcomes,
        policy: { minCompletionRateBps: 10_001 },
      }),
    ).toBeUndefined();
  });
});
