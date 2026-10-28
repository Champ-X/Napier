import type { JsonValue, RunControlMessageMode } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";

export const MAX_RUN_CONTROL_MESSAGE_BYTES = 16 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_MESSAGE_ID = /^control_[a-z0-9]{8,80}$/;
const MODES = new Set<RunControlMessageMode>(["steering", "follow_up"]);
const CLIENT_MESSAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export interface RunControlMessageQueuedPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.run-control-message-queued";
  schemaVersion: 1;
  controlMessageId: string;
  clientMessageId?: string;
  mode: RunControlMessageMode;
  text: string;
  textSha256: string;
  textBytes: number;
  requestSha256: string;
}

export function createRunControlMessageQueuedPayload(input: {
  controlMessageId: string;
  clientMessageId?: string;
  mode: RunControlMessageMode;
  text: string;
}): RunControlMessageQueuedPayload {
  const text = input.text.trim();
  if (
    input.clientMessageId !== undefined &&
    !isRunControlClientMessageId(input.clientMessageId)
  ) {
    throw new Error("Run control clientMessageId is invalid");
  }
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
    ...(input.clientMessageId
      ? { clientMessageId: input.clientMessageId }
      : {}),
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

export function parseQueuedPayload(
  input: JsonValue,
): RunControlMessageQueuedPayload | undefined {
  if (!record(input)) return undefined;
  const controlMessageId = input["controlMessageId"];
  const clientMessageId = input["clientMessageId"];
  const mode = input["mode"];
  const text = input["text"];
  const textSha256 = input["textSha256"];
  const textBytes = input["textBytes"];
  const requestSha256 = input["requestSha256"];
  if (
    input["kind"] !== "napier.run-control-message-queued" ||
    input["schemaVersion"] !== 1 ||
    (clientMessageId !== undefined &&
      !isRunControlClientMessageId(clientMessageId)) ||
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
    ...(clientMessageId ? { clientMessageId: clientMessageId as string } : {}),
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

export function controlMessageIdForRequest(input: {
  threadId: string;
  runId: string;
  clientMessageId?: string;
}): string {
  if (input.clientMessageId === undefined) return createId("control");
  if (!isRunControlClientMessageId(input.clientMessageId))
    throw new Error("Run control clientMessageId is invalid");
  return `control_${sha256(canonicalJson([input.threadId, input.runId, input.clientMessageId])).slice(0, 40)}`;
}

export function isRunControlClientMessageId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_MESSAGE_ID.test(value);
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function record(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
