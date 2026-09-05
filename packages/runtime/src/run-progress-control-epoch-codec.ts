import type { JsonObject, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  exactKeys,
  fail,
  hash,
  nonEmptyText,
  object,
  positiveInteger,
  validateContentHash,
  validateEnvelopeSchema,
} from "./run-progress-payload-primitives.js";

const CONTROL_MESSAGE_ID = /^control_[a-z0-9]{8,80}$/u;
const CONTROL_MODES = new Set(["steering", "follow_up"]);
const CONTROL_CANCELLATION_REASONS = new Set([
  "operator_cancelled",
  "run_completed_before_delivery",
  "run_failed_before_delivery",
  "run_cancelled_before_delivery",
  "run_interrupted_before_delivery",
]);

export interface DecodedRunControlEpoch {
  controlEpochId: string;
  controlMessageId: string;
  /** The durable user instruction is visible through this logical cursor. */
  boundarySeq: number;
}

interface ControlMessageLifecycle extends QueuedControlMessage {
  queuedEventSeq: number;
  threadId: string;
  runId: string;
  status: "queued" | "cancelled" | "delivered";
}

/**
 * Projects the control-message lifecycle once, in ledger order. Unlike a
 * delivery-only lookup this proves that a request existed before delivery,
 * was not cancelled, and is consumed at most once.
 */
export function projectRunControlEpochs(
  events: readonly RunEvent[],
): readonly (DecodedRunControlEpoch & { eventSeq: number })[] {
  const eventBySeq = new Map(events.map((event) => [event.seq, event]));
  const messages = new Map<string, ControlMessageLifecycle>();
  const epochs: Array<DecodedRunControlEpoch & { eventSeq: number }> = [];
  for (const event of events) {
    if (event.type === "run.control.queued") {
      consumeQueued(messages, event);
      continue;
    }
    if (event.type === "run.control.cancelled") {
      consumeCancellation(messages, event);
      continue;
    }
    if (event.type !== "run.control.delivered") continue;
    epochs.push(consumeDelivery(messages, event, eventBySeq));
  }
  return epochs;
}

interface ControlDelivery {
  controlMessageId: string;
  mode: string;
  textSha256: string;
  queuedEventSeq: number;
  messageEventSeq: number;
  contentSha256: string;
}

interface QueuedControlMessage {
  controlMessageId: string;
  mode: string;
  text: string;
  textSha256: string;
}

interface ControlCancellation {
  controlMessageId: string;
  mode: string;
  textSha256: string;
  queuedEventSeq: number;
}

function consumeQueued(
  messages: Map<string, ControlMessageLifecycle>,
  event: RunEvent,
): void {
  validateEnvelopeSchema(event);
  const queued = decodeQueued(event, event.seq);
  if (messages.has(queued.controlMessageId)) {
    fail(
      "control_epoch_lineage",
      "Run control message ID was queued more than once",
      event.seq,
    );
  }
  messages.set(queued.controlMessageId, {
    ...queued,
    queuedEventSeq: event.seq,
    threadId: event.threadId,
    runId: event.runId,
    status: "queued",
  });
}

function consumeCancellation(
  messages: Map<string, ControlMessageLifecycle>,
  event: RunEvent,
): void {
  validateEnvelopeSchema(event);
  const cancellation = decodeCancellation(event);
  const current = messages.get(cancellation.controlMessageId);
  if (
    !current ||
    current.status !== "queued" ||
    current.queuedEventSeq >= event.seq ||
    current.queuedEventSeq !== cancellation.queuedEventSeq ||
    current.threadId !== event.threadId ||
    current.runId !== event.runId ||
    current.mode !== cancellation.mode ||
    current.textSha256 !== cancellation.textSha256
  ) {
    fail(
      "control_epoch_lineage",
      "Run control cancellation has no matching queued request",
      event.seq,
    );
  }
  current.status = "cancelled";
}

function consumeDelivery(
  messages: Map<string, ControlMessageLifecycle>,
  event: RunEvent,
  eventBySeq: ReadonlyMap<number, RunEvent>,
): DecodedRunControlEpoch & { eventSeq: number } {
  validateEnvelopeSchema(event);
  const delivery = decodeDelivery(event);
  const queued = messages.get(delivery.controlMessageId);
  const messageEvent = eventBySeq.get(delivery.messageEventSeq);
  if (
    !queued ||
    queued.status !== "queued" ||
    queued.queuedEventSeq >= event.seq ||
    queued.queuedEventSeq !== delivery.queuedEventSeq ||
    queued.runId !== event.runId ||
    queued.threadId !== event.threadId ||
    queued.mode !== delivery.mode ||
    queued.textSha256 !== delivery.textSha256 ||
    delivery.messageEventSeq !== event.seq + 1 ||
    !messageEvent ||
    messageEvent.runId !== event.runId ||
    messageEvent.threadId !== event.threadId
  ) {
    return fail(
      "control_epoch_lineage",
      "Run control delivery has no live queued request or adjacent user message",
      event.seq,
    );
  }
  validateUserMessage(messageEvent, queued, event.seq);
  queued.status = "delivered";
  return {
    eventSeq: event.seq,
    controlEpochId: delivery.contentSha256,
    controlMessageId: delivery.controlMessageId,
    boundarySeq: delivery.messageEventSeq,
  };
}

function decodeDelivery(event: RunEvent): ControlDelivery {
  const value = object(event.payload, event.seq);
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "controlMessageId",
      "mode",
      "textSha256",
      "queuedEventSeq",
      "messageEventSeq",
      "contentSha256",
    ],
    [],
    event.seq,
  );
  if (
    event.type !== "run.control.delivered" ||
    value["kind"] !== "napier.run-control-message-delivered" ||
    value["schemaVersion"] !== 1
  ) {
    return fail(
      "control_epoch_lineage",
      "Run control delivery payload is invalid",
      event.seq,
    );
  }
  validateContentHash(value, event.seq);
  return {
    controlMessageId: controlId(value, event.seq),
    mode: controlMode(value, event.seq),
    textSha256: hash(value["textSha256"], "textSha256", event.seq),
    queuedEventSeq: positiveInteger(
      value["queuedEventSeq"],
      "queuedEventSeq",
      event.seq,
    ),
    messageEventSeq: positiveInteger(
      value["messageEventSeq"],
      "messageEventSeq",
      event.seq,
    ),
    contentSha256: hash(value["contentSha256"], "contentSha256", event.seq),
  };
}

function decodeQueued(
  event: RunEvent,
  deliveryEventSeq: number,
): QueuedControlMessage {
  validateEnvelopeSchema(event);
  const value = object(event.payload, deliveryEventSeq);
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "controlMessageId",
      "mode",
      "text",
      "textSha256",
      "textBytes",
      "requestSha256",
    ],
    [],
    deliveryEventSeq,
  );
  if (
    event.type !== "run.control.queued" ||
    value["kind"] !== "napier.run-control-message-queued" ||
    value["schemaVersion"] !== 1
  ) {
    return fail(
      "control_epoch_lineage",
      "Run control delivery references an invalid queued request",
      deliveryEventSeq,
    );
  }
  const text = nonEmptyText(value["text"], "text", deliveryEventSeq);
  const textSha256 = hash(value["textSha256"], "textSha256", deliveryEventSeq);
  const textBytes = positiveInteger(
    value["textBytes"],
    "textBytes",
    deliveryEventSeq,
  );
  const requestSha256 = hash(
    value["requestSha256"],
    "requestSha256",
    deliveryEventSeq,
  );
  const { requestSha256: _ignored, ...content } = value;
  if (
    sha256(text) !== textSha256 ||
    Buffer.byteLength(text, "utf8") !== textBytes ||
    sha256(canonicalJson(content)) !== requestSha256
  ) {
    return fail(
      "control_epoch_lineage",
      "Run control queued request integrity is invalid",
      deliveryEventSeq,
    );
  }
  return {
    controlMessageId: controlId(value, deliveryEventSeq),
    mode: controlMode(value, deliveryEventSeq),
    text,
    textSha256,
  };
}

function decodeCancellation(event: RunEvent): ControlCancellation {
  const value = object(event.payload, event.seq);
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "controlMessageId",
      "mode",
      "textSha256",
      "queuedEventSeq",
      "reason",
      "contentSha256",
    ],
    [],
    event.seq,
  );
  if (
    event.type !== "run.control.cancelled" ||
    value["kind"] !== "napier.run-control-message-cancelled" ||
    value["schemaVersion"] !== 1 ||
    !CONTROL_CANCELLATION_REASONS.has(String(value["reason"]))
  ) {
    return fail(
      "control_epoch_lineage",
      "Run control cancellation payload is invalid",
      event.seq,
    );
  }
  validateContentHash(value, event.seq);
  return {
    controlMessageId: controlId(value, event.seq),
    mode: controlMode(value, event.seq),
    textSha256: hash(value["textSha256"], "textSha256", event.seq),
    queuedEventSeq: positiveInteger(
      value["queuedEventSeq"],
      "queuedEventSeq",
      event.seq,
    ),
  };
}

function validateUserMessage(
  event: RunEvent,
  queued: QueuedControlMessage,
  deliveryEventSeq: number,
): void {
  validateEnvelopeSchema(event);
  const value = object(event.payload, deliveryEventSeq);
  exactKeys(
    value,
    ["role", "text", "controlMessageId", "controlMode", "textSha256"],
    [],
    deliveryEventSeq,
  );
  if (
    event.type !== "message.user" ||
    value["role"] !== "user" ||
    value["text"] !== queued.text ||
    value["controlMessageId"] !== queued.controlMessageId ||
    value["controlMode"] !== queued.mode ||
    value["textSha256"] !== queued.textSha256
  ) {
    fail(
      "control_epoch_lineage",
      "Run control delivery is not bound to the durable user message",
      deliveryEventSeq,
    );
  }
}

function controlId(value: JsonObject, eventSeq: number): string {
  const id = nonEmptyText(
    value["controlMessageId"],
    "controlMessageId",
    eventSeq,
  );
  return CONTROL_MESSAGE_ID.test(id)
    ? id
    : fail(
        "control_epoch_lineage",
        "Run control message ID is invalid",
        eventSeq,
      );
}

function controlMode(value: JsonObject, eventSeq: number): string {
  const mode = nonEmptyText(value["mode"], "mode", eventSeq);
  return CONTROL_MODES.has(mode)
    ? mode
    : fail(
        "control_epoch_lineage",
        "Run control message mode is invalid",
        eventSeq,
      );
}
