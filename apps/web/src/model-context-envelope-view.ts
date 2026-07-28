import type { RunEvent } from "@napier/contracts";

export interface ModelContextEnvelopeView {
  eventSeq: number;
  runId: string;
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
  systemPromptSha256: string;
  messageSetSha256: string;
  toolNameSetSha256: string;
  toolDefinitionSetSha256: string;
  contentSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ALLOWED_KEYS = new Set([
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
]);

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
  return events.flatMap((event): ModelContextEnvelopeView[] => {
    if (event.type !== "context.model_envelope" || !record(event.payload)) {
      return [];
    }
    const payload = event.payload;
    if (
      Object.keys(payload).length !== ALLOWED_KEYS.size ||
      Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key)) ||
      payload["kind"] !== "napier.model-context-envelope" ||
      payload["schemaVersion"] !== 1
    ) {
      return [];
    }
    const turnIndex = nonNegativeInteger(payload["turnIndex"]);
    const systemPromptBytes = nonNegativeInteger(payload["systemPromptBytes"]);
    const messageCount = nonNegativeInteger(payload["messageCount"]);
    const userMessageCount = nonNegativeInteger(payload["userMessageCount"]);
    const assistantMessageCount = nonNegativeInteger(
      payload["assistantMessageCount"],
    );
    const toolResultMessageCount = nonNegativeInteger(
      payload["toolResultMessageCount"],
    );
    const otherMessageCount = nonNegativeInteger(payload["otherMessageCount"]);
    const toolCount = nonNegativeInteger(payload["toolCount"]);
    const systemPromptSha256 = hash(payload["systemPromptSha256"]);
    const messageSetSha256 = hash(payload["messageSetSha256"]);
    const toolNameSetSha256 = hash(payload["toolNameSetSha256"]);
    const toolDefinitionSetSha256 = hash(payload["toolDefinitionSetSha256"]);
    const contentSha256 = hash(payload["contentSha256"]);
    if (
      turnIndex === undefined ||
      systemPromptBytes === undefined ||
      messageCount === undefined ||
      userMessageCount === undefined ||
      assistantMessageCount === undefined ||
      toolResultMessageCount === undefined ||
      otherMessageCount === undefined ||
      toolCount === undefined ||
      !systemPromptSha256 ||
      !messageSetSha256 ||
      !toolNameSetSha256 ||
      !toolDefinitionSetSha256 ||
      !contentSha256 ||
      userMessageCount +
        assistantMessageCount +
        toolResultMessageCount +
        otherMessageCount !==
        messageCount
    ) {
      return [];
    }
    return [
      {
        eventSeq: event.seq,
        runId: event.runId,
        turnIndex,
        ...responseBindingProjection(
          responsesByRunAndTurn.get(`${event.runId}:${turnIndex}`),
          contentSha256,
          messageSetSha256,
          toolDefinitionSetSha256,
        ),
        systemPromptBytes,
        messageCount,
        userMessageCount,
        assistantMessageCount,
        toolResultMessageCount,
        otherMessageCount,
        toolCount,
        systemPromptSha256,
        messageSetSha256,
        toolNameSetSha256,
        toolDefinitionSetSha256,
        contentSha256,
      },
    ];
  });
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
