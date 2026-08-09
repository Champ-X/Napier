import type { RunEvent } from "@napier/contracts";

export interface ModelContextEnvelopeView {
  eventSeq: number;
  runId: string;
  schemaVersion: 1 | 2;
  turnIndex: number;
  responseSeq?: number;
  responseModel?: string;
  responseStopReason?: string;
  systemPromptBytes: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolResultMessageCount: number;
  otherMessageCount: number;
  toolCount: number;
  toolDefinitionBytes?: number;
  toolDefinitionEstimatedTokens?: number;
  toolDefinitionTokenEstimateMethod?: "ceil_utf8_bytes_div_4";
  systemPromptSha256: string;
  messageSetSha256: string;
  toolNameSetSha256: string;
  toolDefinitionSetSha256: string;
  contentSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const LEGACY_KEYS = [
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
] as const;
const MODERN_KEYS = [
  ...LEGACY_KEYS.slice(0, -1),
  "toolDefinitionBytes",
  "toolDefinitionEstimatedTokens",
  "toolDefinitionTokenEstimateMethod",
  "contentSha256",
] as const;

export function modelContextEnvelopeViews(
  events: readonly RunEvent[],
): ModelContextEnvelopeView[] {
  const responsesByRunAndTurn = new Map<string, ModelContextResponseBinding>();
  for (const event of events) {
    const response = responseBindingView(event);
    if (!response) continue;
    responsesByRunAndTurn.set(
      `${response.runId}:${response.turnIndex}`,
      response,
    );
  }
  const views: ModelContextEnvelopeView[] = [];
  for (const event of events) {
    if (event.type !== "context.model_envelope" || !record(event.payload)) {
      continue;
    }
    const payload = envelopePayloadView(event.payload);
    if (!payload) continue;
    views.push({
      eventSeq: event.seq,
      runId: event.runId,
      ...payload,
      ...responseBindingProjection(
        responsesByRunAndTurn.get(`${event.runId}:${payload.turnIndex}`),
        payload.contentSha256,
        payload.messageSetSha256,
        payload.toolDefinitionSetSha256,
      ),
    });
  }
  return views;
}

type EnvelopePayloadView = Omit<
  ModelContextEnvelopeView,
  "eventSeq" | "runId" | "responseSeq" | "responseModel" | "responseStopReason"
>;

function envelopePayloadView(
  payload: Record<string, unknown>,
): EnvelopePayloadView | undefined {
  const schemaVersion = envelopeSchemaVersion(payload);
  if (!schemaVersion || !exactEnvelopeKeys(payload, schemaVersion)) return;
  const counts = envelopeCounts(payload);
  const hashes = envelopeHashes(payload);
  const toolCost = toolDefinitionCost(payload, schemaVersion);
  if (!counts || !hashes || !toolCost) return;
  return {
    schemaVersion,
    ...counts,
    ...toolCost,
    ...hashes,
  };
}

function envelopeSchemaVersion(
  payload: Record<string, unknown>,
): 1 | 2 | undefined {
  if (payload["kind"] !== "napier.model-context-envelope") return;
  return payload["schemaVersion"] === 1 || payload["schemaVersion"] === 2
    ? payload["schemaVersion"]
    : undefined;
}

function exactEnvelopeKeys(
  payload: Record<string, unknown>,
  schemaVersion: 1 | 2,
): boolean {
  const allowed: ReadonlySet<string> =
    schemaVersion === 2 ? new Set(MODERN_KEYS) : new Set(LEGACY_KEYS);
  const keys = Object.keys(payload);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function envelopeCounts(payload: Record<string, unknown>) {
  const counts = {
    turnIndex: nonNegativeInteger(payload["turnIndex"]),
    systemPromptBytes: nonNegativeInteger(payload["systemPromptBytes"]),
    messageCount: nonNegativeInteger(payload["messageCount"]),
    userMessageCount: nonNegativeInteger(payload["userMessageCount"]),
    assistantMessageCount: nonNegativeInteger(payload["assistantMessageCount"]),
    toolResultMessageCount: nonNegativeInteger(
      payload["toolResultMessageCount"],
    ),
    otherMessageCount: nonNegativeInteger(payload["otherMessageCount"]),
    toolCount: nonNegativeInteger(payload["toolCount"]),
  };
  if (Object.values(counts).some((value) => value === undefined)) return;
  const total =
    counts.userMessageCount! +
    counts.assistantMessageCount! +
    counts.toolResultMessageCount! +
    counts.otherMessageCount!;
  return total === counts.messageCount
    ? (counts as Record<keyof typeof counts, number>)
    : undefined;
}

function envelopeHashes(payload: Record<string, unknown>) {
  const hashes = {
    systemPromptSha256: hash(payload["systemPromptSha256"]),
    messageSetSha256: hash(payload["messageSetSha256"]),
    toolNameSetSha256: hash(payload["toolNameSetSha256"]),
    toolDefinitionSetSha256: hash(payload["toolDefinitionSetSha256"]),
    contentSha256: hash(payload["contentSha256"]),
  };
  return Object.values(hashes).every(Boolean)
    ? (hashes as Record<keyof typeof hashes, string>)
    : undefined;
}

function toolDefinitionCost(
  payload: Record<string, unknown>,
  schemaVersion: 1 | 2,
):
  | Pick<
      ModelContextEnvelopeView,
      | "toolDefinitionBytes"
      | "toolDefinitionEstimatedTokens"
      | "toolDefinitionTokenEstimateMethod"
    >
  | undefined {
  if (schemaVersion === 1) return {};
  const toolDefinitionBytes = nonNegativeInteger(
    payload["toolDefinitionBytes"],
  );
  const toolDefinitionEstimatedTokens = nonNegativeInteger(
    payload["toolDefinitionEstimatedTokens"],
  );
  if (
    toolDefinitionBytes === undefined ||
    toolDefinitionEstimatedTokens !== Math.ceil(toolDefinitionBytes / 4) ||
    payload["toolDefinitionTokenEstimateMethod"] !== "ceil_utf8_bytes_div_4"
  ) {
    return;
  }
  return {
    toolDefinitionBytes,
    toolDefinitionEstimatedTokens,
    toolDefinitionTokenEstimateMethod: "ceil_utf8_bytes_div_4",
  };
}

interface ModelContextResponseBinding {
  eventSeq: number;
  runId: string;
  turnIndex: number;
  model: string;
  stopReason: string;
  envelopeSha256: string;
  messageSetSha256: string;
  toolDefinitionSetSha256: string;
}

function responseBindingProjection(
  binding: ModelContextResponseBinding | undefined,
  envelopeSha256: string,
  messageSetSha256: string,
  toolDefinitionSetSha256: string,
): Pick<
  ModelContextEnvelopeView,
  "responseSeq" | "responseModel" | "responseStopReason"
> {
  if (
    !binding ||
    binding.envelopeSha256 !== envelopeSha256 ||
    binding.messageSetSha256 !== messageSetSha256 ||
    binding.toolDefinitionSetSha256 !== toolDefinitionSetSha256
  ) {
    return {};
  }
  return {
    responseSeq: binding.eventSeq,
    responseModel: binding.model,
    responseStopReason: binding.stopReason,
  };
}

function responseBindingView(
  event: RunEvent,
): ModelContextResponseBinding | undefined {
  if (event.type !== "model.response" || !record(event.payload)) {
    return undefined;
  }
  const payload = event.payload;
  const turnIndex = nonNegativeInteger(
    payload["modelContextEnvelopeTurnIndex"],
  );
  const envelopeSha256 = hash(payload["modelContextEnvelopeSha256"]);
  const messageSetSha256 = hash(payload["modelContextMessageSetSha256"]);
  const toolDefinitionSetSha256 = hash(
    payload["modelContextToolDefinitionSetSha256"],
  );
  const model = boundedText(payload["model"], 160);
  const stopReason = boundedText(payload["stopReason"], 64);
  if (
    turnIndex === undefined ||
    !envelopeSha256 ||
    !messageSetSha256 ||
    !toolDefinitionSetSha256 ||
    !model ||
    !stopReason
  ) {
    return undefined;
  }
  return {
    eventSeq: event.seq,
    runId: event.runId,
    turnIndex,
    model,
    stopReason,
    envelopeSha256,
    messageSetSha256,
    toolDefinitionSetSha256,
  };
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
