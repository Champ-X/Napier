import { describe, expect, it } from "vitest";

import {
  createCompiledPromptPackageReceiptV3,
  validateCompiledPromptPackageReceipt,
} from "../src/compiled-prompt-package.js";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import {
  compilePrompt,
  type PromptCompilerLayerInput,
} from "../src/prompt-compiler.js";
import { PROMPT_INVARIANT_CORE } from "../src/prompt-invariant-core.js";

describe("Prompt Compiler", () => {
  it("assembles five independent layers deterministically and omits lower-priority sources by budget", () => {
    const adapter = modelAdapterReceipt(model("anthropic-messages"));
    const layers = compilerLayers();
    const first = compilePrompt({ purpose: "agent_turn", layers, adapter });
    const replay = compilePrompt({ purpose: "agent_turn", layers, adapter });

    expect(replay.systemPrompt).toBe(first.systemPrompt);
    expect(replay.systemPromptSha256).toBe(first.systemPromptSha256);
    expect(first.layers.map((layer) => layer.id)).toEqual([
      "invariant_core",
      "effective_capabilities",
      "task_skill_overlay",
      "workspace_context",
      "model_adapter",
    ]);
    expect(first.systemPrompt.startsWith(PROMPT_INVARIANT_CORE)).toBe(true);
    expect(first.systemPrompt).toContain("Required task method");
    expect(first.systemPrompt).not.toContain("low priority overflow");
    expect(first.layers[2]).toEqual(
      expect.objectContaining({
        budgetBytes: 64,
        trimmingReason: "budget_exceeded",
        sources: [
          expect.objectContaining({
            sourceId: "task.required",
            included: true,
            trimmingReason: "within_budget",
          }),
          expect.objectContaining({
            sourceId: "task.optional",
            included: false,
            trimmingReason: "lower_priority_source_omitted",
          }),
        ],
      }),
    );

    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 2,
      systemPrompt: first.systemPrompt,
      messages: [{ role: "user", content: "private" }],
      tools: [{ name: "read_file", parameters: { type: "object" } }],
    });
    const receipt = createCompiledPromptPackageReceiptV3({
      compiled: first,
      envelope,
      adapter,
      purpose: "agent_turn",
    });
    expect(validateCompiledPromptPackageReceipt(receipt)).toEqual(receipt);
    expect(receipt).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        packageVersion: "napier.prompt-context.v3",
        classification: "independent_layers_v1",
        compilerVersion: "napier.prompt-compiler.v1",
        systemPromptSha256: first.systemPromptSha256,
      }),
    );
    expect(JSON.stringify(receipt)).not.toContain("Required task method");
    expect(JSON.stringify(receipt)).not.toContain("low priority overflow");
    expect(JSON.stringify(receipt)).not.toContain("private");
    expect(JSON.stringify(receipt)).not.toContain("read_file");
  });

  it("compiles distinct Adapter layers for Anthropic and OpenAI-family calls", () => {
    const layers = compilerLayers();
    const anthropic = compilePrompt({
      purpose: "agent_turn",
      layers,
      adapter: modelAdapterReceipt(model("anthropic-messages")),
    });
    const openai = compilePrompt({
      purpose: "agent_turn",
      layers,
      adapter: modelAdapterReceipt(model("openai-responses")),
    });

    expect(anthropic.systemPrompt).toContain("Anthropic Messages schemas");
    expect(openai.systemPrompt).toContain("OpenAI-family function schemas");
    expect(anthropic.layers[4]?.contentSha256).not.toBe(
      openai.layers[4]?.contentSha256,
    );
    expect(anthropic.systemPromptSha256).not.toBe(openai.systemPromptSha256);
  });

  it.each([
    ["context_compaction", "task.context_compaction"],
    ["goal_evaluation", "task.goal_evaluation"],
    ["memory_extraction", "task.memory_extraction"],
  ] as const)(
    "compiles the %s auxiliary purpose without Agent-turn invariants",
    (purpose, sourceId) => {
      const adapter = modelAdapterReceipt(model("openai-responses"));
      const compiled = compileAuxiliaryPrompt({
        purpose,
        sourceId,
        systemPrompt: `Specialized ${purpose} instructions`,
        adapter,
      });
      const envelope = createModelContextEnvelopeReceipt({
        turnIndex: 4,
        systemPrompt: compiled.systemPrompt,
        messages: [],
        tools: [],
      });
      const receipt = createCompiledPromptPackageReceiptV3({
        compiled,
        envelope,
        adapter,
        purpose,
      });

      expect(compiled.systemPrompt).toContain(
        `Specialized ${purpose} instructions`,
      );
      expect(compiled.systemPrompt).toContain("OpenAI-family function schemas");
      expect(receipt.invariantCore).toEqual({ status: "not_applicable" });
      expect(receipt.layers[2]?.sources).toEqual([
        expect.objectContaining({ sourceId, included: true }),
      ]);
    },
  );

  it("rejects compiled artifact and Adapter-layer receipt drift", () => {
    const adapter = modelAdapterReceipt(model("openai-responses"));
    const compiled = compilePrompt({
      purpose: "agent_turn",
      layers: compilerLayers(),
      adapter,
    });
    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: compiled.systemPrompt,
      messages: [],
      tools: [],
    });
    expect(() =>
      createCompiledPromptPackageReceiptV3({
        compiled: { ...compiled, systemPrompt: `${compiled.systemPrompt}x` },
        envelope,
        adapter,
        purpose: "agent_turn",
      }),
    ).toThrow("artifact binding");

    const receipt = createCompiledPromptPackageReceiptV3({
      compiled,
      envelope,
      adapter,
      purpose: "agent_turn",
    });
    const layers = structuredClone(receipt.layers);
    layers[4]!.sources[0]!.sourceId = "model_adapter.anthropic";
    layers[4]!.inputContentSha256 = sha256(
      canonicalJson(
        layers[4]!.sources.map(
          ({ sourceId, priority, required, inputContentSha256 }) => ({
            sourceId,
            priority,
            required,
            contentSha256: inputContentSha256,
          }),
        ),
      ),
    );
    expect(() =>
      validateCompiledPromptPackageReceipt({ ...receipt, layers }),
    ).toThrow("Adapter layer binding");
  });
});

function compilerLayers(): PromptCompilerLayerInput[] {
  return [
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
      budgetBytes: 128,
      sources: [
        {
          sourceId: "capabilities.tools",
          content: "Use only the tools supplied to this request.",
          priority: 1_000,
          required: true,
        },
      ],
    },
    {
      id: "task_skill_overlay",
      priority: 700,
      budgetBytes: 64,
      sources: [
        {
          sourceId: "task.required",
          content: "Required task method",
          priority: 1_000,
          required: true,
        },
        {
          sourceId: "task.optional",
          content: `low priority overflow ${"x".repeat(100)}`,
          priority: 1,
        },
      ],
    },
    {
      id: "workspace_context",
      priority: 600,
      budgetBytes: 128,
      sources: [
        {
          sourceId: "workspace.rules",
          content: "Workspace rule",
          priority: 900,
        },
      ],
    },
  ];
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
    contextWindow: 64_000,
    maxTokens: 16_384,
  };
}
