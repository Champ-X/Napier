import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { runAgentStepLifecycleStream } from "../src/agent-step-lifecycle-stream.js";
import {
  ComposableLifecycleExtensionPipeline,
  createAgentStepCapabilityView,
  type AgentStepLifecycleContext,
} from "../src/lifecycle-extension-pipeline.js";

const model = {
  api: "openai-responses",
  provider: "faux",
  id: "faux-1",
  name: "Faux",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
} satisfies Model<"openai-responses">;

function message(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function context(): AgentStepLifecycleContext {
  return {
    kind: "step",
    runId: "run-1",
    threadId: "thread-1",
    stepIndex: 1,
    model: { provider: model.provider, id: model.id },
    capabilityView: createAgentStepCapabilityView({
      toolNames: ["read"],
      schemaVersion: "tools-v1",
    }),
  };
}

describe("runAgentStepLifecycleStream", () => {
  it("streams deltas immediately but emits terminal evidence after finalize", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    const phases: string[] = [];
    pipeline.use({
      id: "test.stream-boundary",
      prepare: () => phases.push("prepare"),
      around: async (_context, next) => {
        phases.push("around:enter");
        const terminal = await next();
        phases.push(`around:exit:${terminal.type}`);
        return terminal;
      },
      finalize: () => phases.push("finalize"),
    });
    const final = message("ok");
    const stream = runAgentStepLifecycleStream({
      model,
      context: context(),
      pipeline,
      invoke: () => {
        const source = createAssistantMessageEventStream();
        queueMicrotask(() => {
          phases.push("provider:start");
          source.push({ type: "start", partial: final });
          source.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "ok",
            partial: final,
          });
          phases.push("provider:terminal");
          source.push({ type: "done", reason: "stop", message: final });
        });
        return source;
      },
    });
    const eventTypes: string[] = [];
    for await (const event of stream) eventTypes.push(event.type);

    expect(eventTypes).toEqual(["start", "text_delta", "done"]);
    expect(phases).toEqual([
      "prepare",
      "around:enter",
      "provider:start",
      "provider:terminal",
      "around:exit:done",
      "finalize",
    ]);
    await expect(stream.result()).resolves.toBe(final);
  });

  it("turns lifecycle failures into protocol error events", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    pipeline.use({
      id: "test.block",
      prepare: () => {
        throw new Error("step denied");
      },
    });
    const stream = runAgentStepLifecycleStream({
      model,
      context: context(),
      pipeline,
      invoke: () => {
        throw new Error("provider must not run");
      },
    });
    const events = [];
    for await (const event of stream) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: { stopReason: "error", errorMessage: "step denied" },
    });
  });
});
