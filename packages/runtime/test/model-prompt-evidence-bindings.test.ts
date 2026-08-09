import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { createCompiledPromptPackageReceipt } from "../src/compiled-prompt-package.js";
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
});

function evidence(turnIndex = 0, sequenceOffset = 0) {
  const systemPrompt = [
    "Invariant",
    "<workspace_tool_protocol>",
    "Use bounded tools.",
    "</workspace_tool_protocol>",
  ].join("\n");
  const envelope = createModelContextEnvelopeReceipt({
    turnIndex,
    systemPrompt,
    messages: [{ role: "user", content: "Private request" }],
    tools: [{ name: "read_file", parameters: { type: "object" } }],
  });
  const adapter = modelAdapterReceipt(model());
  const promptPackage = createCompiledPromptPackageReceipt({
    systemPrompt,
    envelope,
    adapter,
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
