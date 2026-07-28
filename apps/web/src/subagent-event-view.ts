import type { RunEvent } from "@napier/contracts";

export interface SubagentEventTraceView {
  action: string;
  taskId?: string;
  role?: string;
  status?: string;
  kind?: string;
  stopReason?: string;
  messageIndex?: number;
  attempt?: number;
  turnCount?: number;
  stepCount?: number;
  toolCallCount?: number;
  itemCount?: number;
  evidenceCount?: number;
  unknownCount?: number;
  textSha256?: string;
  resultSha256?: string;
  diagnosticSha256?: string;
  outcomeSha256?: string;
  itemSetSha256?: string;
  evidenceSetSha256?: string;
  requestSha256?: string;
  contentSha256?: string;
}

const SUBAGENT_EVENT_PATTERN =
  /^subagent\.(queued|started|step|completed|failed|cancelled|timed_out|outcome\.(repair\.(requested|outcome)|accepted|rejected))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/u;
const TASK_ID = /^task_[a-z0-9]{8,80}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SUBAGENT_RECEIPT_SUMMARY = "subagent receipt";

export function subagentEventTraceView(
  event: RunEvent,
): SubagentEventTraceView | undefined {
  if (!SUBAGENT_EVENT_PATTERN.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const taskId = taskIdValue(event.payload["taskId"]);
  const role = safeToken(event.payload["role"]);
  const status = safeToken(event.payload["status"]);
  const kind = safeToken(event.payload["kind"]);
  const stopReason = safeToken(event.payload["stopReason"]);
  const messageIndex = nonNegativeInteger(event.payload["messageIndex"]);
  const attempt = nonNegativeInteger(event.payload["attempt"]);
  const turnCount = nonNegativeInteger(event.payload["turnCount"]);
  const stepCount = nonNegativeInteger(event.payload["stepCount"]);
  const toolCallCount = Array.isArray(event.payload["toolCalls"])
    ? event.payload["toolCalls"].length
    : nonNegativeInteger(event.payload["toolCallCount"]);
  const itemCount = nonNegativeInteger(event.payload["itemCount"]);
  const evidenceCount = nonNegativeInteger(event.payload["evidenceCount"]);
  const unknownCount = nonNegativeInteger(event.payload["unknownCount"]);
  const outcome = record(event.payload["outcome"]) ? event.payload["outcome"] : {};
  const textSha256 = sha256(event.payload["textSha256"]);
  const resultSha256 = sha256(event.payload["resultSha256"]);
  const diagnosticSha256 = sha256(event.payload["diagnosticSha256"]);
  const outcomeSha256 =
    sha256(event.payload["outcomeSha256"]) ?? sha256(outcome["contentSha256"]);
  const itemSetSha256 =
    sha256(event.payload["itemSetSha256"]) ?? sha256(outcome["itemSetSha256"]);
  const evidenceSetSha256 =
    sha256(event.payload["evidenceSetSha256"]) ??
    sha256(outcome["evidenceSetSha256"]);
  const requestSha256 = sha256(event.payload["requestSha256"]);
  const contentSha256 = sha256(event.payload["contentSha256"]);
  const outcomeItemCount = itemCount ?? nonNegativeInteger(outcome["itemCount"]);
  const outcomeEvidenceCount =
    evidenceCount ?? nonNegativeInteger(outcome["evidenceCount"]);
  const outcomeUnknownCount =
    unknownCount ?? nonNegativeInteger(outcome["unknownCount"]);
  return {
    action: event.type.slice("subagent.".length),
    ...(taskId ? { taskId } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(messageIndex !== undefined ? { messageIndex } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(turnCount !== undefined ? { turnCount } : {}),
    ...(stepCount !== undefined ? { stepCount } : {}),
    ...(toolCallCount !== undefined ? { toolCallCount } : {}),
    ...(outcomeItemCount !== undefined ? { itemCount: outcomeItemCount } : {}),
    ...(outcomeEvidenceCount !== undefined
      ? { evidenceCount: outcomeEvidenceCount }
      : {}),
    ...(outcomeUnknownCount !== undefined
      ? { unknownCount: outcomeUnknownCount }
      : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(resultSha256 ? { resultSha256 } : {}),
    ...(diagnosticSha256 ? { diagnosticSha256 } : {}),
    ...(outcomeSha256 ? { outcomeSha256 } : {}),
    ...(itemSetSha256 ? { itemSetSha256 } : {}),
    ...(evidenceSetSha256 ? { evidenceSetSha256 } : {}),
    ...(requestSha256 ? { requestSha256 } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
  };
}

export function subagentEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!SUBAGENT_EVENT_PATTERN.test(event.type)) return undefined;
  const view = subagentEventTraceView(event);
  if (!view) return SUBAGENT_RECEIPT_SUMMARY;
  return [
    `subagent / ${view.action}`,
    ...(view.taskId ? [`id ${view.taskId.slice(-10)}`] : []),
    ...(view.role ? [`role ${view.role}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.kind ? [`kind ${view.kind}`] : []),
    ...(view.stopReason ? [`stop ${view.stopReason}`] : []),
    ...(view.messageIndex !== undefined ? [`message ${view.messageIndex}`] : []),
    ...(view.attempt !== undefined ? [`attempt ${view.attempt}`] : []),
    ...(view.turnCount !== undefined ? [`turns ${view.turnCount}`] : []),
    ...(view.stepCount !== undefined ? [`steps ${view.stepCount}`] : []),
    ...(view.toolCallCount !== undefined ? [`tools ${view.toolCallCount}`] : []),
    ...(view.itemCount !== undefined ? [`items ${view.itemCount}`] : []),
    ...(view.evidenceCount !== undefined
      ? [`evidence ${view.evidenceCount}`]
      : []),
    ...(view.unknownCount !== undefined ? [`unknown ${view.unknownCount}`] : []),
    ...(view.textSha256 ? [`text ${view.textSha256.slice(0, 12)}`] : []),
    ...(view.resultSha256 ? [`result ${view.resultSha256.slice(0, 12)}`] : []),
    ...(view.diagnosticSha256
      ? [`diagnostic ${view.diagnosticSha256.slice(0, 12)}`]
      : []),
    ...(view.outcomeSha256
      ? [`outcome ${view.outcomeSha256.slice(0, 12)}`]
      : []),
    ...(view.itemSetSha256 ? [`items ${view.itemSetSha256.slice(0, 12)}`] : []),
    ...(view.evidenceSetSha256
      ? [`evidence ${view.evidenceSetSha256.slice(0, 12)}`]
      : []),
    ...(view.requestSha256
      ? [`request ${view.requestSha256.slice(0, 12)}`]
      : []),
    ...(view.contentSha256
      ? [`receipt ${view.contentSha256.slice(0, 12)}`]
      : []),
  ].join(" / ");
}

function taskIdValue(value: unknown): string | undefined {
  return typeof value === "string" && TASK_ID.test(value) ? value : undefined;
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
