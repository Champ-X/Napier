import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelResponseTraceSummary,
  modelResponseTraceView,
} from "../src/model-response-view";

describe("Model response trace view", () => {
  it("projects hash-only model response metadata without raw content", () => {
    const event = modelResponseEvent({
      modelCallPurpose: "goal_evaluation",
      textSha256: "a".repeat(64),
      reasoningSha256: "b".repeat(64),
      text: "TOP_SECRET_TEXT",
      reasoning: "TOP_SECRET_REASONING",
      model: "demo/model-1",
      stopReason: "stop",
      modelContextEnvelopeTurnIndex: 3,
      usage: { inputTokens: 42, outputTokens: 7 },
      toolCalls: [
        {
          id: "call_secret",
          name: "read_file",
          arguments: { path: "TOP_SECRET_PATH" },
        },
      ],
    });

    expect(modelResponseTraceView(event)).toEqual({
      model: "demo/model-1",
      modelCallPurpose: "goal_evaluation",
      stopReason: "stop",
      turnIndex: 3,
      textSha256: "a".repeat(64),
      reasoningSha256: "b".repeat(64),
      toolCallCount: 1,
      inputTokens: 42,
      outputTokens: 7,
    });
    expect(modelResponseTraceSummary(event)).toBe(
      `model / demo/model-1 / goal_evaluation / stop / turn 3 / tools 1 / text ${"a".repeat(12)} / reasoning ${"b".repeat(12)} / tokens 42/7`,
    );
    expect(modelResponseTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("keeps unredacted assistant responses readable without rendering text", () => {
    const summary = modelResponseTraceSummary(
      modelResponseEvent({
        text: "TOP_SECRET_COMPLETION",
        reasoning: "TOP_SECRET_REASONING",
        model: "demo/model-1",
        stopReason: "toolUse",
        toolCalls: [{ id: "call_secret", name: "tool", arguments: "SECRET" }],
      }),
    );

    expect(summary).toBe("model / demo/model-1 / toolUse / tools 1");
    expect(summary).not.toContain("TOP_SECRET");
    expect(summary).not.toContain("SECRET");
  });

  it("fails closed to a fixed summary for malformed response receipts", () => {
    const event = modelResponseEvent({
      model: "TOP SECRET MODEL",
      text: "TOP_SECRET_TEXT",
      summary: "TOP_SECRET_SUMMARY",
    });

    expect(modelResponseTraceView(event)).toBeUndefined();
    expect(modelResponseTraceSummary(event)).toBe("model response receipt");
    expect(modelResponseTraceSummary(event)).not.toContain("TOP_SECRET");
  });
});

function modelResponseEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_model",
    threadId: "thread_model",
    runId: "runctl_model",
    seq: 7,
    type: "model.response",
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
