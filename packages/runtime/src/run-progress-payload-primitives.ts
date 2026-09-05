import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  RunProgressPayloadValidationError,
  type RunProgressPayloadValidationCode,
} from "./run-progress-payload-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export function validateOperatorEpoch(
  event: RunEvent,
  currentEpoch: string,
): string {
  validateEnvelopeSchema(event);
  const value = object(event.payload, event.seq);
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "parentControlEpochId",
      "messageSetSha256",
      "contentSha256",
    ],
    [],
    event.seq,
  );
  if (
    value["kind"] !== "napier.run-progress-operator-epoch" ||
    value["schemaVersion"] !== 1 ||
    value["parentControlEpochId"] !== currentEpoch
  ) {
    fail(
      "control_epoch_lineage",
      "Run progress operator epoch has a stale parent",
      event.seq,
    );
  }
  const messageSetSha256 = hash(
    value["messageSetSha256"],
    "messageSetSha256",
    event.seq,
  );
  const contentSha256 = hash(
    value["contentSha256"],
    "contentSha256",
    event.seq,
  );
  if (contentSha256 !== sha256(`${currentEpoch}\0${messageSetSha256}`)) {
    fail(
      "content_hash",
      "Run progress operator epoch hash is invalid",
      event.seq,
    );
  }
  return contentSha256;
}

export function validateDirectiveDelivery(event: RunEvent): {
  id: string;
  kind: "convergence" | "no_progress";
  textSha256: string;
} {
  validateEnvelopeSchema(event);
  const value = object(event.payload, event.seq);
  exactKeys(
    value,
    [
      "text",
      "runProgressDirectiveId",
      "runProgressDirectiveKind",
      "textSha256",
    ],
    [],
    event.seq,
  );
  const text = nonEmptyText(value["text"], "text", event.seq);
  const directiveId = hash(
    value["runProgressDirectiveId"],
    "runProgressDirectiveId",
    event.seq,
  );
  const kind = value["runProgressDirectiveKind"];
  const textSha256 = value["textSha256"];
  if (
    (kind !== "convergence" && kind !== "no_progress") ||
    textSha256 !== sha256(text)
  ) {
    fail(
      "directive_lineage",
      "Run progress directive delivery is invalid",
      event.seq,
    );
  }
  return { id: directiveId, kind, textSha256 };
}

export function validateEnvelopeSchema(event: RunEvent): void {
  if (event.schemaVersion !== undefined && event.schemaVersion !== 1) {
    fail(
      "event_schema",
      "Run progress event envelope schema is unsupported",
      event.seq,
    );
  }
}

export function validateContentHash(value: JsonObject, eventSeq: number): void {
  const contentSha256 = hash(value["contentSha256"], "contentSha256", eventSeq);
  const { contentSha256: _ignored, ...content } = value;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    fail(
      "content_hash",
      "Run progress payload contentSha256 is invalid",
      eventSeq,
    );
  }
}

export function exactKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[],
  eventSeq: number,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(
      "payload_shape",
      "Run progress payload fields do not match its schema",
      eventSeq,
    );
  }
}

export function orderedRunEvents(
  events: readonly RunEvent[],
  runId: string,
): readonly RunEvent[] {
  const result = events.filter((event) => event.runId === runId);
  let previous = 0;
  for (const event of result) {
    if (!Number.isSafeInteger(event.seq) || event.seq <= previous) {
      fail(
        "event_order",
        "Run ledger events are not in strict sequence order",
        event.seq,
      );
    }
    previous = event.seq;
  }
  return result;
}

export function isDecisionEvent(type: string): boolean {
  return [
    "run.progress.convergence_requested",
    "run.progress.convergence_activated",
    "run.progress.convergence_reopened",
    "run.progress.rerouted",
  ].includes(type);
}

export function object(
  value: JsonValue | undefined,
  eventSeq: number,
  label = "Run progress payload",
): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("payload_shape", `${label} must be an object`, eventSeq);
  }
  return value;
}

export function predecessorHash(
  value: JsonValue | undefined,
  eventSeq: number,
): string {
  if (value === "") return "";
  return hash(value, "predecessorContentSha256", eventSeq);
}

export function hash(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    return fail("payload_shape", `${label} must be a SHA-256 digest`, eventSeq);
  }
  return value;
}

export function nonEmptyText(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail("payload_shape", `${label} must be non-empty text`, eventSeq);
  }
  return value;
}

export function boolean(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): boolean {
  if (typeof value !== "boolean") {
    return fail("payload_shape", `${label} must be boolean`, eventSeq);
  }
  return value;
}

export function positiveInteger(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): number {
  const candidate = nonNegativeInteger(value, label, eventSeq);
  if (candidate === 0)
    return fail("payload_shape", `${label} must be positive`, eventSeq);
  return candidate;
}

export function nonNegativeInteger(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(
      "payload_shape",
      `${label} must be a non-negative integer`,
      eventSeq,
    );
  }
  return value;
}

export function integerValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function fail(
  code: RunProgressPayloadValidationCode,
  message: string,
  eventSeq?: number,
): never {
  throw new RunProgressPayloadValidationError(code, message, eventSeq);
}
