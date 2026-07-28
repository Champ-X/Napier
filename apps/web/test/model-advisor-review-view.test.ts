import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  independentModelAdvisorReviewViews,
  independentModelAdvisorVerificationState,
} from "../src/model-advisor-review-view";

describe("independent Model Advisor review views", () => {
  it("projects valid receipts in descending Ledger order", () => {
    const events = [
      event(4, {
        kind: "napier.independent-model-advisor-review",
        verdict: "accept",
        risk: "low",
        score: 94,
        reviewerModel: { provider: "reviewer", id: "model-2" },
        issues: [],
        diagnosticCodes: [],
        evidenceSummary: {
          verificationToolCompleted: true,
          verificationToolPassed: true,
          workspaceWriteCompleted: true,
          verificationToolPassedAfterWorkspaceWrite: false,
          planCompleted: true,
          planArtifactVerified: true,
          goalSatisfied: true,
          planCompletedAfterWorkspaceWrite: false,
          planArtifactVerifiedAfterWorkspaceWrite: false,
          goalSatisfiedAfterWorkspaceWrite: false,
          latestWorkspaceWriteSeq: 13,
          latestPassedVerificationSeq: 12,
          latestPlanCompletedSeq: 11,
          latestPlanInvalidatedSeq: 14,
          latestPlanArtifactVerifiedSeq: 10,
          latestPlanArtifactInvalidatedSeq: 14,
          latestGoalSatisfiedSeq: 9,
          latestGoalInvalidatedSeq: 15,
        },
        modelContextEnvelope: {
          contentSha256: "c".repeat(64),
        },
        contentSha256: "b".repeat(64),
      }),
      event(2, {
        kind: "napier.independent-model-advisor-review",
        verdict: "revise",
        risk: "medium",
        score: 62,
        reviewerModel: { provider: "reviewer", id: "model-1" },
        issues: [{ code: "evidence" }],
        diagnosticCodes: [],
        contentSha256: "a".repeat(64),
      }),
    ];

    const views = independentModelAdvisorReviewViews(events);
    expect(views).toEqual([
      {
        eventSeq: 4,
        verdict: "accept",
        risk: "low",
        score: 94,
        reviewerModel: "reviewer/model-2",
        issueCodes: [],
        diagnosticCodes: [],
        verificationToolCompleted: true,
        verificationToolPassed: true,
        workspaceWriteCompleted: true,
        verificationToolPassedAfterWorkspaceWrite: false,
        planCompleted: true,
        planArtifactVerified: true,
        goalSatisfied: true,
        planCompletedAfterWorkspaceWrite: false,
        planArtifactVerifiedAfterWorkspaceWrite: false,
        goalSatisfiedAfterWorkspaceWrite: false,
        latestWorkspaceWriteSeq: 13,
        latestPassedVerificationSeq: 12,
        latestPlanCompletedSeq: 11,
        latestPlanInvalidatedSeq: 14,
        latestPlanArtifactVerifiedSeq: 10,
        latestPlanArtifactInvalidatedSeq: 14,
        latestGoalSatisfiedSeq: 9,
        latestGoalInvalidatedSeq: 15,
        modelContextEnvelopeSha256: "c".repeat(64),
        contentSha256: "b".repeat(64),
      },
      expect.objectContaining({
        eventSeq: 2,
        verdict: "revise",
        issueCodes: ["evidence"],
      }),
    ]);
    expect(independentModelAdvisorVerificationState(views[0]!)).toBe(
      "checks stale / passed / w#13 / v#12 / plan stale / plan#11 / plan-invalidated#14 / artifact stale / artifact#10 / artifact-invalidated#14 / goal stale / goal#9 / goal-invalidated#15",
    );
    expect(views[1]).not.toHaveProperty("modelContextEnvelopeSha256");
  });

  it("ignores malformed or unrelated events", () => {
    expect(
      independentModelAdvisorReviewViews([
        event(1, {
          verdict: "accept",
          risk: "low",
          score: 100,
          reviewerModel: { provider: "reviewer", id: "model-1" },
          issues: [{ code: "unknown" }],
          diagnosticCodes: [],
          contentSha256: "a".repeat(64),
        }),
        {
          ...event(2, {}),
          type: "message.assistant",
        },
      ]),
    ).toEqual([]);
  });
});

function event(seq: number, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_review_${seq}`,
    threadId: "thread_review",
    runId: "run_review",
    seq,
    type: "model.advisor.independent.reviewed",
    category: "system",
    visibility: "debug",
    createdAt: "2026-07-28T00:00:00.000Z",
    payload,
  };
}
