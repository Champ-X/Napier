import type { Context, Model, Api } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  createContextProjectionReceipt,
  validateContextProjectionReceipt,
} from "../src/context-projection-receipt.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { projectModelContextTokenPressure } from "../src/model-context-token-pressure.js";
import { PROMPT_INVARIANT_CORE } from "../src/prompt-invariant-core.js";
import { compilePrompt } from "../src/prompt-compiler.js";
import {
  modelContextMessageSetSha256,
  modelContextToolDefinitionSetSha256,
} from "../src/token-meter-content.js";
import { pruneToolResultContext } from "../src/tool-result-context-pruner.js";

describe("Context Projection receipt", () => {
  it("binds every model-visible component and transition without raw content", () => {
    const model = fixtureModel();
    const context: Context = {
      messages: [
        user("private durable request"),
        {
          role: "toolResult",
          toolCallId: "call_private",
          toolName: "run_command",
          content: [
            {
              type: "text",
              text: `sensitive tool result ${"x".repeat(40_000)}`,
            },
          ],
          isError: false,
          timestamp: 2,
        },
      ],
      tools: [tool("private_tool")],
    };
    const pruning = pruneToolResultContext(context, 1);
    const compiledPrompt = compiled(model);
    const pressure = projectModelContextTokenPressure({
      model,
      context: pruning.context,
      options: { maxTokens: 700, cacheRetention: "long" },
      compiledPrompt,
      modelAttempt: 1,
      recoveryAttempt: 0,
    });
    const receipt = createContextProjectionReceipt({
      provider: model.provider,
      model: model.id,
      modelAttempt: 1,
      recoveryAttempt: 0,
      toolCount: context.tools!.length,
      toolDefinitionSetSha256: modelContextToolDefinitionSetSha256(
        context.tools!,
      ),
      compiledPrompt,
      prepared: {
        durableMessageCount: context.messages.length,
        durableMessageSetSha256: modelContextMessageSetSha256(context.messages),
        prePruningMessageCount: context.messages.length,
        prePruningMessageSetSha256: modelContextMessageSetSha256(
          context.messages,
        ),
        postPruningMessageCount: pruning.context.messages.length,
        postPruningMessageSetSha256: modelContextMessageSetSha256(
          pruning.context.messages,
        ),
        pruning: pruning.receipt,
      },
      pressure: pressure.receipt,
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: "napier.context-projection",
        schemaVersion: 1,
        status: "projected",
        durableMessageSource: "durable_run_context",
        skillCatalog: "included",
        memory: "included",
        compactionCheckpoint: "included",
        toolResultPruning: "applied",
        prunedToolResultCount: 1,
        tokenProjection: "none",
        cacheRetention: "long",
        cacheRetentionSource: "caller",
        activeEstimatedInputTokens: expect.any(Number),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(receipt.durableMessageSetSha256).not.toBe(
      receipt.postPruningMessageSetSha256,
    );
    expect(receipt.postPruningMessageSetSha256).toBe(
      receipt.preparedMessageSetSha256,
    );
    expect(validateContextProjectionReceipt(receipt)).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(
      /private durable request|sensitive tool result|private_tool|secret skill|secret memory|secret checkpoint|task\.skill_catalog|workspace\.memory/u,
    );
  });

  it("rejects tampering and invalid projection state", () => {
    const receipt = basicReceipt();
    expect(() =>
      validateContextProjectionReceipt({
        ...receipt,
        activeMessageCount: receipt.activeMessageCount + 1,
      }),
    ).toThrow("Context Projection receipt is invalid");
    expect(() =>
      validateContextProjectionReceipt({ ...receipt, unexpected: true }),
    ).toThrow("Context Projection receipt is invalid");
    const invalidDurableBinding = {
      ...receipt,
      durableMessageSetSha256:
        receipt.prePruningMessageSetSha256 === "0".repeat(64)
          ? "1".repeat(64)
          : "0".repeat(64),
    };
    const { contentSha256: _durableHash, ...durableContent } =
      invalidDurableBinding;
    expect(() =>
      validateContextProjectionReceipt({
        ...durableContent,
        contentSha256: sha256(canonicalJson(durableContent)),
      }),
    ).toThrow("Context Projection receipt is invalid");
    const invalidState = {
      ...receipt,
      status: "projected" as const,
    };
    const { contentSha256: _contentSha256, ...content } = invalidState;
    expect(() =>
      validateContextProjectionReceipt({
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      }),
    ).toThrow("Context Projection receipt is invalid");
  });
});

function basicReceipt() {
  const model = fixtureModel();
  const context: Context = { messages: [user("hello")], tools: [] };
  const pruning = pruneToolResultContext(context, 1);
  const compiledPrompt = compiled(model, false);
  const pressure = projectModelContextTokenPressure({
    model,
    context,
    options: { maxTokens: 700 },
    compiledPrompt,
    modelAttempt: 1,
    recoveryAttempt: 0,
  });
  const messageSetSha256 = modelContextMessageSetSha256(context.messages);
  return createContextProjectionReceipt({
    provider: model.provider,
    model: model.id,
    modelAttempt: 1,
    recoveryAttempt: 0,
    toolCount: 0,
    toolDefinitionSetSha256: modelContextToolDefinitionSetSha256([]),
    compiledPrompt,
    prepared: {
      durableMessageCount: 1,
      durableMessageSetSha256: messageSetSha256,
      prePruningMessageCount: 1,
      prePruningMessageSetSha256: messageSetSha256,
      postPruningMessageCount: 1,
      postPruningMessageSetSha256: messageSetSha256,
      pruning: pruning.receipt,
    },
    pressure: pressure.receipt,
  });
}

function compiled(model: Model<Api>, contextSources = true) {
  const adapter = modelAdapterReceipt(model, {
    cacheRetention: "long",
    maxTokens: 700,
  });
  return compilePrompt({
    purpose: "agent_turn",
    adapter,
    layers: [
      {
        id: "invariant_core",
        priority: 1_000,
        budgetBytes: 1_024,
        sources: [
          {
            sourceId: "runtime.invariant_core",
            content: PROMPT_INVARIANT_CORE,
            priority: 1_000,
            required: true,
          },
        ],
      },
      {
        id: "effective_capabilities",
        priority: 800,
        budgetBytes: 1_024,
        sources: [],
      },
      {
        id: "task_skill_overlay",
        priority: 700,
        budgetBytes: 1_024,
        sources: contextSources
          ? [
              {
                sourceId: "task.skill_catalog",
                content: "secret skill",
                priority: 1,
              },
            ]
          : [],
      },
      {
        id: "workspace_context",
        priority: 600,
        budgetBytes: 1_024,
        sources: contextSources
          ? [
              {
                sourceId: "workspace.memory",
                content: "secret memory",
                priority: 1,
              },
              {
                sourceId: "workspace.checkpoint",
                content: "secret checkpoint",
                priority: 2,
              },
            ]
          : [],
      },
    ],
  });
}

function user(content: string) {
  return { role: "user" as const, content, timestamp: 1 };
}

function tool(name: string) {
  return {
    name,
    description: "private definition",
    parameters: { type: "object" },
  };
}

function fixtureModel(): Model<Api> {
  return {
    provider: "openai",
    id: "gpt-test",
    name: "Test",
    api: "openai-responses",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16_384,
    maxTokens: 1_024,
  };
}
