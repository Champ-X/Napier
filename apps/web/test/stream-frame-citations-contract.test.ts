import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame citation contract", () => {
  it("rejects malformed projected citation evidence before dispatch", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: {
            id: "event_1",
            threadId: "thread_1",
            runId: "run_1",
            seq: 1,
            type: "model.text.delta",
            category: "model",
            visibility: "user",
            createdAt: "2026-08-16T00:00:01.000Z",
            payload: { delta: "hello" },
          },
          projections: {
            citations: [
              {
                id: "event_citation",
                seq: 1,
                createdAt: "2026-08-16T00:00:01.000Z",
                callId: "provider-call",
                citationId: "citation_fixture0001",
                sourceId: "source_fixture0001",
                sourceKind: "web_fetch",
                startLine: 2,
                endLine: 4,
                sourceContentSha256: "1".repeat(64),
                sourceTitleSha256: "2".repeat(64),
                quoteSha256: "not-a-digest",
                claimSha256: "4".repeat(64),
              },
            ],
          },
        },
        {
          snapshot: () => true,
          error: () => true,
          done: () => true,
        },
      ),
    ).toBe("invalid_event");
  });
});
