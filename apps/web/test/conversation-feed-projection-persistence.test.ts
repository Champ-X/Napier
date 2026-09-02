import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import type { WebThreadDetail } from "../src/api";
import { conversationFeedProjection } from "../src/conversation-feed-projection";

describe("conversation feed persistence", () => {
  it("pairs every tool lifecycle in long reloaded threads", () => {
    const events = Array.from({ length: 40 }, (_, index) => [
      toolEvent(index * 2 + 1, index, "tool.started"),
      toolEvent(index * 2 + 2, index, "tool.completed"),
    ]).flat();
    const detail = {
      thread: { id: "thread_long", status: "completed" },
      runs: [],
      plans: [],
      events,
      // This is the server's bounded compatibility projection. The feed must
      // use the complete ledger above, or the first 24 calls degrade into
      // generic started/completed placeholders after reload.
      activityEvents: events.slice(-32),
      operatorDecisions: [],
      subagents: [],
      automaticRecoveryAssessments: [],
      automaticRecoveryAttempts: [],
    } as unknown as WebThreadDetail;

    const projection = conversationFeedProjection([], detail);
    const grouped = projection.feed.flatMap((entry) =>
      entry.kind === "activity-group" ? entry.items : [],
    );

    expect(grouped.filter((item) => item.kind === "tool")).toHaveLength(40);
    expect(
      grouped.filter(
        (item) =>
          item.kind === "activity" && item.activity.type.startsWith("tool."),
      ),
    ).toHaveLength(0);
    expect(
      grouped
        .filter((item) => item.kind === "tool")
        .every((item) => item.activity.eventIds.length === 2),
    ).toBe(true);
  });
});

function toolEvent(
  seq: number,
  index: number,
  type: "tool.started" | "tool.completed",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_long",
    runId: "run_long",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: `2026-09-02T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload: {
      callId: `call_${String(index)}`,
      toolName: "read_file",
      status: type === "tool.started" ? "started" : "completed",
    },
  };
}
