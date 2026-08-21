import type {
  AssistantMessage,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { normalizeConversationSurfaceUsage } from "./conversation-surface-usage.js";

export const MAX_CONVERSATION_SURFACE_CAPSULE_BYTES = 8 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export interface ConversationSurfaceToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, JsonValue>;
  thoughtSignature?: string;
}

export interface ConversationSurfaceText {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface ConversationSurfaceThinking {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface ConversationSurfaceImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ConversationSurfaceToolResult {
  toolCallId: string;
  toolName: string;
  content: Array<ConversationSurfaceText | ConversationSurfaceImage>;
  details: JsonValue;
  isError: boolean;
  usage?: Usage;
  addedToolNames?: string[];
}

export interface ConversationSurfaceExchange {
  assistantContent: Array<
    | ConversationSurfaceText
    | ConversationSurfaceThinking
    | ConversationSurfaceToolCall
  >;
  toolResults: ConversationSurfaceToolResult[];
}

export interface ConversationSurfaceCapsule {
  kind: "napier.conversation-surface-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  modelContextEnvelopeSha256: string;
  modelContextEnvelopeTurnIndex: number;
  exchange: ConversationSurfaceExchange;
  exchangeSha256: string;
  contentSha256: string;
}

export interface ConversationSurfaceCapsuleReceipt {
  kind: "napier.conversation-surface-capsule-receipt";
  schemaVersion: 1;
  modelContextEnvelopeSha256: string;
  modelContextEnvelopeTurnIndex: number;
  toolCallCount: number;
  toolCallSetSha256: string;
  exchangeSha256: string;
  capsuleSha256: string;
  capsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}

export function createConversationSurfaceCapsule(input: {
  sourceThreadId: string;
  sourceRunId: string;
  modelContextEnvelopeSha256: string;
  modelContextEnvelopeTurnIndex: number;
  assistant: AssistantMessage;
  toolResults: ToolResultMessage[];
}): ConversationSurfaceCapsule {
  const exchange = normalizeExchange({
    assistantContent: input.assistant.content,
    toolResults: input.toolResults,
  });
  const content = {
    kind: "napier.conversation-surface-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    modelContextEnvelopeSha256: input.modelContextEnvelopeSha256,
    modelContextEnvelopeTurnIndex: input.modelContextEnvelopeTurnIndex,
    exchange,
    exchangeSha256: sha256(canonicalJson(exchange)),
  };
  return validateConversationSurfaceCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateConversationSurfaceCapsule(
  input: unknown,
): ConversationSurfaceCapsule {
  const value = record(input, "Conversation Surface capsule");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "modelContextEnvelopeSha256",
    "modelContextEnvelopeTurnIndex",
    "exchange",
    "exchangeSha256",
    "contentSha256",
  ]);
  const exchange = normalizeExchange(value["exchange"]);
  if (
    value["kind"] !== "napier.conversation-surface-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !hash(value["modelContextEnvelopeSha256"]) ||
    !nonNegativeInteger(value["modelContextEnvelopeTurnIndex"]) ||
    !hash(value["exchangeSha256"]) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Conversation Surface capsule is invalid");
  }
  const normalized = {
    kind: "napier.conversation-surface-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    modelContextEnvelopeSha256: value["modelContextEnvelopeSha256"],
    modelContextEnvelopeTurnIndex: Number(
      value["modelContextEnvelopeTurnIndex"],
    ),
    exchange,
    exchangeSha256: value["exchangeSha256"],
  };
  if (
    sha256(canonicalJson(exchange)) !== normalized.exchangeSha256 ||
    sha256(canonicalJson(normalized)) !== value["contentSha256"]
  ) {
    throw new Error("Conversation Surface capsule binding is invalid");
  }
  return {
    ...normalized,
    contentSha256: value["contentSha256"],
  };
}

export function createConversationSurfaceCapsuleReceipt(
  capsule: ConversationSurfaceCapsule,
  capsuleBytes = Buffer.byteLength(canonicalJson(capsule), "utf8"),
): ConversationSurfaceCapsuleReceipt {
  const content = {
    kind: "napier.conversation-surface-capsule-receipt" as const,
    schemaVersion: 1 as const,
    modelContextEnvelopeSha256: capsule.modelContextEnvelopeSha256,
    modelContextEnvelopeTurnIndex: capsule.modelContextEnvelopeTurnIndex,
    toolCallCount: toolCalls(capsule.exchange).length,
    toolCallSetSha256: toolCallSetSha256(capsule.exchange),
    exchangeSha256: capsule.exchangeSha256,
    capsuleSha256: capsule.contentSha256,
    capsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateConversationSurfaceCapsuleReceipt(
  input: unknown,
): ConversationSurfaceCapsuleReceipt {
  const value = record(input, "Conversation Surface capsule receipt");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "modelContextEnvelopeSha256",
    "modelContextEnvelopeTurnIndex",
    "toolCallCount",
    "toolCallSetSha256",
    "exchangeSha256",
    "capsuleSha256",
    "capsuleBytes",
    "storage",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.conversation-surface-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !hash(value["modelContextEnvelopeSha256"]) ||
    !nonNegativeInteger(value["modelContextEnvelopeTurnIndex"]) ||
    !positiveInteger(value["toolCallCount"]) ||
    !hash(value["toolCallSetSha256"]) ||
    !hash(value["exchangeSha256"]) ||
    !hash(value["capsuleSha256"]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    Number(value["capsuleBytes"]) > MAX_CONVERSATION_SURFACE_CAPSULE_BYTES ||
    value["storage"] !== "local_only" ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Conversation Surface capsule receipt is invalid");
  }
  const content = {
    kind: "napier.conversation-surface-capsule-receipt" as const,
    schemaVersion: 1 as const,
    modelContextEnvelopeSha256: value["modelContextEnvelopeSha256"],
    modelContextEnvelopeTurnIndex: Number(
      value["modelContextEnvelopeTurnIndex"],
    ),
    toolCallCount: Number(value["toolCallCount"]),
    toolCallSetSha256: value["toolCallSetSha256"],
    exchangeSha256: value["exchangeSha256"],
    capsuleSha256: value["capsuleSha256"],
    capsuleBytes: Number(value["capsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Conversation Surface capsule receipt hash is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

export function toolCalls(
  exchange: ConversationSurfaceExchange,
): ConversationSurfaceToolCall[] {
  return exchange.assistantContent.filter(
    (item): item is ConversationSurfaceToolCall => item.type === "toolCall",
  );
}

export function toolCallSetSha256(
  exchange: ConversationSurfaceExchange,
): string {
  return sha256(
    canonicalJson(
      toolCalls(exchange).map((call) => ({ id: call.id, name: call.name })),
    ),
  );
}

export function normalizeConversationSurfaceExchange(
  input: unknown,
): ConversationSurfaceExchange {
  return normalizeExchange(input);
}

function normalizeExchange(input: unknown): ConversationSurfaceExchange {
  const value = record(input, "Conversation Surface exchange");
  exactKeys(value, ["assistantContent", "toolResults"]);
  if (
    !Array.isArray(value["assistantContent"]) ||
    !Array.isArray(value["toolResults"])
  ) {
    throw new Error("Conversation Surface exchange is invalid");
  }
  const assistantContent: Array<
    | ConversationSurfaceText
    | ConversationSurfaceThinking
    | ConversationSurfaceToolCall
  > = [];
  for (const item of value["assistantContent"]) {
    const block = record(item, "Conversation Surface assistant block");
    if (block["type"] === "text" && typeof block["text"] === "string") {
      assertOptionalString(block["textSignature"]);
      assistantContent.push({
        type: "text",
        text: block["text"],
        ...(typeof block["textSignature"] === "string"
          ? { textSignature: block["textSignature"] }
          : {}),
      });
      continue;
    }
    if (block["type"] === "thinking" && typeof block["thinking"] === "string") {
      assertOptionalString(block["thinkingSignature"]);
      if (
        block["redacted"] !== undefined &&
        typeof block["redacted"] !== "boolean"
      ) {
        throw new Error("Conversation Surface thinking redaction is invalid");
      }
      assistantContent.push({
        type: "thinking",
        thinking: block["thinking"],
        ...(typeof block["thinkingSignature"] === "string"
          ? { thinkingSignature: block["thinkingSignature"] }
          : {}),
        ...(typeof block["redacted"] === "boolean"
          ? { redacted: block["redacted"] }
          : {}),
      });
      continue;
    }
    if (
      block["type"] === "toolCall" &&
      callId(block["id"]) &&
      toolName(block["name"])
    ) {
      assertOptionalString(block["thoughtSignature"]);
      assistantContent.push({
        type: "toolCall",
        id: block["id"],
        name: block["name"],
        arguments: jsonRecord(block["arguments"]),
        ...(typeof block["thoughtSignature"] === "string"
          ? { thoughtSignature: block["thoughtSignature"] }
          : {}),
      });
      continue;
    }
    throw new Error("Conversation Surface assistant block is invalid");
  }
  const calls = assistantContent.filter(
    (item): item is ConversationSurfaceToolCall => item.type === "toolCall",
  );
  if (
    calls.length === 0 ||
    new Set(calls.map((call) => call.id)).size !== calls.length ||
    value["assistantContent"].length === 0
  ) {
    throw new Error("Conversation Surface assistant tool calls are invalid");
  }
  const toolResults = value["toolResults"].map(normalizeToolResult);
  if (
    toolResults.length !== calls.length ||
    calls.some(
      (call, index) =>
        toolResults[index]?.toolCallId !== call.id ||
        toolResults[index]?.toolName !== call.name,
    )
  ) {
    throw new Error("Conversation Surface tool results are unbalanced");
  }
  return { assistantContent, toolResults };
}

function normalizeToolResult(input: unknown): ConversationSurfaceToolResult {
  const value = record(input, "Conversation Surface tool result");
  if (
    !callId(value["toolCallId"]) ||
    !toolName(value["toolName"]) ||
    !Array.isArray(value["content"]) ||
    typeof value["isError"] !== "boolean"
  ) {
    throw new Error("Conversation Surface tool result is invalid");
  }
  const content: Array<ConversationSurfaceText | ConversationSurfaceImage> =
    value["content"].map((item) => {
      const block = record(item, "Conversation Surface tool result content");
      if (block["type"] === "text" && typeof block["text"] === "string") {
        assertOptionalString(block["textSignature"]);
        return {
          type: "text" as const,
          text: block["text"],
          ...(typeof block["textSignature"] === "string"
            ? { textSignature: block["textSignature"] }
            : {}),
        };
      }
      if (
        block["type"] === "image" &&
        typeof block["data"] === "string" &&
        typeof block["mimeType"] === "string" &&
        block["mimeType"].length > 0
      ) {
        return {
          type: "image" as const,
          data: block["data"],
          mimeType: block["mimeType"],
        };
      }
      throw new Error("Conversation Surface tool result content is invalid");
    });
  const addedToolNames = value["addedToolNames"];
  if (
    addedToolNames !== undefined &&
    (!Array.isArray(addedToolNames) || !addedToolNames.every(toolName))
  ) {
    throw new Error("Conversation Surface added tools are invalid");
  }
  return {
    toolCallId: value["toolCallId"],
    toolName: value["toolName"],
    content,
    details: normalizeJsonValue(value["details"] ?? {}),
    isError: value["isError"],
    ...(value["usage"] !== undefined
      ? { usage: normalizeConversationSurfaceUsage(value["usage"]) }
      : {}),
    ...(addedToolNames ? { addedToolNames: [...addedToolNames] } : {}),
  };
}

function normalizeJsonValue(input: unknown): JsonValue {
  return JSON.parse(canonicalJson(input)) as JsonValue;
}

function jsonRecord(input: unknown): Record<string, JsonValue> {
  const normalized = JSON.parse(canonicalJson(input)) as JsonValue;
  if (
    !normalized ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new Error("Conversation Surface tool arguments are invalid");
  }
  return normalized;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): void {
  if (
    Object.keys(value).length !== required.length ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Conversation Surface fields are invalid");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function callId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function toolName(value: unknown): value is string {
  return typeof value === "string" && TOOL_NAME.test(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function assertOptionalString(value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error("Conversation Surface signature is invalid");
  }
}
