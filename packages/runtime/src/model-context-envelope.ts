import type { ModelContextEnvelopeReceipt, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MODEL_CONTEXT_ENVELOPE_EVENT = "context.model_envelope";

export interface ModelContextEnvelopeInput {
  turnIndex: number;
  systemPrompt: string;
  messages: readonly unknown[];
  tools: readonly ModelContextEnvelopeTool[];
}

export interface ModelContextEnvelopeTool {
  name: string;
  description?: unknown;
  parameters?: unknown;
  constrainedSampling?: unknown;
}

export function createModelContextEnvelopeReceipt(
  input: ModelContextEnvelopeInput,
): ModelContextEnvelopeReceipt {
  if (!Number.isSafeInteger(input.turnIndex) || input.turnIndex < 0) {
    throw new Error("Model context envelope turn index is invalid");
  }
  const messageDigests = input.messages.map((message) => ({
    role: messageRole(message),
    contentSha256: sha256(canonicalJson(message)),
  }));
  const toolNames = input.tools.map((tool) => tool.name).sort();
  const toolDefinitionDigests = input.tools
    .map((tool) => {
      const definition = toolDefinitionProjection(tool);
      return {
        nameSha256: sha256(tool.name),
        definitionSha256: sha256(canonicalJson(definition)),
      };
    })
    .sort((left, right) =>
      left.nameSha256 === right.nameSha256
        ? left.definitionSha256.localeCompare(right.definitionSha256)
        : left.nameSha256.localeCompare(right.nameSha256),
    );
  const content = {
    kind: "napier.model-context-envelope" as const,
    schemaVersion: 1 as const,
    turnIndex: input.turnIndex,
    systemPromptSha256: sha256(input.systemPrompt),
    systemPromptBytes: Buffer.byteLength(input.systemPrompt, "utf8"),
    messageCount: input.messages.length,
    userMessageCount: countRoles(messageDigests, "user"),
    assistantMessageCount: countRoles(messageDigests, "assistant"),
    toolResultMessageCount: countRoles(messageDigests, "toolResult"),
    otherMessageCount: messageDigests.filter(
      (message) =>
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "toolResult",
    ).length,
    messageSetSha256: sha256(canonicalJson(messageDigests)),
    toolCount: toolNames.length,
    toolNameSetSha256: sha256(canonicalJson(toolNames)),
    toolDefinitionSetSha256: sha256(canonicalJson(toolDefinitionDigests)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateModelContextEnvelopeReceipt(
  input: unknown,
): ModelContextEnvelopeReceipt {
  const value = record(input) ? input : undefined;
  if (!value) throw new Error("Model context envelope receipt is invalid");
  const allowedKeys = [
    "kind",
    "schemaVersion",
    "turnIndex",
    "systemPromptSha256",
    "systemPromptBytes",
    "messageCount",
    "userMessageCount",
    "assistantMessageCount",
    "toolResultMessageCount",
    "otherMessageCount",
    "messageSetSha256",
    "toolCount",
    "toolNameSetSha256",
    "toolDefinitionSetSha256",
    "contentSha256",
  ];
  if (
    Object.keys(value).length !== allowedKeys.length ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new Error("Model context envelope receipt has unsupported fields");
  }
  const receipt: ModelContextEnvelopeReceipt = {
    kind:
      value["kind"] === "napier.model-context-envelope"
        ? value["kind"]
        : invalidReceipt(),
    schemaVersion:
      value["schemaVersion"] === 1 ? value["schemaVersion"] : invalidReceipt(),
    turnIndex: nonNegativeInteger(value["turnIndex"]),
    systemPromptSha256: shaField(value["systemPromptSha256"]),
    systemPromptBytes: nonNegativeInteger(value["systemPromptBytes"]),
    messageCount: nonNegativeInteger(value["messageCount"]),
    userMessageCount: nonNegativeInteger(value["userMessageCount"]),
    assistantMessageCount: nonNegativeInteger(value["assistantMessageCount"]),
    toolResultMessageCount: nonNegativeInteger(value["toolResultMessageCount"]),
    otherMessageCount: nonNegativeInteger(value["otherMessageCount"]),
    messageSetSha256: shaField(value["messageSetSha256"]),
    toolCount: nonNegativeInteger(value["toolCount"]),
    toolNameSetSha256: shaField(value["toolNameSetSha256"]),
    toolDefinitionSetSha256: shaField(value["toolDefinitionSetSha256"]),
    contentSha256: shaField(value["contentSha256"]),
  };
  if (
    receipt.userMessageCount +
      receipt.assistantMessageCount +
      receipt.toolResultMessageCount +
      receipt.otherMessageCount !==
    receipt.messageCount
  ) {
    throw new Error("Model context envelope message counts are invalid");
  }
  const { contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Model context envelope hash mismatch");
  }
  return receipt;
}

export function projectModelContextEnvelopeReceipts(
  events: readonly RunEvent[],
): ModelContextEnvelopeReceipt[] {
  return events
    .filter((event) => event.type === MODEL_CONTEXT_ENVELOPE_EVENT)
    .map((event) => validateModelContextEnvelopeReceipt(event.payload));
}

function toolDefinitionProjection(tool: ModelContextEnvelopeTool) {
  return {
    name: tool.name,
    description: tool.description ?? null,
    parameters: tool.parameters ?? null,
    constrainedSampling: tool.constrainedSampling ?? null,
  };
}

function messageRole(message: unknown): string {
  return record(message) && typeof message["role"] === "string"
    ? message["role"]
    : "unknown";
}

function countRoles(
  messages: readonly { role: string }[],
  role: string,
): number {
  return messages.filter((message) => message.role === role).length;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidReceipt();
  }
  return value;
}

function shaField(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    invalidReceipt();
  }
  return value;
}

function invalidReceipt(): never {
  throw new Error("Model context envelope receipt is invalid");
}
