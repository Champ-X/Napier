export interface ToolResultReuseEventTraceView {
  sourceRunId?: string;
  sourceCallId?: string;
  targetCallId?: string;
  targetExecutionMode?: string;
  outputChanged?: boolean;
  durationMsDelta?: number;
  previewSha256?: string;
  comparisonSha256?: string;
  resultSha256?: string;
  resultCapsuleSha256?: string;
  sourceToolResultSetSha256?: string;
  resultReused?: boolean;
  resultError?: boolean;
}

const STATUS = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function toolResultReuseEventEvidence(
  payload: Record<string, unknown>,
): ToolResultReuseEventTraceView {
  return {
    ...statusField(payload, "sourceRunId"),
    ...statusField(payload, "sourceCallId"),
    ...statusField(payload, "targetCallId"),
    ...statusField(payload, "targetExecutionMode"),
    ...(typeof payload["outputChanged"] === "boolean"
      ? { outputChanged: payload["outputChanged"] }
      : {}),
    ...integerField(payload, "durationMsDelta"),
    ...hashField(payload, "previewSha256"),
    ...hashField(payload, "comparisonSha256"),
    ...hashField(payload, "resultSha256"),
    ...hashField(payload, "resultCapsuleSha256"),
    ...hashField(payload, "sourceToolResultSetSha256"),
    ...(payload["resultReused"] === true ? { resultReused: true } : {}),
    ...(typeof payload["isError"] === "boolean"
      ? { resultError: payload["isError"] }
      : {}),
  };
}

export function toolResultReuseSummaryParts(
  view: ToolResultReuseEventTraceView,
): string[] {
  return [
    ...(view.sourceRunId ? [`source ${view.sourceRunId.slice(-10)}`] : []),
    ...(view.sourceCallId ? [`call ${view.sourceCallId.slice(-10)}`] : []),
    ...(view.targetCallId
      ? [`target-call ${view.targetCallId.slice(-10)}`]
      : []),
    ...(view.targetExecutionMode ? [`mode ${view.targetExecutionMode}`] : []),
    ...(view.outputChanged !== undefined
      ? [`output-changed ${view.outputChanged}`]
      : []),
    ...(view.durationMsDelta !== undefined
      ? [`duration-delta ${view.durationMsDelta}`]
      : []),
    ...hash("preview", view.previewSha256),
    ...hash("comparison", view.comparisonSha256),
    ...hash("result", view.resultSha256),
    ...hash("result-capsule", view.resultCapsuleSha256),
    ...hash("result-set", view.sourceToolResultSetSha256),
    ...(view.resultReused ? ["reused"] : []),
    ...(view.resultError !== undefined
      ? [`result-error ${view.resultError}`]
      : []),
  ];
}

function statusField(
  payload: Record<string, unknown>,
  key: keyof ToolResultReuseEventTraceView,
): Partial<ToolResultReuseEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && STATUS.test(value)
    ? { [key]: value }
    : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ToolResultReuseEventTraceView,
): Partial<ToolResultReuseEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? { [key]: value }
    : {};
}

function hashField(
  payload: Record<string, unknown>,
  key: keyof ToolResultReuseEventTraceView,
): Partial<ToolResultReuseEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && SHA256.test(value)
    ? { [key]: value }
    : {};
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
