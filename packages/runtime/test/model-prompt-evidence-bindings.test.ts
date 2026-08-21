import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { createCompiledPromptPackageReceiptV3 } from "../src/compiled-prompt-package.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { assertModelPromptEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";

describe("Model Prompt evidence bindings", () => {
  it("accepts legacy, Adapter-only, and complete evidence generations", () => {
    const fixture = evidence();
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.responseEvent,
      ]),
    ).not.toThrow();
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.adapterEvent,
        fixture.responseEvent,
      ]),
    ).not.toThrow();
    expect(() =>
      assertModelPromptEvidenceBindings(fixture.complete),
    ).not.toThrow();
  });

  it("rejects missing, reordered, and hash-drifted Prompt evidence", () => {
    const fixture = evidence();
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.packageEvent,
        fixture.responseEvent,
      ]),
    ).toThrow("count is invalid");

    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        { ...fixture.packageEvent, seq: 2 },
        { ...fixture.adapterEvent, seq: 3 },
        fixture.responseEvent,
      ]),
    ).toThrow("sequence is invalid");

    const adapterDrift = event(
      fixture.adapterEvent.seq,
      "context.model_adapter",
      modelAdapterReceipt(model("openai-responses")),
    );
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        adapterDrift,
        fixture.packageEvent,
        fixture.responseEvent,
      ]),
    ).toThrow("binding is invalid");
  });

  it("rejects partial upgrades across multiple turns", () => {
    const first = evidence();
    const second = evidence(1, 10);
    expect(() =>
      assertModelPromptEvidenceBindings([
        ...first.complete,
        second.envelopeEvent,
        second.adapterEvent,
        second.responseEvent,
      ]),
    ).toThrow("count is invalid");
  });

  it("accepts one retry discard as the terminal Prompt binding", () => {
    const fixture = evidence();
    const retryEvent = event(
      fixture.responseEvent.seq,
      "model.thinking_loop.detected",
      {
        ...fixture.responseEvent.payload,
        action: "retry",
      },
    );
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.adapterEvent,
        fixture.packageEvent,
        retryEvent,
      ]),
    ).not.toThrow();
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.adapterEvent,
        fixture.packageEvent,
        retryEvent,
        { ...fixture.responseEvent, seq: fixture.responseEvent.seq + 1 },
      ]),
    ).toThrow("terminal binding is duplicated");
  });

  it("accepts one provider overflow as the terminal Prompt binding", () => {
    const fixture = evidence();
    const overflowEvent = event(
      fixture.responseEvent.seq,
      "model.context.overflow",
      {
        ...fixture.responseEvent.payload,
        action: "retry",
      },
    );
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.adapterEvent,
        fixture.packageEvent,
        overflowEvent,
      ]),
    ).not.toThrow();
    expect(() =>
      assertModelPromptEvidenceBindings([
        fixture.envelopeEvent,
        fixture.adapterEvent,
        fixture.packageEvent,
        overflowEvent,
        { ...fixture.responseEvent, seq: fixture.responseEvent.seq + 1 },
      ]),
    ).toThrow("terminal binding is duplicated");
  });
});

function evidence(turnIndex = 0, sequenceOffset = 0) {
  const rawSystemPrompt = [
    "Invariant",
    "<workspace_tool_protocol>",
    "Use bounded tools.",
    "</workspace_tool_protocol>",
  ].join("\n");
  const adapter = modelAdapterReceipt(model());
  const compiled = compileAuxiliaryPrompt({
    purpose: "context_compaction",
    sourceId: "task.context_compaction",
    systemPrompt: rawSystemPrompt,
    adapter,
  });
  const envelope = createModelContextEnvelopeReceipt({
    turnIndex,
    systemPrompt: compiled.systemPrompt,
    messages: [{ role: "user", content: "Private request" }],
    tools: [{ name: "read_file", parameters: { type: "object" } }],
  });
  const promptPackage = createCompiledPromptPackageReceiptV3({
    compiled,
    envelope,
    adapter,
    purpose: "context_compaction",
  });
  const envelopeEvent = event(
    1 + sequenceOffset,
    "context.model_envelope",
    envelope,
  );
  const adapterEvent = event(
    2 + sequenceOffset,
    "context.model_adapter",
    adapter,
  );
  const packageEvent = event(
    3 + sequenceOffset,
    "context.prompt_package",
    promptPackage,
  );
  const responseEvent = event(4 + sequenceOffset, "model.response", {
    modelContextEnvelopeTurnIndex: turnIndex,
    modelContextEnvelopeSha256: envelope.contentSha256,
    modelContextMessageSetSha256: envelope.messageSetSha256,
    modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
  });
  return {
    envelopeEvent,
    adapterEvent,
    packageEvent,
    responseEvent,
    complete: [envelopeEvent, adapterEvent, packageEvent, responseEvent],
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_prompt_binding_${seq}`,
    threadId: "thread_prompt_binding",
    runId: "run_prompt_binding",
    seq,
    type,
    category: "model",
    visibility: "debug",
    payload,
    createdAt: new Date(Date.UTC(2026, 7, 9, 0, 0, seq)).toISOString(),
  };
}

function model(api = "anthropic-messages") {
  return {
    id: "model-1",
    name: "Model",
    api,
    provider: "anthropic",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 2_048,
  };
}
