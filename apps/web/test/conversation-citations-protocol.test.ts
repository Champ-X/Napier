import { describe, expect, it } from "vitest";

import { isConversationCitations } from "../src/conversation-citations-protocol";

describe("Conversation Citations protocol", () => {
  it("accepts bounded hash-only citations and rejects malformed bindings", () => {
    const citation = {
      id: "event_citation",
      seq: 4,
      createdAt: "2026-08-16T00:00:04.000Z",
      callId: "provider-call-4",
      citationId: "citation_fixture0001",
      sourceId: "source_fixture0001",
      sourceKind: "web_fetch",
      startLine: 2,
      endLine: 4,
      sourceContentSha256: "1".repeat(64),
      sourceTitleSha256: "2".repeat(64),
      quoteSha256: "3".repeat(64),
      claimSha256: "4".repeat(64),
    };

    expect(isConversationCitations([citation])).toBe(true);
    expect(isConversationCitations([{ ...citation, endLine: 42 }])).toBe(false);
    expect(
      isConversationCitations([{ ...citation, quoteSha256: "secret" }]),
    ).toBe(false);
    expect(isConversationCitations(Array(13).fill(citation))).toBe(false);
  });
});
