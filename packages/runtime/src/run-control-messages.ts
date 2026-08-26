import type {
  JsonValue,
  RunControlMessage,
  RunControlMessageCancellationReason,
  RunControlMessageMode,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const RUN_CONTROL_MESSAGE_QUEUED_EVENT = "run.control.queued";
export const RUN_CONTROL_MESSAGE_DELIVERED_EVENT = "run.control.delivered";
export const RUN_CONTROL_MESSAGE_CANCELLED_EVENT = "run.control.cancelled";
export const MAX_RUN_CONTROL_MESSAGE_BYTES = 16 * 1024;
export const MAX_PENDING_RUN_CONTROL_MESSAGES = 16;
export const MAX_TOTAL_RUN_CONTROL_MESSAGES = 64;

const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_MESSAGE_ID = /^control_[a-z0-9]{8,80}$/;
const MODES = new Set<RunControlMessageMode>(["steering", "follow_up"]);
const CANCELLATION_REASONS = new Set<RunControlMessageCancellationReason>([
  "operator_cancelled",
  "run_completed_before_delivery",
  "run_failed_before_delivery",
  "run_cancelled_before_delivery",
  "run_interrupted_before_delivery",
]);

export interface RunControlMessageQueuedPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.run-control-message-queued";
  schemaVersion: 1;
  controlMessageId: string;
  mode: RunControlMessageMode;
  text: string;
  textSha256: string;
  textBytes: number;
  requestSha256: string;
}

export interface RunControlMessageDeliveredPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.run-control-message-delivered";
  schemaVersion: 1;
  controlMessageId: string;
  mode: RunControlMessageMode;
  textSha256: string;
  queuedEventSeq: number;
  messageEventSeq: number;
  contentSha256: string;
}

export interface RunControlMessageCancelledPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.run-control-message-cancelled";
  schemaVersion: 1;
  controlMessageId: string;
  mode: RunControlMessageMode;
  textSha256: string;
  queuedEventSeq: number;
  reason: RunControlMessageCancellationReason;
  contentSha256: string;
}

export interface PendingRunControlMessage {
  message: RunControlMessage;
  text: string;
}

export function createRunControlMessageQueuedPayload(input: {
  controlMessageId: string;
  mode: RunControlMessageMode;
  text: string;
}): RunControlMessageQueuedPayload {
  const text = normalizeControlMessageText(input.text);
  const textBytes = Buffer.byteLength(text, "utf8");
  if (!CONTROL_MESSAGE_ID.test(input.controlMessageId)) {
    throw new Error("Run control message ID is invalid");
  }
  if (!MODES.has(input.mode)) {
    throw new Error("Run control message mode is invalid");
  }
  if (textBytes === 0 || textBytes > MAX_RUN_CONTROL_MESSAGE_BYTES) {
    throw new Error(
      `Run control message must be 1-${MAX_RUN_CONTROL_MESSAGE_BYTES} UTF-8 bytes`,
    );
  }
  const content = {
    kind: "napier.run-control-message-queued" as const,
    schemaVersion: 1 as const,
    controlMessageId: input.controlMessageId,
    mode: input.mode,
    text,
    textSha256: sha256(text),
    textBytes,
  };
  return {
    ...content,
    requestSha256: sha256(canonicalJson(content)),
  };
}

export function createRunControlMessageDeliveredPayload(input: {
  message: RunControlMessage;
  messageEventSeq: number;
}): RunControlMessageDeliveredPayload {
  if (input.message.status !== "queued") {
    throw new Error("Only a queued Run control message can be delivered");
  }
  if (!positiveInteger(input.messageEventSeq)) {
    throw new Error("Run control message delivery event sequence is invalid");
  }
  const content = {
    kind: "napier.run-control-message-delivered" as const,
    schemaVersion: 1 as const,
    controlMessageId: input.message.id,
    mode: input.message.mode,
    textSha256: input.message.textSha256,
    queuedEventSeq: input.message.queuedEventSeq,
    messageEventSeq: input.messageEventSeq,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createRunControlMessageCancelledPayload(input: {
  message: RunControlMessage;
  reason: RunControlMessageCancellationReason;
}): RunControlMessageCancelledPayload {
  if (input.message.status !== "queued") {
    throw new Error("Only a queued Run control message can be cancelled");
  }
  if (!CANCELLATION_REASONS.has(input.reason)) {
    throw new Error("Run control message cancellation reason is invalid");
  }
  const content = {
    kind: "napier.run-control-message-cancelled" as const,
    schemaVersion: 1 as const,
    controlMessageId: input.message.id,
    mode: input.message.mode,
    textSha256: input.message.textSha256,
    queuedEventSeq: input.message.queuedEventSeq,
    reason: input.reason,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createRunControlMessageUserPayload(
  pending: PendingRunControlMessage,
): { role: "user"; text: string } & Record<string, JsonValue> {
  return {
    role: "user",
    text: pending.text,
    controlMessageId: pending.message.id,
    controlMode: pending.message.mode,
    textSha256: pending.message.textSha256,
  };
}

export function projectRunControlMessages(
  events: RunEvent[],
  runId?: string,
): RunControlMessage[] {
  const ordered = events
    .filter((event) => !runId || event.runId === runId)
    .slice()
    .sort((left, right) => left.seq - right.seq);
  const bySeq = new Map(ordered.map((event) => [event.seq, event]));
  const messages = new Map<string, RunControlMessage>();

  for (const event of ordered) {
    if (event.type === RUN_CONTROL_MESSAGE_QUEUED_EVENT) {
      const payload = parseQueuedPayload(event.payload);
      if (!payload || messages.has(payload.controlMessageId)) continue;
      const content = {
        kind: "napier.run-control-message" as const,
        schemaVersion: 1 as const,
        id: payload.controlMessageId,
        threadId: event.threadId,
        runId: event.runId,
        mode: payload.mode,
        status: "queued" as const,
        textSha256: payload.textSha256,
        textBytes: payload.textBytes,
        queuedAt: event.createdAt,
        queuedEventSeq: event.seq,
      };
      messages.set(payload.controlMessageId, {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      });
      continue;
    }

    if (event.type === RUN_CONTROL_MESSAGE_DELIVERED_EVENT) {
      const payload = parseDeliveredPayload(event.payload);
      const current = payload
        ? messages.get(payload.controlMessageId)
        : undefined;
      const userEvent = payload
        ? bySeq.get(payload.messageEventSeq)
        : undefined;
      if (
        !payload ||
        !current ||
        current.status !== "queued" ||
        event.threadId !== current.threadId ||
        event.runId !== current.runId ||
        payload.messageEventSeq !== event.seq + 1 ||
        !matchesMessage(payload, current) ||
        !isDeliveredUserEvent(userEvent, current)
      ) {
        continue;
      }
      const content = {
        ...withoutContentSha256(current),
        status: "delivered" as const,
        deliveredAt: event.createdAt,
        deliveredEventSeq: event.seq,
        messageEventSeq: payload.messageEventSeq,
      };
      messages.set(current.id, {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      });
      continue;
    }

    if (event.type === RUN_CONTROL_MESSAGE_CANCELLED_EVENT) {
      const payload = parseCancelledPayload(event.payload);
      const current = payload
        ? messages.get(payload.controlMessageId)
        : undefined;
      if (
        !payload ||
        !current ||
        current.status !== "queued" ||
        !matchesMessage(payload, current)
      ) {
        continue;
      }
      const content = {
        ...withoutContentSha256(current),
        status: "cancelled" as const,
        cancelledAt: event.createdAt,
        cancellationEventSeq: event.seq,
        cancellationReason: payload.reason,
      };
      messages.set(current.id, {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      });
    }
  }

  return [...messages.values()].sort(
    (left, right) =>
      left.queuedEventSeq - right.queuedEventSeq ||
      left.id.localeCompare(right.id),
  );
}

export function nextPendingRunControlMessage(
  events: RunEvent[],
  runId: string,
  mode: RunControlMessageMode,
): PendingRunControlMessage | undefined {
  const message = projectRunControlMessages(events, runId).find(
    (candidate) => candidate.status === "queued" && candidate.mode === mode,
  );
  if (!message) return undefined;
  const queuedEvent = events.find(
    (event) =>
      event.runId === runId &&
      event.seq === message.queuedEventSeq &&
      event.type === RUN_CONTROL_MESSAGE_QUEUED_EVENT,
  );
  const payload = queuedEvent
    ? parseQueuedPayload(queuedEvent.payload)
    : undefined;
  return payload ? { message, text: payload.text } : undefined;
}

function parseQueuedPayload(
  input: JsonValue,
): RunControlMessageQueuedPayload | undefined {
  if (!record(input)) return undefined;
  const controlMessageId = input["controlMessageId"];
  const mode = input["mode"];
  const text = input["text"];
  const textSha256 = input["textSha256"];
  const textBytes = input["textBytes"];
  const requestSha256 = input["requestSha256"];
  if (
    input["kind"] !== "napier.run-control-message-queued" ||
    input["schemaVersion"] !== 1 ||
    typeof controlMessageId !== "string" ||
    !CONTROL_MESSAGE_ID.test(controlMessageId) ||
    typeof mode !== "string" ||
    !MODES.has(mode as RunControlMessageMode) ||
    typeof text !== "string" ||
    typeof textSha256 !== "string" ||
    !SHA256.test(textSha256) ||
    !positiveInteger(textBytes) ||
    Number(textBytes) > MAX_RUN_CONTROL_MESSAGE_BYTES ||
    typeof requestSha256 !== "string" ||
    !SHA256.test(requestSha256)
  ) {
    return undefined;
  }
  const payload = {
    kind: "napier.run-control-message-queued" as const,
    schemaVersion: 1 as const,
    controlMessageId,
    mode: mode as RunControlMessageMode,
    text,
    textSha256,
    textBytes: Number(textBytes),
    requestSha256,
  };
  const { requestSha256: _requestSha256, ...content } = payload;
  return sha256(text) === textSha256 &&
    Buffer.byteLength(text, "utf8") === textBytes &&
    sha256(canonicalJson(content)) === requestSha256
    ? payload
    : undefined;
}

function parseDeliveredPayload(
  input: JsonValue,
): RunControlMessageDeliveredPayload | undefined {
  if (!record(input)) return undefined;
  const payload = {
    kind: input["kind"],
    schemaVersion: input["schemaVersion"],
    controlMessageId: input["controlMessageId"],
    mode: input["mode"],
    textSha256: input["textSha256"],
    queuedEventSeq: input["queuedEventSeq"],
    messageEventSeq: input["messageEventSeq"],
    contentSha256: input["contentSha256"],
  };
  if (
    payload.kind !== "napier.run-control-message-delivered" ||
    payload.schemaVersion !== 1 ||
    typeof payload.controlMessageId !== "string" ||
    !CONTROL_MESSAGE_ID.test(payload.controlMessageId) ||
    typeof payload.mode !== "string" ||
    !MODES.has(payload.mode as RunControlMessageMode) ||
    typeof payload.textSha256 !== "string" ||
    !SHA256.test(payload.textSha256) ||
    !positiveInteger(payload.queuedEventSeq) ||
    !positiveInteger(payload.messageEventSeq) ||
    typeof payload.contentSha256 !== "string" ||
    !SHA256.test(payload.contentSha256)
  ) {
    return undefined;
  }
  const normalized = {
    kind: "napier.run-control-message-delivered" as const,
    schemaVersion: 1 as const,
    controlMessageId: payload.controlMessageId,
    mode: payload.mode as RunControlMessageMode,
    textSha256: payload.textSha256,
    queuedEventSeq: Number(payload.queuedEventSeq),
    messageEventSeq: Number(payload.messageEventSeq),
    contentSha256: payload.contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  return sha256(canonicalJson(content)) === normalized.contentSha256
    ? normalized
    : undefined;
}

function parseCancelledPayload(
  input: JsonValue,
): RunControlMessageCancelledPayload | undefined {
  if (!record(input)) return undefined;
  const payload = {
    kind: input["kind"],
    schemaVersion: input["schemaVersion"],
    controlMessageId: input["controlMessageId"],
    mode: input["mode"],
    textSha256: input["textSha256"],
    queuedEventSeq: input["queuedEventSeq"],
    reason: input["reason"],
    contentSha256: input["contentSha256"],
  };
  if (
    payload.kind !== "napier.run-control-message-cancelled" ||
    payload.schemaVersion !== 1 ||
    typeof payload.controlMessageId !== "string" ||
    !CONTROL_MESSAGE_ID.test(payload.controlMessageId) ||
    typeof payload.mode !== "string" ||
    !MODES.has(payload.mode as RunControlMessageMode) ||
    typeof payload.textSha256 !== "string" ||
    !SHA256.test(payload.textSha256) ||
    !positiveInteger(payload.queuedEventSeq) ||
    typeof payload.reason !== "string" ||
    !CANCELLATION_REASONS.has(
      payload.reason as RunControlMessageCancellationReason,
    ) ||
    typeof payload.contentSha256 !== "string" ||
    !SHA256.test(payload.contentSha256)
  ) {
    return undefined;
  }
  const normalized = {
    kind: "napier.run-control-message-cancelled" as const,
    schemaVersion: 1 as const,
    controlMessageId: payload.controlMessageId,
    mode: payload.mode as RunControlMessageMode,
    textSha256: payload.textSha256,
    queuedEventSeq: Number(payload.queuedEventSeq),
    reason: payload.reason as RunControlMessageCancellationReason,
    contentSha256: payload.contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  return sha256(canonicalJson(content)) === normalized.contentSha256
    ? normalized
    : undefined;
}

function matchesMessage(
  payload:
    | RunControlMessageDeliveredPayload
    | RunControlMessageCancelledPayload,
  message: RunControlMessage,
): boolean {
  return (
    payload.mode === message.mode &&
    payload.textSha256 === message.textSha256 &&
    payload.queuedEventSeq === message.queuedEventSeq
  );
}

function isDeliveredUserEvent(
  event: RunEvent | undefined,
  message: RunControlMessage,
): boolean {
  if (
    !event ||
    event.threadId !== message.threadId ||
    event.runId !== message.runId ||
    event.type !== "message.user" ||
    !record(event.payload)
  ) {
    return false;
  }
  const text = event.payload["text"];
  return (
    event.payload["role"] === "user" &&
    event.payload["controlMessageId"] === message.id &&
    event.payload["controlMode"] === message.mode &&
    event.payload["textSha256"] === message.textSha256 &&
    typeof text === "string" &&
    sha256(text) === message.textSha256
  );
}

function withoutContentSha256(
  message: RunControlMessage,
): Omit<RunControlMessage, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = message;
  return content;
}

function normalizeControlMessageText(value: string): string {
  return value.trim();
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function record(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
