import type { RunEvent } from "@napier/contracts";

export interface MessageEventTraceView {
  action: string;
  role?: string;
  model?: string;
  controlMessageId?: string;
  controlMode?: string;
  textBytes?: number;
  textSha256?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

const MESSAGE_EVENT = /^(message\.(user|assistant)|system\.note)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const MESSAGE_RECEIPT_SUMMARY = "message receipt";

export function messageEventTraceView(
  event: RunEvent,
): MessageEventTraceView | undefined {
  if (!MESSAGE_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const usage = record(event.payload["usage"]) ? event.payload["usage"] : {};
  const text =
    typeof event.payload["text"] === "string" ? event.payload["text"] : "";
  return {
    action: event.type,
    ...safeTokenField(event.payload, "role"),
    ...safeTokenField(event.payload, "model"),
    ...safeTokenField(event.payload, "controlMode"),
    ...safeIdField(event.payload, "controlMessageId"),
    ...(text ? { textBytes: textBytes(text) } : {}),
    ...shaField(event.payload, "textSha256"),
    ...numberAliasField(usage, "inputTokens", "inputTokens"),
    ...numberAliasField(usage, "outputTokens", "outputTokens"),
    ...numberAliasField(usage, "cacheReadTokens", "cacheReadTokens"),
    ...numberAliasField(usage, "cacheWriteTokens", "cacheWriteTokens"),
    ...numberAliasField(usage, "costUsd", "costUsd"),
  };
}

export function messageEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("message.") && !event.type.startsWith("system.")) {
    return undefined;
  }
  if (!MESSAGE_EVENT.test(event.type)) return event.category;
  const view = messageEventTraceView(event);
  if (!view) return MESSAGE_RECEIPT_SUMMARY;
  return [
    `message / ${view.action}`,
    ...(view.role ? [`role ${view.role}`] : []),
    ...(view.model ? [`model ${view.model}`] : []),
    ...(view.controlMode ? [`control-mode ${view.controlMode}`] : []),
    ...(view.controlMessageId
      ? [`control-message ${view.controlMessageId.slice(-10)}`]
      : []),
    ...(view.textBytes !== undefined ? [`text-bytes ${view.textBytes}`] : []),
    ...(view.inputTokens !== undefined ? [`input ${view.inputTokens}`] : []),
    ...(view.outputTokens !== undefined ? [`output ${view.outputTokens}`] : []),
    ...(view.cacheReadTokens !== undefined
      ? [`cache-read ${view.cacheReadTokens}`]
      : []),
    ...(view.cacheWriteTokens !== undefined
      ? [`cache-write ${view.cacheWriteTokens}`]
      : []),
    ...(view.costUsd !== undefined
      ? [`cost ${formatNumber(view.costUsd)}`]
      : []),
    ...(view.textSha256 ? [`text ${view.textSha256.slice(0, 12)}`] : []),
  ].join(" / ");
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof MessageEventTraceView,
): Partial<MessageEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof MessageEventTraceView,
): Partial<MessageEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof MessageEventTraceView,
): Partial<MessageEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function numberAliasField(
  payload: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof MessageEventTraceView,
): Partial<MessageEventTraceView> {
  const value = payload[sourceKey];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [targetKey]: value }
    : {};
}

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
