import { readFile } from "node:fs/promises";
import { fauxProvider, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { expect, it, vi } from "vitest";
import {
  prepareHarnessModelCallBudget as prepare,
  assertHarnessModelCallBudget as enforce,
} from "../src/harness-model-call-budget.js";
import { ModelRegistry } from "../src/models.js";
import { shortThinkingLoopRetryOptions } from "../src/model-thinking-loop-guard.js";
import {
  createHarnessPolicyProfile,
  validateHarnessPolicyProfile,
} from "../src/harness-policy-profile.js";
import { applyProviderWireCompatibility } from "../src/model-provider-wire-compatibility.js";

const policy = "bounded-thinking-v1";
const model = new ModelRegistry().resolve({
  provider: "deepseek",
  id: "deepseek-v4-flash",
})!;

it("leaves the implicit default and frozen v5 profile unchanged", async () => {
  const options: SimpleStreamOptions = {
    reasoning: "medium",
    maxTokens: 16384,
  };
  expect(prepare(model, options, undefined)).toBe(options);
  const old = JSON.parse(
    await readFile(
      new URL(
        "../../../benchmarks/harness-profiles/current-integrated.v5.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(validateHarnessPolicyProfile(old.policies)).toEqual(old.policies);
  const {
    contentSha256: _hash,
    schemaVersion: _schema,
    ...base
  } = old.policies;
  expect(createHarnessPolicyProfile(base)).toEqual(old.policies);
  expect(
    createHarnessPolicyProfile({ ...base, modelCall: policy }).contentSha256,
  ).not.toBe(old.policies.contentSha256);
  expect(() =>
    createHarnessPolicyProfile({ ...base, modelCall: "unknown" }),
  ).toThrow("Invalid Harness");
});

it.each([
  [undefined, 8192],
  [16384, 8192],
  [2048, 2048],
])(
  "normalizes actual unsupported medium and preserves stricter limit %s",
  (maxTokens, expected) => {
    const signal = new AbortController().signal;
    const onPayload = vi.fn();
    const options: SimpleStreamOptions = {
      reasoning: "medium",
      ...(maxTokens ? { maxTokens } : {}),
      signal,
      onPayload,
      maxRetries: 0,
    };
    const result = prepare(model, options, policy);
    expect(result).toEqual({
      ...options,
      reasoning: "high",
      maxTokens: expected,
    });
    expect(result.signal).toBe(signal);
    expect(result.onPayload).toBe(onPayload);
    expect(options.reasoning).toBe("medium");
  },
);

it("respects model ceilings and leaves nonreasoning or disabled requests alone", () => {
  expect(
    prepare({ ...model, maxTokens: 1024 }, { reasoning: "medium" }, policy)
      .maxTokens,
  ).toBe(1024);
  const options = { maxTokens: 2048 };
  expect(prepare(model, options, policy)).toBe(options);
  const plain = fauxProvider().getModel();
  expect(prepare({ ...plain, reasoning: false }, options, policy)).toBe(
    options,
  );
  expect(
    prepare(
      {
        ...model,
        thinkingLevelMap: {
          off: "off",
          minimal: null,
          low: null,
          medium: null,
          high: null,
        },
      },
      { reasoning: "medium", maxTokens: 2048 },
      policy,
    ),
  ).toEqual(options);
  expect(
    prepare(
      model,
      shortThinkingLoopRetryOptions(model, {
        reasoning: "high",
        maxTokens: 8192,
      }),
      policy,
    ),
  ).toEqual({ maxTokens: 8192 });
  expect(
    prepare(
      model,
      shortThinkingLoopRetryOptions(model, {
        reasoning: "high",
        maxTokens: 2048,
      }),
      policy,
    ),
  ).toEqual(options);
});

it.each([0, -1, NaN, Infinity, 1.5])(
  "rejects invalid reasoning ceiling %s before dispatch",
  (maxTokens) => {
    expect(() =>
      prepare(model, { reasoning: "medium", maxTokens }, policy),
    ).toThrow("token limit");
  },
);

it.each([
  { reasoning: "high", maxTokens: 16384 },
  { reasoning: "high" },
  { reasoning: "medium", maxTokens: 8192 },
  { maxTokens: 8192 },
  { reasoning: "max", maxTokens: 8192 },
])("rejects finalizer budget/effort mutation %j", (finalized) => {
  expect(() =>
    enforce(
      model,
      { reasoning: "high", maxTokens: 8192 },
      finalized as SimpleStreamOptions,
      policy,
    ),
  ).toThrow("finalization");
});

it("retains the stricter prepared cap through finalization", () => {
  expect(() =>
    enforce(model, { maxTokens: 2048 }, { maxTokens: 4096 }, policy),
  ).toThrow("finalization");
  expect(() =>
    enforce(
      model,
      { reasoning: "high", maxTokens: 2048 },
      { reasoning: "high", maxTokens: 2048 },
      policy,
    ),
  ).not.toThrow();
});

it("serializes primary and short retry through installed SDK with zero HTTP calls", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("Unexpected HTTP dispatch");
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const primary = prepare(
      model,
      { reasoning: "medium", maxTokens: 16384 },
      policy,
    );
    for (const [options, expected] of [
      [
        primary,
        {
          max_tokens: 8192,
          reasoning_effort: "high",
          thinking: { type: "enabled" },
        },
      ],
      [
        prepare(model, shortThinkingLoopRetryOptions(model, primary), policy),
        { max_tokens: 8192, thinking: { type: "disabled" } },
      ],
    ] as const) {
      let payload: unknown;
      const terminal = await streamSimple(
        applyProviderWireCompatibility(model),
        {
          messages: [
            { role: "user", content: "Offline serialization", timestamp: 0 },
          ],
        },
        {
          ...options,
          apiKey: "offline-not-a-credential",
          maxRetries: 0,
          onPayload(value) {
            payload = value;
            throw new Error("Stop before HTTP");
          },
        },
      ).result();
      expect(payload).toMatchObject(expected);
      expect(payload).not.toHaveProperty("max_completion_tokens");
      expect(terminal.stopReason).toBe("error");
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
