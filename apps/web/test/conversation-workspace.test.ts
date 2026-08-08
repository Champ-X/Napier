import { describe, expect, it } from "vitest";

import { shouldShowConversationWelcome } from "../src/ConversationWorkspace";

describe("Conversation workspace", () => {
  it("shows the welcome only when both messages and ledger evidence are absent", () => {
    expect(shouldShowConversationWelcome([], 0)).toBe(true);
    expect(shouldShowConversationWelcome([], 1)).toBe(false);
    expect(
      shouldShowConversationWelcome(
        [{ role: "user" }],
        0,
      ),
    ).toBe(false);
  });
});
