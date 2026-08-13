import { describe, expect, it } from "vitest";

import {
  COMPILED_PROMPT_PACKAGE_VERSION,
  validateCompiledPromptPackageReceipt,
  type CompiledPromptPackageReceiptV2,
} from "../src/compiled-prompt-package.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import {
  compilePromptInvariantCore,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "../src/prompt-invariant-core.js";

describe("historical compiled Prompt package", () => {
  it("continues to validate replayed v2 receipts without retaining the regex creator", () => {
    const receipt = historicalReceipt();

    expect(validateCompiledPromptPackageReceipt(receipt)).toEqual(receipt);
    expect(receipt).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        packageVersion: COMPILED_PROMPT_PACKAGE_VERSION,
        classification: "conservative_tagged_v1",
        invariantCore: {
          status: "bound",
          version: PROMPT_INVARIANT_CORE_VERSION,
          contentSha256: PROMPT_INVARIANT_CORE_CONTENT_SHA256,
          bytes: expect.any(Number),
        },
      }),
    );
  });

  it("rejects hash and layer-total drift in historical receipts", () => {
    const receipt = historicalReceipt();
    expect(() =>
      validateCompiledPromptPackageReceipt({
        ...receipt,
        contentSha256: "f".repeat(64),
      }),
    ).toThrow("hash mismatch");
    const layers = structuredClone(receipt.layers);
    layers[0]!.bytes += 1;
    expect(() =>
      validateCompiledPromptPackageReceipt({ ...receipt, layers }),
    ).toThrow("layer totals");
  });
});

function historicalReceipt(): CompiledPromptPackageReceiptV2 {
  const systemPrompt = compilePromptInvariantCore("Historical Agent profile");
  const envelope = createModelContextEnvelopeReceipt({
    turnIndex: 3,
    systemPrompt,
    messages: [{ role: "user", content: "Private request" }],
    tools: [{ name: "read_file", parameters: { type: "object" } }],
  });
  const adapter = modelAdapterReceipt(model());
  const promptBytes = Buffer.byteLength(systemPrompt, "utf8");
  const layers: CompiledPromptPackageReceiptV2["layers"] = [
    {
      id: "invariant_core",
      source: "system_prompt",
      segmentCount: 1,
      bytes: promptBytes,
      estimatedTokens: Math.ceil(promptBytes / 4),
      contentSha256: sha256(canonicalJson([systemPrompt])),
    },
    ...(
      [
        "effective_capabilities",
        "task_skill_overlay",
        "workspace_context",
      ] as const
    ).map((id) => ({
      id,
      source: "system_prompt" as const,
      segmentCount: 0,
      bytes: 0,
      estimatedTokens: 0,
      contentSha256: sha256(canonicalJson([])),
    })),
    {
      id: "model_adapter",
      source: "request_options",
      segmentCount: 0,
      bytes: 0,
      estimatedTokens: 0,
      contentSha256: adapter.contentSha256,
    },
  ];
  const content = {
    kind: "napier.compiled-prompt-package" as const,
    schemaVersion: 2 as const,
    packageVersion: COMPILED_PROMPT_PACKAGE_VERSION,
    purpose: "agent_turn" as const,
    invariantCore: {
      status: "bound" as const,
      version: PROMPT_INVARIANT_CORE_VERSION,
      contentSha256: PROMPT_INVARIANT_CORE_CONTENT_SHA256,
      bytes: Buffer.byteLength(
        systemPrompt.slice(0, systemPrompt.indexOf("\n<agent_profile")),
        "utf8",
      ),
    },
    turnIndex: envelope.turnIndex,
    classification: "conservative_tagged_v1" as const,
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4" as const,
    systemPromptSha256: envelope.systemPromptSha256,
    systemPromptBytes: envelope.systemPromptBytes,
    estimatedTokens: Math.ceil(promptBytes / 4),
    segmentCount: 1,
    partitionSha256: sha256("historical-partition"),
    lossless: true as const,
    layers,
    effectiveCapabilities: {
      toolCount: envelope.toolCount,
      toolNameSetSha256: envelope.toolNameSetSha256,
      toolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
    },
    modelAdapter: {
      adapterId: adapter.adapterId,
      adapterContentSha256: adapter.contentSha256,
    },
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function model() {
  return {
    id: "model-1",
    name: "Model",
    api: "anthropic-messages",
    provider: "test",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64_000,
    maxTokens: 16_384,
  };
}
