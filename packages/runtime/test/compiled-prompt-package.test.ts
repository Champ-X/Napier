import { describe, expect, it } from "vitest";

import {
  COMPILED_PROMPT_PACKAGE_VERSION,
  createCompiledPromptPackageReceipt,
  validateCompiledPromptPackageReceipt,
} from "../src/compiled-prompt-package.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";

describe("compiled Prompt package", () => {
  it("partitions a real-shaped Prompt losslessly into five hash-only layers", () => {
    const systemPrompt = [
      "Invariant identity and completion rules. 中文",
      [
        "<workspace_tool_protocol>",
        "Only describe tools that are available.",
        "</workspace_tool_protocol>",
      ].join("\n"),
      [
        "The following skills provide specialized instructions for specific tasks.",
        "<available_skills>",
        "  <skill><name>artifact-studio</name></skill>",
        "</available_skills>",
      ].join("\n"),
      [
        "<memory_context>",
        "Reviewed workspace fact.",
        "</memory_context>",
      ].join("\n"),
      [
        "<plan_tool_protocol>",
        "Verify planned artifacts.",
        "</plan_tool_protocol>",
      ].join("\n"),
      "Unclassified trailing rules stay in the invariant layer.",
    ].join("\n\n");
    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 3,
      systemPrompt,
      messages: [{ role: "user", content: "Private request" }],
      tools: [
        {
          name: "read_file",
          description: "Read one file",
          parameters: { type: "object" },
        },
      ],
    });
    const adapter = modelAdapterReceipt(model("anthropic-messages"));

    const receipt = createCompiledPromptPackageReceipt({
      systemPrompt,
      envelope,
      adapter,
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: "napier.compiled-prompt-package",
        schemaVersion: 1,
        packageVersion: COMPILED_PROMPT_PACKAGE_VERSION,
        turnIndex: 3,
        classification: "conservative_tagged_v1",
        tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
        systemPromptSha256: envelope.systemPromptSha256,
        systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
        lossless: true,
        effectiveCapabilities: {
          toolCount: 1,
          toolNameSetSha256: envelope.toolNameSetSha256,
          toolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
        },
        modelAdapter: {
          adapterId: "napier.anthropic-messages.v1",
          adapterContentSha256: adapter.contentSha256,
        },
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(receipt.layers.map((layer) => layer.id)).toEqual([
      "invariant_core",
      "effective_capabilities",
      "task_skill_overlay",
      "workspace_context",
      "model_adapter",
    ]);
    expect(
      receipt.layers.find((layer) => layer.id === "invariant_core"),
    ).toEqual(
      expect.objectContaining({
        source: "system_prompt",
        segmentCount: 5,
        bytes: expect.any(Number),
        estimatedTokens: expect.any(Number),
      }),
    );
    expect(
      receipt.layers.find((layer) => layer.id === "effective_capabilities"),
    ).toEqual(expect.objectContaining({ segmentCount: 2 }));
    expect(
      receipt.layers.find((layer) => layer.id === "task_skill_overlay"),
    ).toEqual(expect.objectContaining({ segmentCount: 1 }));
    expect(
      receipt.layers.find((layer) => layer.id === "workspace_context"),
    ).toEqual(expect.objectContaining({ segmentCount: 1 }));
    expect(
      receipt.layers.find((layer) => layer.id === "model_adapter"),
    ).toEqual({
      id: "model_adapter",
      source: "request_options",
      segmentCount: 0,
      bytes: 0,
      estimatedTokens: 0,
      contentSha256: adapter.contentSha256,
    });
    expect(validateCompiledPromptPackageReceipt(receipt)).toEqual(receipt);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("Invariant identity");
    expect(serialized).not.toContain("artifact-studio");
    expect(serialized).not.toContain("Reviewed workspace fact");
    expect(serialized).not.toContain("Private request");
    expect(serialized).not.toContain("read_file");
  });

  it("rejects envelope drift and tampered layer evidence", () => {
    const systemPrompt = "Invariant";
    const envelope = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt,
      messages: [],
      tools: [],
    });
    const adapter = modelAdapterReceipt(model("openai-responses"));
    expect(() =>
      createCompiledPromptPackageReceipt({
        systemPrompt: `${systemPrompt} drift`,
        envelope,
        adapter,
      }),
    ).toThrow("envelope binding");

    const receipt = createCompiledPromptPackageReceipt({
      systemPrompt,
      envelope,
      adapter,
    });
    const layers = structuredClone(receipt.layers);
    layers[0]!.bytes += 1;
    expect(() =>
      validateCompiledPromptPackageReceipt({
        ...receipt,
        layers,
      }),
    ).toThrow("layer totals");
    const tokenLayers = structuredClone(receipt.layers);
    tokenLayers[0]!.estimatedTokens += 1;
    expect(() =>
      validateCompiledPromptPackageReceipt({
        ...receipt,
        estimatedTokens: receipt.estimatedTokens + 1,
        layers: tokenLayers,
      }),
    ).toThrow("layer source");
    expect(() =>
      validateCompiledPromptPackageReceipt({
        ...receipt,
        contentSha256: "f".repeat(64),
      }),
    ).toThrow("hash mismatch");
  });
});

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
    contextWindow: 8_192,
    maxTokens: 2_048,
  };
}
