import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { modelContextEnvelopeViews } from "../src/model-context-envelope-view";

describe("Model Context Envelope trace view", () => {
  it("projects only strict hash-only provider request metadata", () => {
    const valid = envelopeEvent({
      kind: "napier.model-context-envelope",
      schemaVersion: 1,
      turnIndex: 2,
      systemPromptSha256: "a".repeat(64),
      systemPromptBytes: 1024,
      messageCount: 4,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolResultMessageCount: 1,
      otherMessageCount: 1,
      messageSetSha256: "b".repeat(64),
      toolCount: 3,
      toolNameSetSha256: "c".repeat(64),
      toolDefinitionSetSha256: "d".repeat(64),
      contentSha256: "e".repeat(64),
    });
    const rawPromptInjected = envelopeEvent({
      ...recordPayload(valid),
      systemPrompt: "do not render raw prompts",
    });
    const countDrifted = envelopeEvent({
      ...recordPayload(valid),
      messageCount: 5,
      contentSha256: "f".repeat(64),
    });
    const validResponse = responseEvent({
      model: "faux-secure/faux-1",
      stopReason: "stop",
      modelContextEnvelopeSha256: "e".repeat(64),
      modelContextEnvelopeTurnIndex: 2,
      modelContextMessageSetSha256: "b".repeat(64),
      modelContextToolDefinitionSetSha256: "d".repeat(64),
    });
    const mismatchedResponse = responseEvent({
      model: "faux-secure/faux-1",
      stopReason: "stop",
      modelContextEnvelopeSha256: "0".repeat(64),
      modelContextEnvelopeTurnIndex: 9,
      modelContextMessageSetSha256: "b".repeat(64),
      modelContextToolDefinitionSetSha256: "d".repeat(64),
    });

    expect(
      modelContextEnvelopeViews([
        valid,
        validResponse,
        rawPromptInjected,
        countDrifted,
        mismatchedResponse,
      ]),
    ).toEqual([
      {
        eventSeq: 17,
        runId: "run_context",
        schemaVersion: 1,
        turnIndex: 2,
        responseSeq: 18,
        responseModel: "faux-secure/faux-1",
        responseStopReason: "stop",
        systemPromptBytes: 1024,
        messageCount: 4,
        userMessageCount: 1,
        assistantMessageCount: 1,
        toolResultMessageCount: 1,
        otherMessageCount: 1,
        toolCount: 3,
        systemPromptSha256: "a".repeat(64),
        messageSetSha256: "b".repeat(64),
        toolNameSetSha256: "c".repeat(64),
        toolDefinitionSetSha256: "d".repeat(64),
        contentSha256: "e".repeat(64),
      },
    ]);
  });

  it("projects v2 tool definition cost and rejects estimate drift", () => {
    const valid = envelopeEvent({
      kind: "napier.model-context-envelope",
      schemaVersion: 2,
      turnIndex: 0,
      systemPromptSha256: "1".repeat(64),
      systemPromptBytes: 2_048,
      messageCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 0,
      toolResultMessageCount: 0,
      otherMessageCount: 0,
      messageSetSha256: "2".repeat(64),
      toolCount: 20,
      toolNameSetSha256: "3".repeat(64),
      toolDefinitionSetSha256: "4".repeat(64),
      toolDefinitionBytes: 31_462,
      toolDefinitionEstimatedTokens: 7_866,
      toolDefinitionTokenEstimateMethod: "ceil_utf8_bytes_div_4",
      contentSha256: "5".repeat(64),
    });
    const drifted = envelopeEvent({
      ...recordPayload(valid),
      toolDefinitionEstimatedTokens: 7_865,
      contentSha256: "6".repeat(64),
    });

    expect(modelContextEnvelopeViews([valid, drifted])).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        toolCount: 20,
        toolDefinitionBytes: 31_462,
        toolDefinitionEstimatedTokens: 7_866,
        toolDefinitionTokenEstimateMethod: "ceil_utf8_bytes_div_4",
      }),
    ]);
  });
});

function recordPayload(event: RunEvent): Record<string, unknown> {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    throw new Error("Envelope fixture is invalid");
  }
  return event.payload;
}

function envelopeEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_context",
    threadId: "thread_context",
    runId: "run_context",
    seq: 17,
    type: "context.model_envelope",
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}

function responseEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_response",
    threadId: "thread_context",
    runId: "run_context",
    seq: 18,
    type: "model.response",
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:01.000Z",
  };
}
