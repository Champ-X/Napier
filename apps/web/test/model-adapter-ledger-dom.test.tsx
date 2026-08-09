import { describe, expect, it } from "vitest";

import {
  CompiledPromptPackageLedger,
  ModelAdapterLedger,
} from "../src/ModelContextTraceLedgers";

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
    expect(text).not.toContain("TOP_SECRET");
  });

  it("renders five Prompt layers without raw Prompt or tool names", () => {
    const tree = CompiledPromptPackageLedger({
      packages: [
        {
          eventSeq: 31,
          runId: "run_prompt_package",
          turnIndex: 2,
          packageVersion: "napier.prompt-context.v1",
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
    expect(text).toContain("120");
    expect(text).toContain("~10 tok");
    expect(text).toContain("napier.anthropic-messages.v1");
    expect(text).not.toContain("TOP_SECRET_SYSTEM_PROMPT");
    expect(text).not.toContain("read_file");
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
