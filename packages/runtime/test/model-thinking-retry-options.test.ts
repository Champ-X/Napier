import { expect, it } from "vitest";
import {
  clampThinkingLevel,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { shortThinkingLoopRetryOptions } from "../src/model-thinking-loop-guard.js";

const provider = deepseekProvider();
const flash = provider.getModels().find((m) => m.id === "deepseek-v4-flash")!;

it("does not turn an unsupported short retry into high reasoning", () => {
  expect(clampThinkingLevel(flash, "minimal")).toBe("high");
  const original = {
    reasoning: "high" as const,
    maxTokens: 8000,
    temperature: 0.2,
  };
  const retry = shortThinkingLoopRetryOptions(flash, original);
  expect(retry.reasoning).toBeUndefined();
  expect(retry.maxTokens).toBe(8000);
  expect(retry.temperature).toBe(0.2);
  expect(original.reasoning).toBe("high");
});

it("preserves supported minimal reasoning and uses advertised levels when off is forbidden", () => {
  const generic = { ...flash, thinkingLevelMap: undefined };
  expect(shortThinkingLoopRetryOptions(generic, {}).reasoning).toBe("minimal");
  const mandatory = {
    ...flash,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      max: null,
    },
  } as Model<Api>;
  expect(
    shortThinkingLoopRetryOptions(mandatory, { maxTokens: 512 }).reasoning,
  ).toBe("low");
  expect(
    shortThinkingLoopRetryOptions(mandatory, { maxTokens: 512 }).maxTokens,
  ).toBe(512);
  expect(
    shortThinkingLoopRetryOptions(
      {
        ...mandatory,
        thinkingLevelMap: { ...mandatory.thinkingLevelMap, off: undefined },
      },
      {},
    ).reasoning,
  ).toBe("low");
  const unavailable = {
    ...flash,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null,
    },
  };
  expect(() => shortThinkingLoopRetryOptions(unavailable, {})).toThrow(
    "no supported thinking retry level",
  );
  expect(
    shortThinkingLoopRetryOptions(
      { ...flash, reasoning: false },
      { reasoning: "high" },
    ).reasoning,
  ).toBeUndefined();
});

it("builds the actual DeepSeek provider request with thinking disabled and the same output cap", async () => {
  let captured: Record<string, unknown> | undefined;
  const options = shortThinkingLoopRetryOptions(flash, {
    reasoning: "high",
    maxTokens: 16384,
  });
  // Stop in the real transport's payload hook, before any network request.
  // This verifies serialization only, not model task success.
  const stream = provider.streamSimple(
    flash,
    {
      messages: [
        { role: "user", content: "Take the next action.", timestamp: 0 },
      ],
    },
    {
      ...options,
      apiKey: "unused-payload-test",
      onPayload(payload) {
        captured = payload as Record<string, unknown>;
        throw new Error("PAYLOAD_CAPTURE_COMPLETE");
      },
    },
  );
  for await (const _event of stream) {
    /* drain the expected terminal error */
  }
  expect(captured?.thinking).toEqual({ type: "disabled" });
  expect(captured?.reasoning_effort).toBeUndefined();
  expect(captured?.max_tokens ?? captured?.max_completion_tokens).toBe(16384);
});
