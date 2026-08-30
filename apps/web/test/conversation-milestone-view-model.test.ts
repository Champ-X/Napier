import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationMilestone,
  conversationMilestones,
} from "../src/conversation-milestone-view-model";

describe("conversation milestones", () => {
  it("projects operator-facing progress content from durable milestone events", () => {
    expect(
      conversationMilestones([
        event(3, {
          kind: "napier.agent-milestone-recorded",
          schemaVersion: 1,
          milestoneId: "milestone_12345678",
          phase: "execution",
          title: "Implementation path confirmed",
          summary:
            "The existing milestone ledger can power progress updates without exposing private reasoning.",
          completedItems: ["Audited the conversation event projection"],
          openLoops: ["Render the milestone in the main feed"],
        }),
      ]),
    ).toEqual([
      {
        id: "milestone_12345678",
        runId: "run_1",
        seq: 3,
        createdAt: "2026-08-30T00:00:03.000Z",
        phase: "execution",
        title: "Implementation path confirmed",
        summary:
          "The existing milestone ledger can power progress updates without exposing private reasoning.",
        completedItems: ["Audited the conversation event projection"],
        openLoops: ["Render the milestone in the main feed"],
      },
    ]);
  });

  it("rejects malformed, hidden, and oversized milestone content", () => {
    const valid = {
      kind: "napier.agent-milestone-recorded",
      schemaVersion: 1,
      milestoneId: "milestone_12345678",
      phase: "verification",
      title: "Checks complete",
      summary: "The focused checks passed.",
      completedItems: [],
      openLoops: [],
    };
    expect(
      conversationMilestone({ ...event(1, valid), visibility: "hidden" }),
    ).toBeUndefined();
    expect(
      conversationMilestone(event(2, { ...valid, phase: "private" })),
    ).toBeUndefined();
    expect(
      conversationMilestone(event(3, { ...valid, summary: "x".repeat(4_001) })),
    ).toBeUndefined();
    expect(JSON.stringify(conversationMilestones([]))).not.toContain(
      "PRIVATE_REASONING",
    );
  });
});

function event(seq: number, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "agent.milestone.recorded",
    category: "plan",
    visibility: "user",
    createdAt: `2026-08-30T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}
