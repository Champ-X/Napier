import { describe, expect, it } from "vitest";

import { isConversationArtifacts } from "../src/conversation-artifacts-protocol";

describe("Conversation Artifacts protocol", () => {
  it("accepts authoritative artifacts and rejects malformed scope", () => {
    const item = {
      id: "event_1",
      seq: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      attemptScope: "current",
      threadId: "thread_1",
      runId: "run_1",
      planId: "plan_1",
      planRevision: 1,
      artifact: {
        id: "report",
        path: "report.md",
        kind: "file",
        description: "Report",
        status: "verified",
        evidence: "Verified.",
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:01.000Z",
      },
    };
    expect(isConversationArtifacts([item])).toBe(true);
    expect(
      isConversationArtifacts([{ ...item, attemptScope: "unknown" }]),
    ).toBe(false);
  });
});
