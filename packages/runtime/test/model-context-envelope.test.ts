import { describe, expect, it } from "vitest";

import {
  createModelContextEnvelopeReceipt,
  MODEL_CONTEXT_ENVELOPE_EVENT,
  validateModelContextEnvelopeReceipt,
} from "../src/model-context-envelope.js";

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
        schemaVersion: 1,
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
        contentSha256: "0".repeat(64),
      }),
    ).toThrow("hash mismatch");
  });
});
