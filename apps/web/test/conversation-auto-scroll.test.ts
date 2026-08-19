import { describe, expect, it } from "vitest";

import { conversationIsNearBottom } from "../src/use-conversation-auto-scroll";

describe("Conversation auto-scroll proximity", () => {
  it("follows output only while the reader remains near the bottom", () => {
    expect(
      conversationIsNearBottom({
        clientHeight: 800,
        scrollHeight: 2_000,
        scrollTop: 1_120,
      }),
    ).toBe(true);
    expect(
      conversationIsNearBottom({
        clientHeight: 800,
        scrollHeight: 2_000,
        scrollTop: 700,
      }),
    ).toBe(false);
  });
});
