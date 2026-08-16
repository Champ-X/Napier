import { describe, expect, it } from "vitest";

import { isConversationMessages } from "../src/conversation-messages-protocol";

describe("Conversation Messages protocol", () => {
  it("accepts bounded messages and rejects malformed sequence values", () => {
    const message = {
      id: "event_1",
      seq: 1,
      role: "user",
      text: "Hello",
      model: "",
      createdAt: "2026-08-16T00:00:00.000Z",
    };
    expect(isConversationMessages([message])).toBe(true);
    expect(isConversationMessages([{ ...message, seq: 1.5 }])).toBe(false);
  });
});
