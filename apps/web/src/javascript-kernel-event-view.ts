type ProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped"
  | "cancelled"
  | "interrupted";

export interface JavascriptKernelToolEventTraceView {
  javascriptKernelAction?: "start" | "evaluate" | "cancel";
  javascriptKernelProcessId?: string;
  javascriptKernelProcessStatus?: ProcessStatus;
  javascriptKernelEvaluationStatus?: "ok" | "error";
  javascriptKernelTerminal?: boolean;
  javascriptKernelValueType?: string;
  javascriptKernelPreviewTruncated?: boolean;
  javascriptKernelConsoleCount?: number;
  javascriptKernelConsoleTruncated?: boolean;
  javascriptKernelDurationMs?: number;
  javascriptKernelRequestSha256?: string;
  javascriptKernelWorkerSha256?: string;
  javascriptKernelResultSha256?: string;
}

export function javascriptKernelEventEvidence(
  value: unknown,
): JavascriptKernelToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = value["action"];
  const processId = value["processId"];
  const processStatus = value["processStatus"];
  if (
    value["kind"] !== "napier.javascript-kernel" ||
    value["schemaVersion"] !== 1 ||
    (action !== "start" && action !== "evaluate" && action !== "cancel") ||
    typeof processId !== "string" ||
    !/^process_[a-z0-9]{8,80}$/u.test(processId) ||
    !validProcessStatus(processStatus)
  ) {
    return undefined;
  }
  const workerSha256 = sha256(value["workerSha256"]);
  const resultSha256 = sha256(value["resultSha256"]);
  if (!workerSha256 || !resultSha256) return undefined;
  if (action !== "evaluate") {
    if (action === "start" && processStatus !== "running") {
      return undefined;
    }
    return {
      javascriptKernelAction: action,
      javascriptKernelProcessId: processId,
      javascriptKernelProcessStatus: processStatus,
      javascriptKernelWorkerSha256: workerSha256,
      javascriptKernelResultSha256: resultSha256,
    };
  }
  const evaluationStatus = value["evaluationStatus"];
  const terminal = value["terminal"];
  const valueType = value["valueType"];
  const consoleCount = integerInRange(value["consoleCount"], 0, 12);
  const durationMs = integerInRange(value["durationMs"], 0, 3_000);
  const requestSha256 = sha256(value["requestSha256"]);
  if (
    (evaluationStatus !== "ok" && evaluationStatus !== "error") ||
    typeof terminal !== "boolean" ||
    typeof valueType !== "string" ||
    valueType.length < 1 ||
    valueType.length > 32 ||
    typeof value["previewTruncated"] !== "boolean" ||
    consoleCount === undefined ||
    typeof value["consoleTruncated"] !== "boolean" ||
    durationMs === undefined ||
    !requestSha256 ||
    (terminal ? processStatus !== "cancelled" : processStatus !== "running") ||
    (evaluationStatus === "ok"
      ? terminal || valueType === "error"
      : valueType !== "error")
  ) {
    return undefined;
  }
  return {
    javascriptKernelAction: "evaluate",
    javascriptKernelProcessId: processId,
    javascriptKernelProcessStatus: processStatus,
    javascriptKernelEvaluationStatus: evaluationStatus,
    javascriptKernelTerminal: terminal,
    javascriptKernelValueType: valueType,
    ...(value["previewTruncated"]
      ? { javascriptKernelPreviewTruncated: true }
      : {}),
    javascriptKernelConsoleCount: consoleCount,
    ...(value["consoleTruncated"]
      ? { javascriptKernelConsoleTruncated: true }
      : {}),
    javascriptKernelDurationMs: durationMs,
    javascriptKernelRequestSha256: requestSha256,
    javascriptKernelWorkerSha256: workerSha256,
    javascriptKernelResultSha256: resultSha256,
  };
}

export function javascriptKernelSummaryParts(
  view: JavascriptKernelToolEventTraceView,
): string[] {
  return [
    ...(view.javascriptKernelAction
      ? [`javascript-kernel ${view.javascriptKernelAction}`]
      : []),
    ...(view.javascriptKernelProcessStatus
      ? [`kernel-process ${view.javascriptKernelProcessStatus}`]
      : []),
    ...(view.javascriptKernelEvaluationStatus
      ? [`kernel-result ${view.javascriptKernelEvaluationStatus}`]
      : []),
    ...(view.javascriptKernelValueType
      ? [`kernel-type ${view.javascriptKernelValueType}`]
      : []),
    ...(view.javascriptKernelTerminal ? ["kernel-terminal"] : []),
    ...(view.javascriptKernelPreviewTruncated
      ? ["kernel-preview-truncated"]
      : []),
    ...(view.javascriptKernelConsoleCount !== undefined
      ? [`kernel-console ${view.javascriptKernelConsoleCount}`]
      : []),
    ...(view.javascriptKernelConsoleTruncated
      ? ["kernel-console-truncated"]
      : []),
    ...(view.javascriptKernelDurationMs !== undefined
      ? [`kernel-ms ${view.javascriptKernelDurationMs}`]
      : []),
    ...hashSummary("kernel-request", view.javascriptKernelRequestSha256),
    ...hashSummary("kernel-worker", view.javascriptKernelWorkerSha256),
    ...hashSummary("kernel-result", view.javascriptKernelResultSha256),
  ];
}

function validProcessStatus(value: unknown): value is ProcessStatus {
  return (
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
