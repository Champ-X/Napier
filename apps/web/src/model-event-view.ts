import type { RunEvent } from "@napier/contracts";

export interface ModelEventTraceView {
  action: string;
  redacted?: boolean;
  deltaBytes?: number;
  textBytes?: number;
  toolName?: string;
  threshold?: number;
  attemptCount?: number;
  fromSeq?: number;
  toSeq?: number;
  deltaSha256?: string;
  textSha256?: string;
  callSha256?: string;
  resultSha256?: string;
  attemptSetSha256?: string;
  policySha256?: string;
  contentSha256?: string;
  sourceRunId?: string;
  targetRunId?: string;
  sourceTurnIndex?: number;
  status?: string;
  sourceModel?: string;
  targetModel?: string;
  targetExecutionMode?: string;
  outputChanged?: boolean;
  textChanged?: boolean;
  toolCallDelta?: number;
  durationMsDelta?: number;
  costUsdDelta?: number;
  comparisonSha256?: string;
  previewSha256?: string;
  diagnosticSha256?: string;
}

const MODEL_EVENT =
  /^model\.(text\.delta|thinking\.delta|tool_loop\.detected|experiment\.(started|compared|failed))$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;
const MODEL_RECEIPT_SUMMARY = "model receipt";

export function modelEventTraceView(
  event: RunEvent,
): ModelEventTraceView | undefined {
  if (!MODEL_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const toolName = safeToolName(event.payload["toolName"]);
  return {
    action: event.type.slice("model.".length),
    ...booleanField(event.payload, "redacted"),
    ...integerField(event.payload, "deltaBytes"),
    ...integerField(event.payload, "textBytes"),
    ...(toolName ? { toolName } : {}),
    ...integerField(event.payload, "threshold"),
    ...integerField(event.payload, "attemptCount"),
    ...integerField(event.payload, "fromSeq"),
    ...integerField(event.payload, "toSeq"),
    ...shaField(event.payload, "deltaSha256"),
    ...shaField(event.payload, "textSha256"),
    ...shaField(event.payload, "callSha256"),
    ...shaField(event.payload, "resultSha256"),
    ...shaField(event.payload, "attemptSetSha256"),
    ...shaField(event.payload, "policySha256"),
    ...shaField(event.payload, "contentSha256"),
    ...safeTokenField(event.payload, "sourceRunId"),
    ...safeTokenField(event.payload, "targetRunId"),
    ...integerField(event.payload, "sourceTurnIndex"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "sourceModel"),
    ...safeTokenField(event.payload, "targetModel"),
    ...safeTokenField(event.payload, "targetExecutionMode"),
    ...booleanField(event.payload, "outputChanged"),
    ...booleanField(event.payload, "textChanged"),
    ...signedNumberField(event.payload, "toolCallDelta"),
    ...signedNumberField(event.payload, "durationMsDelta"),
    ...signedNumberField(event.payload, "costUsdDelta"),
    ...shaField(event.payload, "comparisonSha256"),
    ...shaField(event.payload, "previewSha256"),
    ...shaField(event.payload, "diagnosticSha256"),
  };
}

export function modelEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("model.")) return undefined;
  if (!MODEL_EVENT.test(event.type)) return event.category;
  const view = modelEventTraceView(event);
  if (!view) return MODEL_RECEIPT_SUMMARY;
  return [
    `model / ${view.action}`,
    ...(view.redacted !== undefined ? [`redacted ${view.redacted}`] : []),
    ...(view.deltaBytes !== undefined
      ? [`delta-bytes ${view.deltaBytes}`]
      : []),
    ...(view.textBytes !== undefined ? [`text-bytes ${view.textBytes}`] : []),
    ...(view.toolName ? [`tool ${view.toolName}`] : []),
    ...(view.threshold !== undefined ? [`threshold ${view.threshold}`] : []),
    ...(view.attemptCount !== undefined
      ? [`attempts ${view.attemptCount}`]
      : []),
    ...rangeSummary(view),
    ...hashSummary("delta", view.deltaSha256),
    ...hashSummary("text", view.textSha256),
    ...hashSummary("call", view.callSha256),
    ...hashSummary("result", view.resultSha256),
    ...hashSummary("attempt-set", view.attemptSetSha256),
    ...hashSummary("policy", view.policySha256),
    ...hashSummary("content", view.contentSha256),
    ...(view.sourceRunId ? [`source ${view.sourceRunId.slice(-10)}`] : []),
    ...(view.targetRunId ? [`target ${view.targetRunId.slice(-10)}`] : []),
    ...(view.sourceTurnIndex !== undefined
      ? [`turn ${view.sourceTurnIndex}`]
      : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.sourceModel ? [`source-model ${view.sourceModel}`] : []),
    ...(view.targetModel ? [`target-model ${view.targetModel}`] : []),
    ...(view.targetExecutionMode ? [`mode ${view.targetExecutionMode}`] : []),
    ...(view.outputChanged !== undefined
      ? [`output-changed ${view.outputChanged}`]
      : []),
    ...(view.textChanged !== undefined
      ? [`text-changed ${view.textChanged}`]
      : []),
    ...(view.toolCallDelta !== undefined
      ? [`tool-delta ${view.toolCallDelta}`]
      : []),
    ...(view.durationMsDelta !== undefined
      ? [`duration-delta ${view.durationMsDelta}`]
      : []),
    ...(view.costUsdDelta !== undefined
      ? [`cost-delta ${view.costUsdDelta}`]
      : []),
    ...hashSummary("comparison", view.comparisonSha256),
    ...hashSummary("preview", view.previewSha256),
    ...hashSummary("diagnostic", view.diagnosticSha256),
  ].join(" / ");
}

function rangeSummary(view: ModelEventTraceView): string[] {
  if (view.fromSeq !== undefined && view.toSeq !== undefined) {
    return [`range ${view.fromSeq}-${view.toSeq}`];
  }
  if (view.fromSeq !== undefined) return [`from ${view.fromSeq}`];
  return view.toSeq !== undefined ? [`to ${view.toSeq}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ModelEventTraceView,
): Partial<ModelEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ModelEventTraceView,
): Partial<ModelEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ModelEventTraceView,
): Partial<ModelEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function signedNumberField(
  payload: Record<string, unknown>,
  key: keyof ModelEventTraceView,
): Partial<ModelEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value)
    ? { [key]: value }
    : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ModelEventTraceView,
): Partial<ModelEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME.test(value) ? value : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,180}$/u.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
