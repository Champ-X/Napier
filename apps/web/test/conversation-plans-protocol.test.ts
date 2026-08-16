import { describe, expect, it } from "vitest";

import { isConversationPlans } from "../src/conversation-plans-protocol";

describe("Conversation Plans protocol", () => {
  it("accepts minimal Plan cards and rejects private step fields", () => {
    const card = {
      id: "event_plan",
      seq: 2,
      createdAt: "2026-08-16T00:00:02.000Z",
      attemptScope: "current",
      plan: {
        id: "plan_fixture0001",
        status: "active",
        revision: 2,
        objective: "Verify current state",
        steps: [
          {
            id: "step_verify",
            title: "Verify",
            status: "running",
            evidenceRecorded: false,
          },
        ],
        activePhaseIndex: 0,
        phaseCount: 1,
      },
      completedStepCount: 0,
      settledStepCount: 0,
      runningStep: {
        id: "step_verify",
        title: "Verify",
        status: "running",
        evidenceRecorded: false,
      },
      verifiedArtifactCount: 0,
      producedArtifactCount: 0,
      missingArtifactCount: 0,
    };

    expect(isConversationPlans([card])).toBe(true);
    expect(
      isConversationPlans([
        {
          ...card,
          plan: {
            ...card.plan,
            steps: [
              { ...card.plan.steps[0], description: "PRIVATE_DESCRIPTION" },
            ],
          },
        },
      ]),
    ).toBe(false);
    expect(isConversationPlans(Array(5).fill(card))).toBe(false);
  });
});
