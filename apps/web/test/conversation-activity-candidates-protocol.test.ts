import { describe, expect, it } from "vitest";

import { isConversationActivityCandidates } from "../src/conversation-activity-candidates-protocol";

describe("Conversation Activity Candidates protocol", () => {
  it("accepts bounded safe candidates and rejects raw or malformed bindings", () => {
    const candidate = {
      id: "event_activity",
      seq: 4,
      type: "plan.created",
      label: "Plan",
      summary: "Plan created",
      tone: "info",
      createdAt: "2026-08-16T00:00:04.000Z",
      planId: "plan_fixture0001",
    };

    expect(isConversationActivityCandidates([candidate])).toBe(true);
    expect(
      isConversationActivityCandidates([
        { ...candidate, privatePayload: "PRIVATE_EVENT" },
      ]),
    ).toBe(false);
    expect(
      isConversationActivityCandidates([
        { ...candidate, artifactKey: "plan_fixture0001:bad artifact" },
      ]),
    ).toBe(false);
    expect(isConversationActivityCandidates(Array(257).fill(candidate))).toBe(
      false,
    );
  });
});
