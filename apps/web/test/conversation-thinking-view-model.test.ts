import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  activeConversationThinkingActivity,
  activeConversationThinkingId,
  conversationThinkingActivities,
} from "../src/conversation-thinking-view-model";

describe("conversationThinkingActivities", () => {
  it("retains the complete available transcript and next public action", () => {
    const activities = conversationThinkingActivities([
      event(1, "turn.started", "debug", {}),
      event(2, "model.thinking.delta", "hidden", {
        chunkCount: 8,
        deltaBytes: 24,
        delta: "TOP_SECRET_REASONING",
      }),
      event(3, "model.response", "debug", {
        reasoning: "ANOTHER_PRIVATE_REASON",
      }),
      event(4, "tool.started", "user", {
        callId: "call_patch",
        toolName: "apply_patch",
      }),
    ]);

    expect(activities).toEqual([
      expect.objectContaining({
        runId: "run_1",
        seq: 1,
        lastSeq: 2,
        turnSeq: 1,
        startedAt: "2026-08-30T00:00:02.000Z",
        summaryKind: "edit",
        followingActionKind: "apply_patch",
        durationSeconds: 2,
        chunkCount: 8,
        deltaBytes: 24,
        transcript: "TOP_SECRET_REASONING",
      }),
    ]);
    expect(JSON.stringify(activities)).toContain("TOP_SECRET_REASONING");
    expect(JSON.stringify(activities)).not.toContain("ANOTHER_PRIVATE_REASON");
    expect(JSON.stringify(activities)).not.toContain('\"delta\":');
  });

  it("merges adjacent thinking batches into one process stage", () => {
    const activities = conversationThinkingActivities([
      event(1, "turn.started", "debug", {}),
      event(2, "model.thinking.delta", "hidden", {
        chunkCount: 3,
        deltaBytes: 20,
        delta: "First part. ",
      }),
      event(3, "model.thinking.delta", "hidden", {
        chunkCount: 5,
        deltaBytes: 40,
        delta: "Second part.",
      }),
      event(4, "tool.started", "user", {
        callId: "call_verify",
        toolName: "verify_workspace",
      }),
    ]);

    expect(activities).toEqual([
      expect.objectContaining({
        id: "event_1",
        runId: "run_1",
        seq: 1,
        lastSeq: 3,
        turnSeq: 1,
        startedAt: "2026-08-30T00:00:02.000Z",
        createdAt: "2026-08-30T00:00:06.000Z",
        summaryKind: "verify",
        followingActionKind: "verify_workspace",
        durationSeconds: 4,
        chunkCount: 8,
        deltaBytes: 60,
        transcript: "First part. Second part.",
      }),
    ]);
  });

  it("marks historical hash-only thinking without inventing text", () => {
    const activities = conversationThinkingActivities([
      event(1, "turn.started", "debug", {}),
      event(2, "model.thinking.delta", "hidden", {
        chunkCount: 2,
        deltaBytes: 42,
        deltaSha256: "a".repeat(64),
        redacted: true,
      }),
      event(3, "turn.completed", "debug", {}),
    ]);

    expect(activities[0]).toEqual(
      expect.objectContaining({ redactedChunkCount: 1 }),
    );
    expect(activities[0]).not.toHaveProperty("transcript");
  });

  it("uses a bounded fallback when no public action follows", () => {
    const activities = conversationThinkingActivities([
      event(1, "turn.started", "debug", {}),
      event(2, "model.thinking.delta", "hidden", {
        chunkCount: 1,
        deltaBytes: 7,
      }),
      event(3, "turn.completed", "debug", {}),
      event(4, "tool.started", "user", {
        callId: "call_late",
        toolName: "web_search",
      }),
    ]);

    expect(activities[0]).toEqual(
      expect.objectContaining({ summaryKind: "continue" }),
    );
    expect(activities[0]).not.toHaveProperty("followingActionKind");
  });

  it("keeps a stable turn-bound activity active until visible model output begins", () => {
    const thinking = [
      event(1, "turn.started", "debug", {}),
      event(2, "model.thinking.delta", "hidden", { delta: "Working" }),
    ];

    expect(activeConversationThinkingId(thinking, "run_1", true)).toBe(
      "event_1",
    );
    expect(activeConversationThinkingId(thinking, "run_1", false)).toBeUndefined();
    expect(
      activeConversationThinkingId(
        [
          ...thinking,
          event(3, "tool.started", "user", {
            callId: "call_1",
            toolName: "read_file",
          }),
        ],
        "run_1",
        true,
      ),
    ).toBeUndefined();
  });

  it("shows a live placeholder before the provider returns its first delta", () => {
    const waiting = [
      event(1, "turn.started", "debug", {}),
      event(2, "route_attempt_started", "debug", {}),
      event(3, "context.model_invocation", "debug", {}),
    ];

    expect(
      activeConversationThinkingActivity(waiting, "run_1", true),
    ).toEqual(
      expect.objectContaining({
        id: "event_1",
        seq: 1,
        lastSeq: 1,
        turnSeq: 1,
        startedAt: "2026-08-30T00:00:02.000Z",
        summaryKind: "continue",
      }),
    );
    expect(
      activeConversationThinkingId(
        [...waiting, event(4, "model.text.delta", "hidden", { delta: "Hi" })],
        "run_1",
        true,
      ),
    ).toBeUndefined();
  });
});

function event(
  seq: number,
  type: string,
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: type.startsWith("model.") ? "model" : "system",
    visibility,
    createdAt: `2026-08-30T00:00:${String(seq * 2).padStart(2, "0")}.000Z`,
    payload,
  };
}
