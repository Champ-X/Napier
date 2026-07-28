import type { RunEvent } from "@napier/contracts";

export interface ModelContextEnvelopeView {
  eventSeq: number;
  runId: string;
  turnIndex: number;
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
