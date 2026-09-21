import { expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxThinking,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { ModelSemanticStallObserver } from "../src/model-semantic-stall-observer.js";
import { aggregateRunUsage } from "../src/run-replay.js";
import type { RunEvent } from "@napier/contracts";
import { guardModelThinkingLoop } from "../src/model-thinking-loop-guard.js";
import {
  ModelThinkingLoopError,
  parseModelThinkingLoopError,
} from "../src/model-thinking-loop-policy.js";

const model = deepseekProvider()
  .getModels()
  .find((m) => m.id === "deepseek-v4-flash")!;

it("includes discarded-attempt receipts in durable Run and replay usage without counting assistant mirrors", () => {
  const events = [
    ["model.response", 100],
    ["message.assistant", 100],
    ["model.thinking_loop.detected", 30],
    ["model.context.overflow", 40],
    ["memory.extraction.completed", 20],
  ].map(([type, count]) => ({
    type,
    payload: {
      usage: {
        inputTokens: count,
        outputTokens: count,
        cacheReadTokens: count,
        cacheWriteTokens: 0,
        costUsd: Number(count) / 1000,
      },
    },
  })) as unknown as RunEvent[];
  events.push({
    type: "model.thinking_loop.detected",
    payload: { observedBytes: 4000 },
  } as unknown as RunEvent);
  expect(aggregateRunUsage(events, [])).toEqual({
    inputTokens: 190,
    outputTokens: 190,
    cacheReadTokens: 190,
    cacheWriteTokens: 0,
    costUsd: 0.19,
  });
});
function message(
  blocks = [fauxThinking("Inspect src/graph.mjs and execute the tests.")],
  stopReason = "stop",
) {
  return { ...fauxAssistantMessage(blocks), stopReason } as AssistantMessage;
}
function done(m: AssistantMessage): AssistantMessageEvent {
  return {
    type: "done",
    reason: m.stopReason,
    message: m,
  } as AssistantMessageEvent;
}

it.each(["stop", "length"])(
  "detects reasoning-only %s without requiring stream deltas",
  (reason) => {
    const evidence = new ModelSemanticStallObserver().terminalEvidence(
      done(message(undefined, reason)),
      1,
    )!;
    expect(evidence.reason).toBe("thinking_only_terminal");
    expect(
      parseModelThinkingLoopError(new ModelThinkingLoopError(evidence).message)
        ?.evidence,
    ).toEqual(evidence);
  },
);

it("preserves answers, tool calls, silent empty output and cancellation", () => {
  for (const m of [
    message([
      fauxThinking("Inspect src/graph.mjs"),
      fauxText("Verified result"),
    ]),
    message([
      fauxThinking("Inspect src/graph.mjs"),
      fauxToolCall("read_file", { path: "a" }),
    ]),
    message([]),
  ])
    expect(
      new ModelSemanticStallObserver().terminalEvidence(done(m), 1),
    ).toBeUndefined();
  const observer = new ModelSemanticStallObserver();
  observer.observe({
    type: "text_delta",
    delta: "Already visible",
  } as AssistantMessageEvent);
  expect(observer.terminalEvidence(done(message()), 1)).toBeUndefined();
  expect(
    new ModelSemanticStallObserver().terminalEvidence(
      {
        type: "error",
        reason: "aborted",
        error: message(undefined, "aborted"),
      },
      1,
    ),
  ).toBeUndefined();
});

it.each([true, false])(
  "bounds retries and preserves usage for terminal-only stream=%s",
  async (terminalOnly) => {
    const rejected = message();
    rejected.usage = {
      input: 1234,
      output: 51,
      cacheRead: 32,
      cacheWrite: 0,
      totalTokens: 1317,
      cost: {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.01,
        cacheWrite: 0,
        total: 0.31,
      },
    };
    const detections: unknown[] = [];
    const stream = guardModelThinkingLoop({
      model,
      context: { messages: [] },
      options: {},
      rootSignal: new AbortController().signal,
      async createSource() {
        const source = createAssistantMessageEventStream();
        if (terminalOnly) {
          source[Symbol.asyncIterator] = async function* () {};
          source.result = async () => rejected;
        } else {
          source.push(done(rejected));
          source.end(rejected);
        }
        return { source, context: { messages: [] }, options: {} };
      },
      onDetected(evidence, action, terminal) {
        expect(terminal?.usage).toEqual(rejected.usage);
        detections.push([evidence.reason, action]);
        return action;
      },
    });
    const events = [];
    for await (const event of stream) events.push(event);
    expect(detections).toEqual([
      ["thinking_only_terminal", "retry"],
      ["thinking_only_terminal", "finalize"],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect((await stream.result()).stopReason).toBe("error");
  },
);
