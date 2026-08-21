import {
  fauxAssistantMessage,
  fauxToolCall,
  type Api,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { modelAdapterReceipt } from "../src/model-adapters.js";
import {
  contextHistoryCharacterBudget,
  measureModelContext,
  modelContextTokenCalibration,
} from "../src/model-context-token-meter.js";
import { projectModelContextTokenPressure } from "../src/model-context-token-pressure.js";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";

describe("model context token pressure", () => {
  it("meters every context component with provider calibration and reserves", () => {
    const model = fixtureModel({ provider: "anthropic", id: "claude-test" });
    const compiledPrompt = compiled(model, "System 你好");
    const context: Context = {
      messages: [user("ASCII and 中文")],
      tools: [tool("read_file", "Read a file")],
    };
    const measured = measureModelContext({
      model,
      compiledPrompt,
      context,
      options: { maxTokens: 700 },
      recoveryAttempt: 0,
    });

    expect(modelContextTokenCalibration(model).id).toBe("anthropic_claude.v1");
    expect(measured).toEqual(
      expect.objectContaining({
        contextWindowTokens: model.contextWindow,
        outputReserveTokens: 700,
        reasoningReserveTokens: expect.any(Number),
        safetyReserveTokens: expect.any(Number),
      }),
    );
    expect(measured.systemPrompt.bytes).toBeGreaterThan("System 你好".length);
    expect(measured.tools.estimatedTokens).toBeGreaterThan(0);
    expect(measured.messages.estimatedTokens).toBeGreaterThan(0);
    expect(measured.estimatedTotalTokens).toBe(
      measured.estimatedInputTokens +
        measured.outputReserveTokens +
        measured.reasoningReserveTokens +
        measured.safetyReserveTokens,
    );
    expect(contextHistoryCharacterBudget(model)).toBeLessThan(
      model.contextWindow,
    );
  });

  it("is byte-stable within budget", () => {
    const model = fixtureModel();
    const context: Context = {
      messages: [user("Keep this exact request.")],
      tools: [tool("read_file", "Read a file")],
    };
    const projection = project(model, context);

    expect(projection.context).toBe(context);
    expect(projection.receipt).toEqual(
      expect.objectContaining({
        status: "within_budget",
        projection: "none",
        removedMessageCount: 0,
        originalMessageSetSha256: projection.receipt.activeMessageSetSha256,
      }),
    );
  });

  it("removes oldest complete units without splitting tool exchanges", () => {
    const model = fixtureModel({
      contextWindow: 1_800,
      maxTokens: 400,
      reasoning: false,
    });
    const call = fauxToolCall("read_file", { path: "old.txt" });
    const assistant = fauxAssistantMessage(call, { stopReason: "toolUse" });
    const oldResult = {
      role: "toolResult" as const,
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text" as const, text: "r".repeat(2_500) }],
      isError: false,
      timestamp: 2,
    };
    const latest = user("Latest protected instruction " + "x".repeat(800), 3);
    const context: Context = {
      messages: [user("old request", 1), assistant, oldResult, latest],
      tools: [tool("read_file", "Read a file")],
    };
    const projection = project(model, context);

    expect(projection.receipt.status).toBe("projected");
    expect(projection.receipt.removedMessageCount).toBe(3);
    expect(projection.context.messages).toEqual([latest]);
    expect(projection.context.tools).toBe(context.tools);
  });

  it("fails closed when the protected suffix and reserves cannot fit", () => {
    const model = fixtureModel({
      contextWindow: 1_200,
      maxTokens: 500,
      reasoning: false,
    });
    const context: Context = {
      messages: [user("Protected " + "z".repeat(4_000))],
      tools: [tool("read_file", "Read a file")],
    };
    const projection = project(model, context);

    expect(projection.receipt).toEqual(
      expect.objectContaining({
        status: "unavailable",
        failureReason: "protected_context_exceeds_window",
        removedMessageCount: 0,
      }),
    );
  });

  it("rejects orphan or incomplete tool exchanges", () => {
    const model = fixtureModel({
      contextWindow: 1_400,
      maxTokens: 400,
      reasoning: false,
    });
    const call = fauxToolCall("read_file", { path: "old.txt" });
    const context: Context = {
      messages: [
        fauxAssistantMessage(call, { stopReason: "toolUse" }),
        user("latest " + "x".repeat(2_000)),
      ],
      tools: [tool("read_file", "Read a file")],
    };

    expect(() => project(model, context)).toThrow(
      "tool exchange is incomplete",
    );
  });
});

function project(model: Model<Api>, context: Context) {
  return projectModelContextTokenPressure({
    model,
    context,
    options: { maxTokens: Math.min(model.maxTokens, 700) },
    compiledPrompt: compiled(model, "Stable system prompt."),
    modelAttempt: 1,
    recoveryAttempt: 0,
  });
}

function compiled(model: Model<Api>, systemPrompt: string) {
  return compileAuxiliaryPrompt({
    purpose: "context_compaction",
    sourceId: "test.system",
    systemPrompt,
    adapter: modelAdapterReceipt(model),
  });
}

function user(content: string, timestamp = 1) {
  return { role: "user" as const, content, timestamp };
}

function tool(name: string, description: string) {
  return { name, description, parameters: { type: "object", properties: {} } };
}

function fixtureModel(override: Partial<Model<Api>> = {}): Model<Api> {
  return {
    provider: "openai",
    id: "gpt-test",
    name: "Test",
    api: "openai-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
    ...override,
  };
}
