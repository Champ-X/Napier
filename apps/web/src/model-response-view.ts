import type { RunEvent } from "@napier/contracts";

export interface ModelResponseTraceView {
  model: string;
  stopReason?: string;
  modelCallPurpose?: string;
  turnIndex?: number;
  textSha256?: string;
  reasoningSha256?: string;
  errorSha256?: string;
  toolCallCount: number;
  inputTokens?: number;
  outputTokens?: number;
}

const MODEL_RESPONSE_EVENT = "model.response";
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_LABEL = /^[A-Za-z0-9._:/@-]{1,160}$/u;
const MODEL_RESPONSE_RECEIPT_SUMMARY = "model response receipt";

export function modelResponseTraceView(
  event: RunEvent,
): ModelResponseTraceView | undefined {
  if (
    event.type !== MODEL_RESPONSE_EVENT ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const model = safeLabel(event.payload["model"]);
  if (!model) return undefined;
  const usage = record(event.payload["usage"]) ? event.payload["usage"] : {};
  const stopReason = safeLabel(event.payload["stopReason"], 64);
  const modelCallPurpose = safeLabel(event.payload["modelCallPurpose"], 80);
  const turnIndex = nonNegativeInteger(
    event.payload["modelContextEnvelopeTurnIndex"],
  );
  const textSha256 = sha256(event.payload["textSha256"]);
  const reasoningSha256 = sha256(event.payload["reasoningSha256"]);
  const errorSha256 = sha256(event.payload["errorSha256"]);
  const inputTokens = nonNegativeInteger(usage["inputTokens"]);
  const outputTokens = nonNegativeInteger(usage["outputTokens"]);
  return {
    model,
    ...(stopReason ? { stopReason } : {}),
    ...(modelCallPurpose ? { modelCallPurpose } : {}),
    ...(turnIndex !== undefined ? { turnIndex } : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(reasoningSha256 ? { reasoningSha256 } : {}),
    ...(errorSha256 ? { errorSha256 } : {}),
    toolCallCount: Array.isArray(event.payload["toolCalls"])
      ? event.payload["toolCalls"].length
      : 0,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

export function modelResponseTraceSummary(event: RunEvent): string | undefined {
  if (event.type !== MODEL_RESPONSE_EVENT) return undefined;
  const view = modelResponseTraceView(event);
  if (!view) return MODEL_RESPONSE_RECEIPT_SUMMARY;
  const parts = [`model / ${view.model}`];
  if (view.modelCallPurpose) parts.push(view.modelCallPurpose);
  if (view.stopReason) parts.push(view.stopReason);
  if (view.turnIndex !== undefined) parts.push(`turn ${view.turnIndex}`);
  if (view.toolCallCount > 0) parts.push(`tools ${view.toolCallCount}`);
  if (view.textSha256) parts.push(`text ${view.textSha256.slice(0, 12)}`);
  if (view.reasoningSha256) {
    parts.push(`reasoning ${view.reasoningSha256.slice(0, 12)}`);
  }
  if (view.errorSha256) parts.push(`error ${view.errorSha256.slice(0, 12)}`);
  if (view.inputTokens !== undefined || view.outputTokens !== undefined) {
    parts.push(`tokens ${view.inputTokens ?? 0}/${view.outputTokens ?? 0}`);
  }
  return parts.join(" / ");
}

function safeLabel(value: unknown, maximum = 160): string | undefined {
  return typeof value === "string" &&
    value.length <= maximum &&
    SAFE_LABEL.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
