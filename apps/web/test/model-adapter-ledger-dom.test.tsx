import { describe, expect, it } from "vitest";

import {
  CompiledPromptPackageLedger,
  ModelAdapterLedger,
  ModelContextEnvelopeLedger,
} from "../src/ModelContextTraceLedgers";
import { ToolResultContextPruningLedger } from "../src/ToolResultContextPruningLedger";

describe("Model Adapter ledger", () => {
  it("renders policy evidence without raw provider context", () => {
    const tree = ModelAdapterLedger({
      adapters: [
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
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("Provider request policies");
    expect(text).toContain("anthropic · v1");
    expect(text).toContain("anthropic-messages");
    expect(text).toContain("long");
    expect(text).toContain("napier.anthropic-messages.v1");
    expect(text).toContain("a".repeat(12));
    expect(text).toContain("Legacy unavailable");
    expect(text).not.toContain("TOP_SECRET");
  });

  it("renders context savings and pruning reasons without raw tool output", () => {
    const tree = ToolResultContextPruningLedger({
      pruning: [{
        eventSeq: 24,
        runId: "run_pruning",
        attempt: 1,
        messageCount: 20,
        toolResultCount: 8,
        replacementCount: 4,
        supersededResultCount: 1,
        repeatedErrorCount: 1,
        largeResultCount: 1,
        emptyResultCount: 1,
        originalToolResultTextBytes: 60_000,
        activeToolResultTextBytes: 24_000,
        savedToolResultTextBytes: 36_000,
        originalToolResultSetSha256: "a".repeat(64),
        activeToolResultSetSha256: "b".repeat(64),
        replacementSetSha256: "c".repeat(64),
        contentSha256: "d".repeat(64),
      }],
    });
    const text = visibleText(tree);

    expect(text).toContain("Tool-result context budget");
    expect(text).toContain("35.2 KiB");
    expect(text).toContain("Superseded1");
    expect(text).toContain("Repeated errors1");
    expect(text).toContain("60000 B → 24000 B");
    expect(text).not.toContain("TOP_SECRET_TOOL_OUTPUT");
  });

  it("renders v2 output-token policy", () => {
    const tree = ModelAdapterLedger({
      adapters: [
        {
          eventSeq: 22,
          runId: "run_adapter_v2",
          adapterId: "napier.openai-family.v2",
          family: "openai",
          adapterVersion: 2,
          modelApi: "openai-responses",
          cacheRetention: "short",
          cacheRetentionSource: "adapter",
          streamOptionMaxTokens: 16_384,
          streamOptionMaxTokensSource: "adapter",
          modelMaxTokens: 64_000,
          contentSha256: "b".repeat(64),
        },
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("openai · v2");
    expect(text).toContain("16384");
    expect(text).toContain("64000");
    expect(text).toContain("Token source");
    expect(text).toContain("adapter");
  });

  it("renders v2 tool schema cost without raw definitions", () => {
    const tree = ModelContextEnvelopeLedger({
      envelopes: [
        {
          eventSeq: 23,
          runId: "run_envelope_v2",
          schemaVersion: 2,
          turnIndex: 0,
          systemPromptBytes: 5_768,
          messageCount: 1,
          userMessageCount: 1,
          assistantMessageCount: 0,
          toolResultMessageCount: 0,
          otherMessageCount: 0,
          toolCount: 20,
          toolDefinitionBytes: 31_462,
          toolDefinitionEstimatedTokens: 7_866,
          toolDefinitionTokenEstimateMethod: "ceil_utf8_bytes_div_4",
          systemPromptSha256: "1".repeat(64),
          messageSetSha256: "2".repeat(64),
          toolNameSetSha256: "3".repeat(64),
          toolDefinitionSetSha256: "4".repeat(64),
          contentSha256: "5".repeat(64),
        },
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("Tool schema bytes");
    expect(text).toContain("31462");
    expect(text).toContain("Tool schema est.");
    expect(text).toContain("~7866 tok");
    expect(text).not.toContain("read_file");
    expect(text).not.toContain("TOP_SECRET_SCHEMA");
  });

  it("renders five Prompt layers without raw Prompt or tool names", () => {
    const tree = CompiledPromptPackageLedger({
      packages: [
        {
          eventSeq: 31,
          runId: "run_prompt_package",
          turnIndex: 2,
          packageVersion: "napier.prompt-context.v1",
          invariantCore: { status: "legacy_unavailable" },
          classification: "conservative_tagged_v1",
          tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
          systemPromptBytes: 120,
          estimatedTokens: 31,
          segmentCount: 5,
          systemPromptSha256: "a".repeat(64),
          partitionSha256: "b".repeat(64),
          layers: [
            layer("invariant_core", 40, 10, 2, "c"),
            layer("effective_capabilities", 30, 8, 1, "d"),
            layer("task_skill_overlay", 20, 5, 1, "e"),
            layer("workspace_context", 30, 8, 1, "1"),
            {
              id: "model_adapter",
              source: "request_options",
              segmentCount: 0,
              bytes: 0,
              estimatedTokens: 0,
              contentSha256: "2".repeat(64),
            },
          ],
          toolCount: 4,
          toolNameSetSha256: "3".repeat(64),
          toolDefinitionSetSha256: "4".repeat(64),
          adapterId: "napier.anthropic-messages.v1",
          adapterContentSha256: "2".repeat(64),
          contentSha256: "5".repeat(64),
        },
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("Compiled context layers");
    expect(text).toContain("Turn 2 · lossless");
    expect(text).toContain("Invariant Core");
    expect(text).toContain("Effective Capabilities");
    expect(text).toContain("Task / Skill Overlay");
    expect(text).toContain("Workspace Context");
    expect(text).toContain("Model Adapter");
    expect(text).toContain("legacy unavailable");
    expect(text).toContain("120");
    expect(text).toContain("~10 tok");
    expect(text).toContain("napier.anthropic-messages.v1");
    expect(text).not.toContain("TOP_SECRET_SYSTEM_PROMPT");
    expect(text).not.toContain("read_file");
  });

  it("renders the bound Invariant Core version without Prompt content", () => {
    const tree = CompiledPromptPackageLedger({
      packages: [
        {
          eventSeq: 32,
          runId: "run_prompt_package_v2",
          turnIndex: 0,
          packageVersion: "napier.prompt-context.v2",
          purpose: "agent_turn",
          invariantCore: {
            status: "bound",
            version: "napier.invariant-core.v1",
            contentSha256:
              "4bd4be0290317713104cbeb5dca77e3ec62757849e3bea0fb14645f54beeadda",
            bytes: 922,
          },
          classification: "conservative_tagged_v1",
          tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
          systemPromptBytes: 120,
          estimatedTokens: 31,
          segmentCount: 5,
          systemPromptSha256: "a".repeat(64),
          partitionSha256: "b".repeat(64),
          layers: [
            layer("invariant_core", 40, 10, 2, "c"),
            layer("effective_capabilities", 30, 8, 1, "d"),
            layer("task_skill_overlay", 20, 5, 1, "e"),
            layer("workspace_context", 30, 8, 1, "1"),
            {
              id: "model_adapter",
              source: "request_options",
              segmentCount: 0,
              bytes: 0,
              estimatedTokens: 0,
              contentSha256: "2".repeat(64),
            },
          ],
          toolCount: 4,
          toolNameSetSha256: "3".repeat(64),
          toolDefinitionSetSha256: "4".repeat(64),
          adapterId: "napier.anthropic-messages.v2",
          adapterContentSha256: "2".repeat(64),
          contentSha256: "5".repeat(64),
        },
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("napier.invariant-core.v1");
    expect(text).toContain("922 B");
    expect(text).toContain("4bd4be029031");
    expect(text).not.toContain("Identity and scope");
  });
});

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (!value || typeof value !== "object") return "";
  const props = (value as { props?: { children?: unknown } }).props;
  return props ? visibleText(props.children) : "";
}

function layer(
  id:
    | "invariant_core"
    | "effective_capabilities"
    | "task_skill_overlay"
    | "workspace_context",
  bytes: number,
  estimatedTokens: number,
  segmentCount: number,
  hashCharacter: string,
) {
  return {
    id,
    source: "system_prompt" as const,
    segmentCount,
    bytes,
    estimatedTokens,
    contentSha256: hashCharacter.repeat(64),
  };
}
