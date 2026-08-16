import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  applyConversationCitation,
  projectConversationCitations,
} from "../src/conversation-citations-projection.js";

describe("Conversation Citations projection", () => {
  it("projects strict hash-only citations with incremental equivalence", () => {
    const hidden = citationEvent(1, { visibility: "hidden" });
    const capture = citationEvent(2, { action: "capture_fetch" });
    const citation = citationEvent(3);
    const tampered = citationEvent(4, { citationEndLine: 99 });

    let state = applyConversationCitation([], hidden);
    state = applyConversationCitation(state, capture);
    state = applyConversationCitation(state, citation);
    state = applyConversationCitation(state, tampered);

    expect(state).toEqual(
      projectConversationCitations(
        [tampered, citation, capture, hidden].sort(
          (left, right) => left.seq - right.seq,
        ),
      ),
    );
    expect(state).toEqual([
      expect.objectContaining({
        id: "event_3",
        callId: "call_research_3",
        citationId: "citation_fixture0003",
        sourceId: "source_fixture0001",
        startLine: 2,
        endLine: 4,
      }),
    ]);
    expect(JSON.stringify(state)).not.toContain("PRIVATE_SOURCE_TEXT");
  });

  it("retains only the latest twelve citations", () => {
    expect(
      projectConversationCitations(
        Array.from({ length: 14 }, (_value, index) => citationEvent(index + 1)),
      ).map((citation) => citation.seq),
    ).toEqual(Array.from({ length: 12 }, (_value, index) => index + 3));
  });
});

function citationEvent(
  seq: number,
  overrides: {
    action?: string;
    citationEndLine?: number;
    visibility?: RunEvent["visibility"];
  } = {},
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_projection",
    runId: "run_projection",
    seq,
    type: "tool.completed",
    category: "tool",
    visibility: overrides.visibility ?? "user",
    createdAt: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    payload: {
      callId: `call_research_${String(seq)}`,
      toolName: "research_source",
      status: "completed",
      rawSource: "PRIVATE_SOURCE_TEXT",
      details: {
        kind: "napier.research-source-evidence",
        schemaVersion: 1,
        action: overrides.action ?? "cite",
        sourceCount: 1,
        citationCount: overrides.action === "capture_fetch" ? 0 : 1,
        sourceSetSha256: "1".repeat(64),
        inputContentSha256: "2".repeat(64),
        sourceKind: "web_fetch",
        sourceId: "source_fixture0001",
        sourceContentSha256: "3".repeat(64),
        sourceUrlSha256: "4".repeat(64),
        sourceOriginSha256: "5".repeat(64),
        sourceTitleSha256: "6".repeat(64),
        sourceTextSha256: "7".repeat(64),
        sourceLineCount: 8,
        sourceTextChars: 1_024,
        sourceTruncated: false,
        webSourceContentSha256: "8".repeat(64),
        webSourceBodySha256: "9".repeat(64),
        webSourceFormat: "html",
        webSourceLineCount: 8,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        ...(overrides.action === "capture_fetch"
          ? {}
          : {
              citationId: `citation_fixture${String(seq).padStart(4, "0")}`,
              citationTokenSha256: "a".repeat(64),
              citationStartLine: 2,
              citationEndLine: overrides.citationEndLine ?? 4,
              citationQuoteSha256: "b".repeat(64),
              citationClaimSha256: "c".repeat(64),
            }),
      },
    },
  };
}
