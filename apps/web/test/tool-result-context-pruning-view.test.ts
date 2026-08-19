import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { toolResultContextPruningViews } from "../src/tool-result-context-pruning-view";

describe("tool-result context pruning view", () => {
  it("accepts internally consistent hashed pruning evidence", () => {
    expect(toolResultContextPruningViews([event()])).toEqual([
      expect.objectContaining({
        eventSeq: 9,
        attempt: 1,
        toolResultCount: 8,
        replacementCount: 4,
        savedToolResultTextBytes: 36_000,
      }),
    ]);
  });

  it("rejects byte and reason-count drift", () => {
    const valid = event();
    expect(toolResultContextPruningViews([
      { ...valid, payload: { ...asRecord(valid.payload), savedToolResultTextBytes: 35_999 } },
      { ...valid, payload: { ...asRecord(valid.payload), replacementCount: 5 } },
      { ...valid, payload: { ...asRecord(valid.payload), contentSha256: "bad" } },
    ])).toEqual([]);
  });
});

function event(): RunEvent {
  return {
    id: "event_9",
    threadId: "thread_1",
    runId: "run_1",
    seq: 9,
    type: "model.context.tool-results.pruned",
    category: "model",
    visibility: "debug",
    createdAt: "2026-08-19T00:00:00.000Z",
    payload: {
      kind: "napier.tool-result-context-pruning",
      schemaVersion: 1,
      attempt: 1,
      messageCount: 20,
      toolResultCount: 8,
      replacementCount: 4,
      supersededResultCount: 1,
      repeatedErrorCount: 1,
      largeResultCount: 1,
      emptyResultCount: 1,
      originalToolResultTextBytes: 60_000,
      activeToolResultTextBytes: 24_000,
      savedToolResultTextBytes: 36_000,
      originalToolResultSetSha256: "a".repeat(64),
      activeToolResultSetSha256: "b".repeat(64),
      replacementSetSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
    },
  };
}

function asRecord(value: RunEvent["payload"]): Record<string, RunEvent["payload"]> {
  return value as Record<string, RunEvent["payload"]>;
}
