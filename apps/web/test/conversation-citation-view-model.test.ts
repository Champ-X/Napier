import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationCitationLinks,
  conversationCitations,
} from "../src/conversation-citation-view-model";

describe("Conversation citations", () => {
  it("projects only strict user-visible completed citation evidence", () => {
    const citations = conversationCitations([
      citationEvent(1, "hidden"),
      citationEvent(2, "user", { action: "capture" }),
      citationEvent(3, "user", {
        rawSource: "PRIVATE_SOURCE_TEXT",
      }),
      citationEvent(4, "user"),
    ]);

    expect(citations).toEqual([
      {
        id: "event_4",
        seq: 4,
        createdAt: "2026-08-08T00:00:04.000Z",
        callId: "call_research",
        citationId: "citation_fixture0001",
        sourceId: "source_fixture0001",
        sourceKind: "web_fetch",
        startLine: 2,
        endLine: 4,
        sourceContentSha256: "2".repeat(64),
        sourceTitleSha256: "5".repeat(64),
        quoteSha256: "7".repeat(64),
        claimSha256: "8".repeat(64),
      },
    ]);
    expect(JSON.stringify(citations)).not.toContain("PRIVATE_SOURCE_TEXT");
  });

  it("creates stable numbered links for message token binding", () => {
    const citations = conversationCitations([
      citationEvent(4, "user"),
      citationEvent(5, "user", {
        citationId: "citation_fixture0002",
      }),
    ]);

    expect(conversationCitationLinks(citations)).toEqual([
      {
        citationId: "citation_fixture0001",
        targetId: "conversation-citation-citation_fixture0001-4",
        index: 1,
      },
      {
        citationId: "citation_fixture0002",
        targetId: "conversation-citation-citation_fixture0002-5",
        index: 2,
      },
    ]);
  });
});

function citationEvent(
  seq: number,
  visibility: RunEvent["visibility"],
  overrides: Record<string, unknown> = {},
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "tool.completed",
    category: "tool",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload: {
      callId: "call_research",
      toolName: "research_source",
      status: "completed",
      effect: "read",
      details: {
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "cite",
        sourceKind: "web_fetch",
        sourceId: "source_fixture0001",
        citationId: "citation_fixture0001",
        citationTokenSha256: "1".repeat(64),
        sourceContentSha256: "2".repeat(64),
        sourceUrlSha256: "3".repeat(64),
        sourceOriginSha256: "4".repeat(64),
        sourceTitleSha256: "5".repeat(64),
        sourceTextSha256: "6".repeat(64),
        sourceLineCount: 8,
        sourceTextChars: 1_024,
        sourceTruncated: false,
        citationStartLine: 2,
        citationEndLine: 4,
        citationQuoteSha256: "7".repeat(64),
        citationClaimSha256: "8".repeat(64),
        sourceCount: 2,
        citationCount: 3,
        sourceSetSha256: "9".repeat(64),
        webSourceContentSha256: "a".repeat(64),
        webSourceBodySha256: "b".repeat(64),
        webSourceFormat: "html",
        webSourceLineCount: 8,
        ...overrides,
      },
    },
  };
}
