import type { ModelContextEnvelopeReceipt, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MODEL_CONTEXT_ENVELOPE_EVENT = "context.model_envelope";
export const MODEL_CONTEXT_ENVELOPE_VERSION = 2 as const;
export const MODEL_CONTEXT_TOOL_TOKEN_ESTIMATE_METHOD =
  "ceil_utf8_bytes_div_4" as const;

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
      const serializedDefinition = canonicalJson(definition);
      return {
        nameSha256: sha256(tool.name),
        definitionSha256: sha256(serializedDefinition),
        definitionBytes: Buffer.byteLength(serializedDefinition, "utf8"),
      };
    })
    .sort((left, right) =>
      left.nameSha256 === right.nameSha256
        ? left.definitionSha256.localeCompare(right.definitionSha256)
        : left.nameSha256.localeCompare(right.nameSha256),
    );
  const toolDefinitionBytes = toolDefinitionDigests.reduce(
    (total, definition) => total + definition.definitionBytes,
    0,
  );
  const toolDefinitionSet = toolDefinitionDigests.map(
    ({ nameSha256, definitionSha256 }) => ({
      nameSha256,
      definitionSha256,
    }),
  );
  const content = {
    kind: "napier.model-context-envelope" as const,
    schemaVersion: MODEL_CONTEXT_ENVELOPE_VERSION,
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
    toolDefinitionSetSha256: sha256(canonicalJson(toolDefinitionSet)),
    toolDefinitionBytes,
    toolDefinitionEstimatedTokens: Math.ceil(toolDefinitionBytes / 4),
    toolDefinitionTokenEstimateMethod: MODEL_CONTEXT_TOOL_TOKEN_ESTIMATE_METHOD,
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
  const legacyKeys = [
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
  const modernKeys = [
    ...legacyKeys.slice(0, -1),
    "toolDefinitionBytes",
    "toolDefinitionEstimatedTokens",
    "toolDefinitionTokenEstimateMethod",
    "contentSha256",
  ];
  const modern = value["schemaVersion"] === MODEL_CONTEXT_ENVELOPE_VERSION;
  const allowedKeys = modern ? modernKeys : legacyKeys;
  if (
    Object.keys(value).length !== allowedKeys.length ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new Error("Model context envelope receipt has unsupported fields");
  }
  const common = {
    kind:
      value["kind"] === "napier.model-context-envelope"
        ? ("napier.model-context-envelope" as const)
        : invalidReceipt(),
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
  };
  const receipt: ModelContextEnvelopeReceipt = modern
    ? {
        ...common,
        schemaVersion: MODEL_CONTEXT_ENVELOPE_VERSION,
        toolDefinitionBytes: nonNegativeInteger(value["toolDefinitionBytes"]),
        toolDefinitionEstimatedTokens: nonNegativeInteger(
          value["toolDefinitionEstimatedTokens"],
        ),
        toolDefinitionTokenEstimateMethod:
          value["toolDefinitionTokenEstimateMethod"] ===
          MODEL_CONTEXT_TOOL_TOKEN_ESTIMATE_METHOD
            ? value["toolDefinitionTokenEstimateMethod"]
            : invalidReceipt(),
        contentSha256: shaField(value["contentSha256"]),
      }
    : {
        ...common,
        schemaVersion:
          value["schemaVersion"] === 1
            ? value["schemaVersion"]
            : invalidReceipt(),
        contentSha256: shaField(value["contentSha256"]),
      };
  if (
    receipt.schemaVersion === MODEL_CONTEXT_ENVELOPE_VERSION &&
    receipt.toolDefinitionEstimatedTokens !==
      Math.ceil(receipt.toolDefinitionBytes / 4)
  ) {
    throw new Error(
      "Model context envelope tool definition estimate is invalid",
    );
  }
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

export function assertModelContextEnvelopeEventBindings(
  events: readonly RunEvent[],
  options: {
    knownRunIds?: ReadonlySet<string>;
    label?: string;
  } = {},
): void {
  const label = options.label ?? "Model Context Envelope";
  const envelopeTurnIndexesByRun = new Map<string, number>();
  const envelopeByRunAndTurn = new Map<
    string,
    { eventSeq: number; receipt: ModelContextEnvelopeReceipt }
  >();
  const envelopeCountsByRun = new Map<string, number>();
  for (const event of events) {
    if (event.type !== MODEL_CONTEXT_ENVELOPE_EVENT) continue;
    const receipt = validateModelContextEnvelopeReceipt(event.payload);
    if (options.knownRunIds && !options.knownRunIds.has(event.runId)) {
      throw new Error(`${label} references unknown Run: ${event.runId}`);
    }
    const expectedTurnIndex = envelopeTurnIndexesByRun.get(event.runId) ?? 0;
    if (receipt.turnIndex !== expectedTurnIndex) {
      throw new Error(`${label} turn index is invalid: ${event.runId}`);
    }
    envelopeTurnIndexesByRun.set(event.runId, expectedTurnIndex + 1);
    envelopeByRunAndTurn.set(`${event.runId}:${receipt.turnIndex}`, {
      eventSeq: event.seq,
      receipt,
    });
    envelopeCountsByRun.set(
      event.runId,
      (envelopeCountsByRun.get(event.runId) ?? 0) + 1,
    );
  }
  const terminalBindingsByRun = new Map<string, number>();
  const terminalBindingKeys = new Set<string>();
  for (const event of events) {
    if (!isEnvelopeTerminalEvent(event) || !record(event.payload)) continue;
    const payload = event.payload;
    const hasBinding =
      payload["modelContextEnvelopeSha256"] !== undefined ||
      payload["modelContextEnvelopeTurnIndex"] !== undefined ||
      payload["modelContextMessageSetSha256"] !== undefined ||
      payload["modelContextToolDefinitionSetSha256"] !== undefined;
    if (!hasBinding) continue;
    const turnIndex = payload["modelContextEnvelopeTurnIndex"];
    const envelopeSha256 = payload["modelContextEnvelopeSha256"];
    const messageSetSha256 = payload["modelContextMessageSetSha256"];
    const toolDefinitionSetSha256 =
      payload["modelContextToolDefinitionSetSha256"];
    const binding =
      typeof turnIndex === "number" && Number.isSafeInteger(turnIndex)
        ? envelopeByRunAndTurn.get(`${event.runId}:${turnIndex}`)
        : undefined;
    const bindingKey = `${event.runId}:${String(turnIndex)}`;
    if (
      !binding ||
      terminalBindingKeys.has(bindingKey) ||
      event.seq <= binding.eventSeq ||
      !shaFieldOrUndefined(envelopeSha256) ||
      !shaFieldOrUndefined(messageSetSha256) ||
      !shaFieldOrUndefined(toolDefinitionSetSha256) ||
      envelopeSha256 !== binding.receipt.contentSha256 ||
      messageSetSha256 !== binding.receipt.messageSetSha256 ||
      toolDefinitionSetSha256 !== binding.receipt.toolDefinitionSetSha256
    ) {
      throw new Error(`${label} terminal binding is invalid: ${event.runId}`);
    }
    terminalBindingKeys.add(bindingKey);
    terminalBindingsByRun.set(
      event.runId,
      (terminalBindingsByRun.get(event.runId) ?? 0) + 1,
    );
  }
  for (const [runId, envelopeCount] of envelopeCountsByRun) {
    const bindingCount = terminalBindingsByRun.get(runId) ?? 0;
    if (bindingCount !== envelopeCount) {
      throw new Error(`${label} terminal binding count is invalid: ${runId}`);
    }
  }
}

function isEnvelopeTerminalEvent(event: RunEvent): boolean {
  if (event.type === "model.response") return true;
  return (
    event.type === "model.thinking_loop.detected" &&
    record(event.payload) &&
    event.payload["action"] === "retry"
  );
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

function shaFieldOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function invalidReceipt(): never {
  throw new Error("Model context envelope receipt is invalid");
}
