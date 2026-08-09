import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { compiledPromptPackageViews } from "../src/compiled-prompt-package-view";

describe("compiled Prompt package trace view", () => {
  it("projects only strict hash-only five-layer receipts", () => {
    const valid = event(receipt());
    const promptInjected = event({
      ...receipt(),
      systemPrompt: "TOP_SECRET_SYSTEM_PROMPT",
    });
    const totalDrifted = event({
      ...receipt(),
      systemPromptBytes: 121,
      contentSha256: "f".repeat(64),
    });

    expect(
      compiledPromptPackageViews([valid, promptInjected, totalDrifted]),
    ).toEqual([
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
    ]);
  });

  it("projects a bound v2 Invariant Core and rejects binding drift", () => {
    const modern = receipt();
    modern["schemaVersion"] = 2;
    modern["packageVersion"] = "napier.prompt-context.v2";
    modern["purpose"] = "agent_turn";
    modern["invariantCore"] = {
      status: "bound",
      version: "napier.invariant-core.v1",
      contentSha256:
        "4bd4be0290317713104cbeb5dca77e3ec62757849e3bea0fb14645f54beeadda",
      bytes: 922,
    };
    modern["modelAdapter"] = {
      adapterId: "napier.anthropic-messages.v2",
      adapterContentSha256: "2".repeat(64),
    };
    const drifted = structuredClone(modern);
    (drifted["invariantCore"] as Record<string, JsonValue>)["version"] =
      "napier.invariant-core.v2";

    expect(compiledPromptPackageViews([event(modern), event(drifted)])).toEqual(
      [
        expect.objectContaining({
          packageVersion: "napier.prompt-context.v2",
          purpose: "agent_turn",
          invariantCore: {
            status: "bound",
            version: "napier.invariant-core.v1",
            contentSha256:
              "4bd4be0290317713104cbeb5dca77e3ec62757849e3bea0fb14645f54beeadda",
            bytes: 922,
          },
        }),
      ],
    );
  });
});

function receipt(): Record<string, JsonValue> {
  return {
    kind: "napier.compiled-prompt-package",
    schemaVersion: 1,
    packageVersion: "napier.prompt-context.v1",
    turnIndex: 2,
    classification: "conservative_tagged_v1",
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
    systemPromptSha256: "a".repeat(64),
    systemPromptBytes: 120,
    estimatedTokens: 31,
    segmentCount: 5,
    partitionSha256: "b".repeat(64),
    lossless: true,
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
    effectiveCapabilities: {
      toolCount: 4,
      toolNameSetSha256: "3".repeat(64),
      toolDefinitionSetSha256: "4".repeat(64),
    },
    modelAdapter: {
      adapterId: "napier.anthropic-messages.v1",
      adapterContentSha256: "2".repeat(64),
    },
    contentSha256: "5".repeat(64),
  };
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

function event(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_prompt_package",
    threadId: "thread_prompt_package",
    runId: "run_prompt_package",
    seq: 31,
    type: "context.prompt_package",
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}
