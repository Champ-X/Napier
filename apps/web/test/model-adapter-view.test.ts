import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { modelAdapterViews } from "../src/model-adapter-view";

describe("Model Adapter trace view", () => {
  it("projects only strict hash-only Adapter selections", () => {
    const valid = event({
      kind: "napier.model-adapter-selection",
      schemaVersion: 1,
      adapterId: "napier.anthropic-messages.v1",
      family: "anthropic",
      adapterVersion: 1,
      modelApi: "anthropic-messages",
      cacheRetention: "long",
      cacheRetentionSource: "adapter",
      contentSha256: "a".repeat(64),
    });
    const promptInjected = event({
      ...payload(valid),
      systemPrompt: "TOP_SECRET_PROMPT",
    });
    const mismatched = event({
      ...payload(valid),
      adapterId: "napier.openai-family.v1",
      contentSha256: "b".repeat(64),
    });

    expect(modelAdapterViews([valid, promptInjected, mismatched])).toEqual([
      {
        eventSeq: 21,
        runId: "run_adapter",
        adapterId: "napier.anthropic-messages.v1",
        family: "anthropic",
        adapterVersion: 1,
        modelApi: "anthropic-messages",
        cacheRetention: "long",
        cacheRetentionSource: "adapter",
        contentSha256: "a".repeat(64),
      },
    ]);
  });

  it("projects v2 output-token policy and rejects mixed generations", () => {
    const modern = event({
      kind: "napier.model-adapter-selection",
      schemaVersion: 2,
      adapterId: "napier.openai-family.v2",
      family: "openai",
      adapterVersion: 2,
      modelApi: "openai-responses",
      cacheRetention: "short",
      cacheRetentionSource: "adapter",
      streamOptionMaxTokens: 16_384,
      streamOptionMaxTokensSource: "adapter",
      modelMaxTokens: 64_000,
      contentSha256: "c".repeat(64),
    });
    const mixed = event({
      ...payload(modern),
      adapterId: "napier.openai-family.v1",
    });

    expect(modelAdapterViews([modern, mixed])).toEqual([
      {
        eventSeq: 21,
        runId: "run_adapter",
        adapterId: "napier.openai-family.v2",
        family: "openai",
        adapterVersion: 2,
        modelApi: "openai-responses",
        cacheRetention: "short",
        cacheRetentionSource: "adapter",
        streamOptionMaxTokens: 16_384,
        streamOptionMaxTokensSource: "adapter",
        modelMaxTokens: 64_000,
        contentSha256: "c".repeat(64),
      },
    ]);
  });
});

function event(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_adapter",
    threadId: "thread_adapter",
    runId: "run_adapter",
    seq: 21,
    type: "context.model_adapter",
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}

function payload(eventValue: RunEvent): Record<string, unknown> {
  return eventValue.payload as Record<string, unknown>;
}
