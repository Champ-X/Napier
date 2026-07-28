import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  threadImportedSummary,
  threadImportedView,
} from "../src/thread-imported-view";

describe("Thread imported view", () => {
  it("projects only hash-only import provenance receipt metadata", () => {
    const event = threadImportedEvent({
      kind: "napier.thread-import-provenance",
      sourceThreadId: "thread_secret_source",
      sourceApiVersion: "TOP_SECRET_API",
      sourceContentSha256: "a".repeat(64),
      sourceEventStreamSha256: "b".repeat(64),
      sourceEventCount: 12,
      localImportedThroughSeq: 13,
      sourceModelContextEnvelopeCount: 2,
      sourceEmbeddedModelContextEnvelopeCount: 3,
      importedAt: "2026-07-28T12:00:00.000Z",
      summary: "TOP_SECRET_SUMMARY",
    });

    expect(threadImportedView(event)).toEqual({
      sourceContentSha256: "a".repeat(64),
      sourceEventStreamSha256: "b".repeat(64),
      sourceEventCount: 12,
      localImportedThroughSeq: 13,
      sourceModelContextEnvelopeCount: 2,
      sourceEmbeddedModelContextEnvelopeCount: 3,
    });
    expect(threadImportedSummary(event)).toBe(
      `import / 12 source events / cutoff 13 / source ${"a".repeat(12)} / stream ${"b".repeat(12)} / envelopes 2+3`,
    );
    expect(threadImportedSummary(event)).not.toContain("TOP_SECRET");
    expect(threadImportedSummary(event)).not.toContain("thread_secret_source");
  });

  it("keeps legacy import receipts readable with defaulted coverage counts", () => {
    expect(
      threadImportedView(
        threadImportedEvent({
          sourceContentSha256: "c".repeat(64),
          sourceEventStreamSha256: "d".repeat(64),
          sourceEventCount: 4,
        }),
      ),
    ).toEqual({
      sourceContentSha256: "c".repeat(64),
      sourceEventStreamSha256: "d".repeat(64),
      sourceEventCount: 4,
      localImportedThroughSeq: 4,
      sourceModelContextEnvelopeCount: 0,
      sourceEmbeddedModelContextEnvelopeCount: 0,
    });
  });

  it("fails closed to a fixed summary for malformed import receipts", () => {
    const event = threadImportedEvent({
      sourceContentSha256: "not-a-hash",
      sourceEventStreamSha256: "e".repeat(64),
      sourceEventCount: 4,
      text: "TOP_SECRET_TEXT",
    });

    expect(threadImportedView(event)).toBeUndefined();
    expect(threadImportedSummary(event)).toBe("thread import receipt");
    expect(threadImportedSummary(event)).not.toContain("TOP_SECRET");
  });
});

function threadImportedEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_imported",
    threadId: "thread_imported",
    runId: "runctl_imported",
    seq: 12,
    type: "thread.imported",
    category: "lifecycle",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
