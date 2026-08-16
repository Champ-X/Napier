import { describe, expect, it } from "vitest";

import { isConversationActivityEvents } from "../src/conversation-activity-events-protocol";

describe("Conversation Activity Events protocol", () => {
  it("accepts bounded tool evidence and rejects hidden events", () => {
    const event = {
      id: "event_1",
      threadId: "thread_1",
      runId: "run_1",
      seq: 1,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-16T00:00:00.000Z",
      payload: { callId: "call_1", toolName: "read_file" },
    };
    expect(isConversationActivityEvents([event])).toBe(true);
    expect(
      isConversationActivityEvents([{ ...event, visibility: "hidden" }]),
    ).toBe(false);
  });
});
