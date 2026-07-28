import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { toolLoopGuardTriggerViews } from "../src/tool-loop-guard-view";

describe("Tool Loop Guard trace view", () => {
  it("projects only bounded hash-only trigger metadata", () => {
    const valid = triggerEvent({
      toolName: "read_file",
      attemptCount: 3,
      fromSeq: 8,
      toSeq: 24,
      callSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    });
    const invalid = triggerEvent({
      toolName: "bad tool",
      attemptCount: 3,
      fromSeq: 8,
      toSeq: 24,
      callSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    });

    expect(toolLoopGuardTriggerViews([valid, invalid])).toEqual([
      {
        eventSeq: 25,
        runId: "run_loop",
        toolName: "read_file",
        attemptCount: 3,
        fromSeq: 8,
        toSeq: 24,
        callSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
        contentSha256: "c".repeat(64),
      },
    ]);
  });
});

function triggerEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_loop",
    threadId: "thread_loop",
    runId: "run_loop",
    seq: 25,
    type: "model.tool_loop.detected",
    category: "system",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
