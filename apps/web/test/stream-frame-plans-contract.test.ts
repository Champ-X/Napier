import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame Plan contract", () => {
  it("rejects projected Plan steps containing private fields", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: {
            id: "event_1",
            threadId: "thread_1",
            runId: "run_1",
            seq: 1,
            type: "model.text.delta",
            category: "model",
            visibility: "user",
            createdAt: "2026-08-16T00:00:01.000Z",
            payload: { delta: "hello" },
          },
          projections: {
            conversationPlans: [
              {
                id: "event_plan",
                seq: 1,
                createdAt: "2026-08-16T00:00:01.000Z",
                attemptScope: "current",
                plan: {
                  id: "plan_fixture0001",
                  status: "active",
                  revision: 1,
                  objective: "Verify",
                  steps: [
                    {
                      id: "step_verify",
                      title: "Verify",
                      description: "PRIVATE_DESCRIPTION",
                      status: "running",
                      evidenceRecorded: false,
                    },
                  ],
                  activePhaseIndex: 0,
                  phaseCount: 1,
                },
                completedStepCount: 0,
                settledStepCount: 0,
                verifiedArtifactCount: 0,
                producedArtifactCount: 0,
                missingArtifactCount: 0,
              },
            ],
          },
        },
        {
          snapshot: () => true,
          error: () => true,
          done: () => true,
        },
      ),
    ).toBe("invalid_event");
  });
});
