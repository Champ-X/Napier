import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import type { WebThreadDetail } from "../src/api";
import { conversationFeedProjection } from "../src/conversation-feed-projection";

describe("conversationFeedProjection live thinking", () => {
  it("uses the streamed thread state when the final run record is not present yet", () => {
    const events = [
      event(1, "turn.started"),
      event(2, "route_attempt_started"),
      event(3, "context.model_invocation"),
    ];
    const projection = conversationFeedProjection([], {
      thread: {
        id: "thread_live",
        status: "running",
        currentRunId: "run_live",
      },
      runs: [],
      plans: [],
      events,
      operatorDecisions: [],
      subagents: [],
      automaticRecoveryAssessments: [],
      automaticRecoveryAttempts: [],
    } as unknown as WebThreadDetail);

    expect(projection.activeThinkingId).toBe("event_1");
    expect(projection.feed).toEqual([
      expect.objectContaining({
        kind: "activity-group",
        items: [
          expect.objectContaining({
            kind: "thinking",
            activity: expect.objectContaining({
              id: "event_1",
              startedAt: "2026-08-31T00:00:01.000Z",
            }),
          }),
        ],
      }),
    ]);
  });
});

function event(seq: number, type: string): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_live",
    runId: "run_live",
    seq,
    type,
    category: type.startsWith("model.") ? "model" : "lifecycle",
    visibility: "debug",
    createdAt: `2026-08-31T00:00:0${String(seq)}.000Z`,
    payload: {},
  };
}
