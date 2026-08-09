import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  applyModelAdapterOptions,
  createModelAdapterModels,
  modelAdapterReceipt,
  validateModelAdapterReceipt,
} from "../src/model-adapters.js";

describe("Model adapters", () => {
  it("selects Anthropic and OpenAI-family policies without overriding callers", () => {
    expect(modelAdapterReceipt(model("anthropic-messages"))).toEqual(
      expect.objectContaining({
        adapterId: "napier.anthropic-messages.v1",
        family: "anthropic",
        cacheRetention: "long",
        cacheRetentionSource: "adapter",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(modelAdapterReceipt(model("openai-responses"))).toEqual(
      expect.objectContaining({
        adapterId: "napier.openai-family.v1",
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
      }),
    );
    expect(applyModelAdapterOptions(model("custom-api"), undefined)).toBe(
      undefined,
    );
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
  });

  it("dispatches OpenAI-family requests with short cache retention", async () => {
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
});

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
