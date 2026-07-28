import type { RunEvent } from "@napier/contracts";

export interface OperatorDecisionTraceView {
  action: string;
  decisionId: string;
  optionCount?: number;
  selectedCount?: number;
  multiSelect?: boolean;
  reason?: string;
  questionSha256?: string;
  requestSha256?: string;
  answerSha256?: string;
  contentSha256?: string;
  continuationRunId?: string;
}

export interface RunControlTraceView {
  action: string;
  controlMessageId: string;
  mode?: string;
  textSha256?: string;
  textBytes?: number;
  requestSha256?: string;
  contentSha256?: string;
  reason?: string;
  queuedEventSeq?: number;
  messageEventSeq?: number;
}

const OPERATOR_DECISION_EVENT =
  /^operator\.decision\.(requested|answered|continued|cancelled)$/u;
const RUN_CONTROL_EVENT = /^run\.control\.(queued|delivered|cancelled)$/u;
const DECISION_ID = /^decision_[a-z0-9]{8,80}$/u;
const CONTROL_ID = /^control_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9]{8,80}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OPERATOR_RECEIPT_SUMMARY = "operator decision receipt";
const RUN_CONTROL_RECEIPT_SUMMARY = "run control receipt";

export function operatorDecisionTraceView(
  event: RunEvent,
): OperatorDecisionTraceView | undefined {
  if (!OPERATOR_DECISION_EVENT.test(event.type)) return undefined;
  const payload = recordPayload(event);
  if (!payload) return undefined;
  const decisionId = decisionIdValue(payload["decisionId"]);
  if (!decisionId) return undefined;
  const optionCount = Array.isArray(payload["options"])
    ? payload["options"].length
    : undefined;
  const selectedCount = Array.isArray(payload["selectedOptionIds"])
    ? payload["selectedOptionIds"].length
    : undefined;
  const multiSelect =
    typeof payload["multiSelect"] === "boolean"
      ? payload["multiSelect"]
      : undefined;
  const reason = safeToken(payload["reason"]);
  const questionSha256 = sha256(payload["questionSha256"]);
  const requestSha256 = sha256(payload["requestSha256"]);
  const answerSha256 = sha256(payload["answerSha256"]);
  const contentSha256 = sha256(payload["contentSha256"]);
  const continuationRunId = runIdValue(payload["continuationRunId"]);
  return {
    action: event.type.slice("operator.decision.".length),
    decisionId,
    ...(optionCount !== undefined ? { optionCount } : {}),
    ...(selectedCount !== undefined ? { selectedCount } : {}),
    ...(multiSelect !== undefined ? { multiSelect } : {}),
    ...(reason ? { reason } : {}),
    ...(questionSha256 ? { questionSha256 } : {}),
    ...(requestSha256 ? { requestSha256 } : {}),
    ...(answerSha256 ? { answerSha256 } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(continuationRunId ? { continuationRunId } : {}),
  };
}

export function runControlTraceView(
  event: RunEvent,
): RunControlTraceView | undefined {
  if (!RUN_CONTROL_EVENT.test(event.type)) return undefined;
  const payload = recordPayload(event);
  if (!payload) return undefined;
  const controlMessageId = controlIdValue(payload["controlMessageId"]);
  if (!controlMessageId) return undefined;
  const mode = safeToken(payload["mode"]);
  const textSha256 = sha256(payload["textSha256"]);
  const requestSha256 = sha256(payload["requestSha256"]);
  const contentSha256 = sha256(payload["contentSha256"]);
  const reason = safeToken(payload["reason"]);
  const textBytes = nonNegativeInteger(payload["textBytes"]);
  const queuedEventSeq = nonNegativeInteger(payload["queuedEventSeq"]);
  const messageEventSeq = nonNegativeInteger(payload["messageEventSeq"]);
  return {
    action: event.type.slice("run.control.".length),
    controlMessageId,
    ...(mode ? { mode } : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(textBytes !== undefined ? { textBytes } : {}),
    ...(requestSha256 ? { requestSha256 } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(reason ? { reason } : {}),
    ...(queuedEventSeq !== undefined ? { queuedEventSeq } : {}),
    ...(messageEventSeq !== undefined ? { messageEventSeq } : {}),
  };
}

export function operatorDecisionTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!OPERATOR_DECISION_EVENT.test(event.type)) return undefined;
  const view = operatorDecisionTraceView(event);
  if (!view) return OPERATOR_RECEIPT_SUMMARY;
  return [
    `operator / ${view.action}`,
    `id ${view.decisionId.slice(-10)}`,
    ...(view.optionCount !== undefined ? [`options ${view.optionCount}`] : []),
    ...(view.selectedCount !== undefined
      ? [`selected ${view.selectedCount}`]
      : []),
    ...(view.multiSelect !== undefined ? [`multi ${view.multiSelect}`] : []),
    ...(view.reason ? [`reason ${view.reason}`] : []),
    ...(view.questionSha256
      ? [`question ${view.questionSha256.slice(0, 12)}`]
      : []),
    ...(view.requestSha256
      ? [`request ${view.requestSha256.slice(0, 12)}`]
      : []),
    ...(view.answerSha256 ? [`answer ${view.answerSha256.slice(0, 12)}`] : []),
    ...(view.contentSha256
      ? [`receipt ${view.contentSha256.slice(0, 12)}`]
      : []),
    ...(view.continuationRunId
      ? [`run ${view.continuationRunId.slice(-10)}`]
      : []),
  ].join(" / ");
}

export function runControlTraceSummary(event: RunEvent): string | undefined {
  if (!RUN_CONTROL_EVENT.test(event.type)) return undefined;
  const view = runControlTraceView(event);
  if (!view) return RUN_CONTROL_RECEIPT_SUMMARY;
  return [
    `control / ${view.action}`,
    `id ${view.controlMessageId.slice(-10)}`,
    ...(view.mode ? [`mode ${view.mode}`] : []),
    ...(view.textSha256 ? [`text ${view.textSha256.slice(0, 12)}`] : []),
    ...(view.textBytes !== undefined ? [`bytes ${view.textBytes}`] : []),
    ...(view.requestSha256
      ? [`request ${view.requestSha256.slice(0, 12)}`]
      : []),
    ...(view.contentSha256
      ? [`receipt ${view.contentSha256.slice(0, 12)}`]
      : []),
    ...(view.reason ? [`reason ${view.reason}`] : []),
    ...(view.queuedEventSeq !== undefined ? [`queued ${view.queuedEventSeq}`] : []),
    ...(view.messageEventSeq !== undefined
      ? [`message ${view.messageEventSeq}`]
      : []),
  ].join(" / ");
}

function recordPayload(
  event: RunEvent,
): Record<string, unknown> | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
    ? event.payload
    : undefined;
}

function decisionIdValue(value: unknown): string | undefined {
  return typeof value === "string" && DECISION_ID.test(value)
    ? value
    : undefined;
}

function controlIdValue(value: unknown): string | undefined {
  return typeof value === "string" && CONTROL_ID.test(value)
    ? value
    : undefined;
}

function runIdValue(value: unknown): string | undefined {
  return typeof value === "string" && RUN_ID.test(value) ? value : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
