import { describe, expect, it } from "vitest";

import type { RunEvent } from "@napier/contracts";

import {
  assertModelContextEnvelopeEventBindings,
  createModelContextEnvelopeReceipt,
  MODEL_CONTEXT_ENVELOPE_EVENT,
  MODEL_CONTEXT_ENVELOPE_VERSION,
  MODEL_CONTEXT_TOOL_TOKEN_ESTIMATE_METHOD,
  validateModelContextEnvelopeReceipt,
} from "../src/model-context-envelope.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

describe("model context envelope", () => {
  it("binds prompt, messages, and tools without copying raw context", () => {
    expect(MODEL_CONTEXT_ENVELOPE_EVENT).toBe("context.model_envelope");

    const receipt = createModelContextEnvelopeReceipt({
      turnIndex: 2,
      systemPrompt: "Secret system instruction.",
      messages: [
        { role: "user", content: "Sensitive user request." },
        { role: "assistant", content: "Private assistant draft." },
        {
          role: "toolResult",
          toolName: "read_file",
          content: [{ type: "text", text: "Raw tool output." }],
        },
        { role: "custom", content: "Provider-specific message." },
      ],
      tools: [
        {
          name: "read_file",
          description: "Reads private files.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Secret path" },
            },
          },
        },
        {
          name: "verify_workspace",
          description: "Checks sensitive workspace state.",
          parameters: { type: "object", properties: {} },
        },
        { name: "read_file" },
      ],
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: "napier.model-context-envelope",
        schemaVersion: MODEL_CONTEXT_ENVELOPE_VERSION,
        turnIndex: 2,
        systemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        systemPromptBytes: Buffer.byteLength(
          "Secret system instruction.",
          "utf8",
        ),
        messageCount: 4,
        userMessageCount: 1,
        assistantMessageCount: 1,
        toolResultMessageCount: 1,
        otherMessageCount: 1,
        messageSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        toolCount: 3,
        toolNameSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        toolDefinitionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        toolDefinitionBytes: 418,
        toolDefinitionEstimatedTokens: 105,
        toolDefinitionTokenEstimateMethod:
          MODEL_CONTEXT_TOOL_TOKEN_ESTIMATE_METHOD,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(validateModelContextEnvelopeReceipt(receipt)).toEqual(receipt);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("Secret system instruction");
    expect(serialized).not.toContain("Sensitive user request");
    expect(serialized).not.toContain("Private assistant draft");
    expect(serialized).not.toContain("Raw tool output");
    expect(serialized).not.toContain("read_file");
    expect(serialized).not.toContain("verify_workspace");
    expect(serialized).not.toContain("Reads private files");
    expect(serialized).not.toContain("Secret path");
  });

  it("rejects tampered receipts", () => {
    const receipt = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: "System",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });

    expect(() =>
      validateModelContextEnvelopeReceipt({
        ...receipt,
        messageCount: receipt.messageCount + 1,
      }),
    ).toThrow("message counts");
    expect(() =>
      validateModelContextEnvelopeReceipt({
        ...receipt,
        toolDefinitionEstimatedTokens:
          receipt.schemaVersion === 2
            ? receipt.toolDefinitionEstimatedTokens + 1
            : 1,
        contentSha256: receipt.contentSha256,
      }),
    ).toThrow("estimate is invalid");
    expect(() =>
      validateModelContextEnvelopeReceipt({
        ...receipt,
        contentSha256: "0".repeat(64),
      }),
    ).toThrow("hash mismatch");
  });

  it("accepts legacy v1 hash-only receipts", () => {
    const modern = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: "System",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });
    const {
      toolDefinitionBytes: _toolDefinitionBytes,
      toolDefinitionEstimatedTokens: _toolDefinitionEstimatedTokens,
      toolDefinitionTokenEstimateMethod: _toolDefinitionTokenEstimateMethod,
      contentSha256: _contentSha256,
      ...common
    } = modern.schemaVersion === 2 ? modern : invalidModern();
    const legacyContent = { ...common, schemaVersion: 1 as const };
    const legacy = {
      ...legacyContent,
      contentSha256: sha256(canonicalJson(legacyContent)),
    };

    expect(validateModelContextEnvelopeReceipt(legacy)).toEqual(legacy);
  });

  it("requires each envelope to have exactly one bound model response", () => {
    const receipt = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: "System",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });
    const envelopeEvent: RunEvent = {
      id: "event_envelope",
      threadId: "thread_context",
      runId: "run_context",
      seq: 1,
      type: MODEL_CONTEXT_ENVELOPE_EVENT,
      category: "model",
      visibility: "debug",
      createdAt: "2026-07-25T00:00:00.000Z",
      payload: receipt,
    };
    expect(() =>
      assertModelContextEnvelopeEventBindings([envelopeEvent]),
    ).toThrow("response binding count is invalid");

    expect(() =>
      assertModelContextEnvelopeEventBindings([
        envelopeEvent,
        {
          ...envelopeEvent,
          id: "event_response",
          seq: 2,
          type: "model.response",
          payload: {
            modelContextEnvelopeSha256: receipt.contentSha256,
            modelContextEnvelopeTurnIndex: receipt.turnIndex,
            modelContextMessageSetSha256: receipt.messageSetSha256,
            modelContextToolDefinitionSetSha256:
              receipt.toolDefinitionSetSha256,
          },
        },
      ]),
    ).not.toThrow();
  });
});

function invalidModern(): never {
  throw new Error("Expected a modern Model Context Envelope");
}
