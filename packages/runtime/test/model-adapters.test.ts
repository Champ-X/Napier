import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  applyModelAdapterOptions,
  createModelAdapterModels,
  MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS,
  modelAdapterReceipt,
  validateModelAdapterReceipt,
} from "../src/model-adapters.js";

describe("Model adapters", () => {
  it("selects Anthropic and OpenAI-family policies without overriding callers", () => {
    expect(modelAdapterReceipt(model("anthropic-messages"))).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        adapterId: "napier.anthropic-messages.v2",
        family: "anthropic",
        adapterVersion: 2,
        cacheRetention: "long",
        cacheRetentionSource: "adapter",
        streamOptionMaxTokens: 2_048,
        streamOptionMaxTokensSource: "model",
        modelMaxTokens: 2_048,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(modelAdapterReceipt(model("openai-responses"))).toEqual(
      expect.objectContaining({
        adapterId: "napier.openai-family.v2",
        family: "openai",
        cacheRetention: "short",
        cacheRetentionSource: "adapter",
      }),
    );
    const caller = { cacheRetention: "none" as const, maxTokens: 700 };
    expect(applyModelAdapterOptions(model("anthropic-messages"), caller)).toBe(
      caller,
    );
    expect(modelAdapterReceipt(model("anthropic-messages"), caller)).toEqual(
      expect.objectContaining({
        cacheRetention: "none",
        cacheRetentionSource: "caller",
        streamOptionMaxTokens: 700,
        streamOptionMaxTokensSource: "caller",
      }),
    );
    expect(applyModelAdapterOptions(model("custom-api"), undefined)).toEqual({
      maxTokens: 2_048,
    });
  });

  it("rejects tampered Adapter evidence", () => {
    const receipt = modelAdapterReceipt(model("openai-responses"));
    expect(validateModelAdapterReceipt(receipt)).toEqual(receipt);
    expect(() =>
      validateModelAdapterReceipt({
        ...receipt,
        cacheRetention: "long",
      }),
    ).toThrow("selection is invalid");
    expect(() =>
      validateModelAdapterReceipt({
        ...receipt,
        contentSha256: "f".repeat(64),
      }),
    ).toThrow("hash mismatch");
    expect(() =>
      validateModelAdapterReceipt({
        ...receipt,
        streamOptionMaxTokens: receipt.modelMaxTokens + 1,
      }),
    ).toThrow("receipt is invalid");
    expect(() =>
      validateModelAdapterReceipt({
        ...receipt,
        adapterId: "napier.openai-family.v1",
      }),
    ).toThrow("selection is invalid");

    const {
      streamOptionMaxTokens: _streamOptionMaxTokens,
      streamOptionMaxTokensSource: _streamOptionMaxTokensSource,
      modelMaxTokens: _modelMaxTokens,
      contentSha256: _contentSha256,
      ...legacyContent
    } = receipt;
    const legacy = {
      ...legacyContent,
      schemaVersion: 1 as const,
      adapterVersion: 1 as const,
      adapterId: "napier.openai-family.v1" as const,
    };
    expect(
      validateModelAdapterReceipt({
        ...legacy,
        contentSha256: hash(legacy),
      }),
    ).toEqual({ ...legacy, contentSha256: hash(legacy) });
  });

  it("applies the selected policy through all four Models entrypoints", async () => {
    const calls: Array<{
      method: string;
      options: SimpleStreamOptions | undefined;
    }> = [];
    const provider = fauxProvider({
      provider: "anthropic",
      api: "anthropic-messages",
    });
    provider.setResponses(
      Array.from({ length: 4 }, () => (context, options) => {
        calls.push({ method: "provider", options });
        return fauxAssistantMessage("adapted");
      }),
    );
    const raw = createModels();
    raw.setProvider(provider.provider);
    const models = createModelAdapterModels(raw);
    const context = { messages: [] };
    const modelValue = provider.getModel();

    await models.streamSimple(modelValue, context).result();
    await models.completeSimple(modelValue, context);
    await models.stream(modelValue, context).result();
    await models.complete(modelValue, context);

    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.options?.cacheRetention)).toEqual([
      "long",
      "long",
      "long",
      "long",
    ]);
    expect(calls.map((call) => call.options?.maxTokens)).toEqual([
      16_384, 16_384, 16_384, 16_384,
    ]);
  });

  it("dispatches OpenAI-family requests with bounded output tokens", async () => {
    let observed: SimpleStreamOptions | undefined;
    const provider = fauxProvider({
      provider: "openai",
      api: "openai-responses",
    });
    provider.setResponses([
      (_context, options) => {
        observed = options;
        return fauxAssistantMessage("openai adapted");
      },
    ]);
    const raw = createModels();
    raw.setProvider(provider.provider);
    const models = createModelAdapterModels(raw);

    await models.completeSimple(provider.getModel(), { messages: [] });

    expect(observed?.cacheRetention).toBe("short");
    expect(observed?.maxTokens).toBe(16_384);
  });

  it("does not mutate caller-owned options", () => {
    const options = Object.freeze({
      maxTokens: 512,
    } satisfies SimpleStreamOptions);
    const adapted = applyModelAdapterOptions(
      model("openai-completions"),
      options,
    );
    expect(adapted).toEqual({ maxTokens: 512, cacheRetention: "short" });
    expect(adapted).not.toBe(options);
    expect(options).toEqual({ maxTokens: 512 });
  });

  it("caps large-model defaults and preserves caller or model authority", () => {
    const large = { ...model("anthropic-messages"), maxTokens: 64_000 };
    expect(modelAdapterReceipt(large)).toEqual(
      expect.objectContaining({
        streamOptionMaxTokens: MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS,
        streamOptionMaxTokensSource: "adapter",
        modelMaxTokens: 64_000,
      }),
    );
    expect(applyModelAdapterOptions(large)).toEqual({
      cacheRetention: "long",
      maxTokens: MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS,
    });
    expect(modelAdapterReceipt(large, { maxTokens: 80_000 })).toEqual(
      expect.objectContaining({
        streamOptionMaxTokens: 64_000,
        streamOptionMaxTokensSource: "caller_clamped_to_model",
      }),
    );
    expect(modelAdapterReceipt({ ...large, api: "custom-api" })).toEqual(
      expect.objectContaining({
        adapterId: "napier.generic.v2",
        streamOptionMaxTokens: 64_000,
        streamOptionMaxTokensSource: "model",
      }),
    );
  });
});

function hash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function model(api: string) {
  return {
    id: "model-1",
    name: "Model",
    api,
    provider: "test",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 2_048,
  };
}
