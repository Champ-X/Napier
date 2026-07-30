type ProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped"
  | "cancelled"
  | "interrupted";

export interface PythonKernelToolEventTraceView {
  pythonKernelAction?: "start" | "evaluate" | "cancel";
  pythonKernelProcessId?: string;
  pythonKernelProcessStatus?: ProcessStatus;
  pythonKernelEvaluationStatus?: "ok" | "error";
  pythonKernelTerminal?: boolean;
  pythonKernelValueType?: string;
  pythonKernelPreviewTruncated?: boolean;
  pythonKernelConsoleCount?: number;
  pythonKernelConsoleTruncated?: boolean;
  pythonKernelDurationMs?: number;
  pythonKernelVersion?: string;
  pythonKernelMemoryPeakBytes?: number;
  pythonKernelMemoryLimitBytes?: number;
  pythonKernelRequestSha256?: string;
  pythonKernelWorkerSha256?: string;
  pythonKernelRuntimeExecutableSha256?: string;
  pythonKernelRuntimeCommandSha256?: string;
  pythonKernelResultSha256?: string;
}

export function pythonKernelEventEvidence(
  value: unknown,
): PythonKernelToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = value["action"];
  const processId = value["processId"];
  const processStatus = value["processStatus"];
  if (
    value["kind"] !== "napier.python-kernel" ||
    value["schemaVersion"] !== 1 ||
    (action !== "start" && action !== "evaluate" && action !== "cancel") ||
    typeof processId !== "string" ||
    !/^process_[a-z0-9]{8,80}$/u.test(processId) ||
    !validProcessStatus(processStatus)
  ) {
    return undefined;
  }
  const workerSha256 = sha256(value["workerSha256"]);
  const runtimeExecutableSha256 = sha256(value["runtimeExecutableSha256"]);
  const runtimeCommandSha256 = sha256(value["runtimeCommandSha256"]);
  const resultSha256 = sha256(value["resultSha256"]);
  if (
    !workerSha256 ||
    !runtimeExecutableSha256 ||
    !runtimeCommandSha256 ||
    !resultSha256
  ) {
    return undefined;
  }
  if (action !== "evaluate") {
    if (action === "start" && processStatus !== "running") return undefined;
    return {
      pythonKernelAction: action,
      pythonKernelProcessId: processId,
      pythonKernelProcessStatus: processStatus,
      pythonKernelWorkerSha256: workerSha256,
      pythonKernelRuntimeExecutableSha256: runtimeExecutableSha256,
      pythonKernelRuntimeCommandSha256: runtimeCommandSha256,
      pythonKernelResultSha256: resultSha256,
    };
  }
  const evaluationStatus = value["evaluationStatus"];
  const terminal = value["terminal"];
  const valueType = value["valueType"];
  const consoleCount = integerInRange(value["consoleCount"], 0, 12);
  const durationMs = integerInRange(value["durationMs"], 0, 3_000);
  const pythonVersion = version(value["pythonVersion"]);
  const memoryPeakBytes = integerInRange(
    value["memoryPeakBytes"],
    0,
    512 * 1024 * 1024,
  );
  const memoryLimitBytes = integerInRange(
    value["memoryLimitBytes"],
    1,
    512 * 1024 * 1024,
  );
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
    !pythonVersion ||
    memoryPeakBytes === undefined ||
    memoryLimitBytes === undefined ||
    !requestSha256 ||
    (terminal ? processStatus !== "cancelled" : processStatus !== "running") ||
    (evaluationStatus === "ok"
      ? terminal || valueType === "error"
      : valueType !== "error")
  ) {
    return undefined;
  }
  return {
    pythonKernelAction: "evaluate",
    pythonKernelProcessId: processId,
    pythonKernelProcessStatus: processStatus,
    pythonKernelEvaluationStatus: evaluationStatus,
    pythonKernelTerminal: terminal,
    pythonKernelValueType: valueType,
    ...(value["previewTruncated"]
      ? { pythonKernelPreviewTruncated: true }
      : {}),
    pythonKernelConsoleCount: consoleCount,
    ...(value["consoleTruncated"]
      ? { pythonKernelConsoleTruncated: true }
      : {}),
    pythonKernelDurationMs: durationMs,
    pythonKernelVersion: pythonVersion,
    pythonKernelMemoryPeakBytes: memoryPeakBytes,
    pythonKernelMemoryLimitBytes: memoryLimitBytes,
    pythonKernelRequestSha256: requestSha256,
    pythonKernelWorkerSha256: workerSha256,
    pythonKernelRuntimeExecutableSha256: runtimeExecutableSha256,
    pythonKernelRuntimeCommandSha256: runtimeCommandSha256,
    pythonKernelResultSha256: resultSha256,
  };
}

export function pythonKernelSummaryParts(
  view: PythonKernelToolEventTraceView,
): string[] {
  return [
    ...(view.pythonKernelAction
      ? [`python-kernel ${view.pythonKernelAction}`]
      : []),
    ...(view.pythonKernelProcessStatus
      ? [`py-process ${view.pythonKernelProcessStatus}`]
      : []),
    ...(view.pythonKernelEvaluationStatus
      ? [`py-result ${view.pythonKernelEvaluationStatus}`]
      : []),
    ...(view.pythonKernelValueType
      ? [`py-type ${view.pythonKernelValueType}`]
      : []),
    ...(view.pythonKernelTerminal ? ["py-terminal"] : []),
    ...(view.pythonKernelPreviewTruncated ? ["py-preview-truncated"] : []),
    ...(view.pythonKernelConsoleCount !== undefined
      ? [`py-console ${view.pythonKernelConsoleCount}`]
      : []),
    ...(view.pythonKernelConsoleTruncated ? ["py-console-truncated"] : []),
    ...(view.pythonKernelDurationMs !== undefined
      ? [`py-ms ${view.pythonKernelDurationMs}`]
      : []),
    ...(view.pythonKernelVersion ? [`python ${view.pythonKernelVersion}`] : []),
    ...(view.pythonKernelMemoryPeakBytes !== undefined &&
    view.pythonKernelMemoryLimitBytes !== undefined
      ? [
          `py-memory ${view.pythonKernelMemoryPeakBytes}/${view.pythonKernelMemoryLimitBytes}`,
        ]
      : []),
    ...hashSummary("py-request", view.pythonKernelRequestSha256),
    ...hashSummary("py-worker", view.pythonKernelWorkerSha256),
    ...hashSummary("py-runtime", view.pythonKernelRuntimeExecutableSha256),
    ...hashSummary("py-command", view.pythonKernelRuntimeCommandSha256),
    ...hashSummary("py-result-hash", view.pythonKernelResultSha256),
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

function version(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/u.test(value)
    ? value
    : undefined;
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
