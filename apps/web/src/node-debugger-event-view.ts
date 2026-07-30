type ProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped"
  | "cancelled"
  | "interrupted";

type DebugState = "starting" | "running" | "paused" | "terminated";

export interface NodeDebuggerToolEventTraceView {
  nodeDebuggerAction?: string;
  nodeDebuggerState?: DebugState;
  nodeDebuggerProcessStatus?: ProcessStatus;
  nodeDebuggerReason?: string;
  nodeDebuggerExitCode?: number;
  nodeDebuggerSourceBytes?: number;
  nodeDebuggerModuleCount?: number;
  nodeDebuggerBreakpointCount?: number;
  nodeDebuggerFrameCount?: number;
  nodeDebuggerScopeCount?: number;
  nodeDebuggerVariableCount?: number;
  nodeDebuggerVariablesTruncated?: boolean;
  nodeDebuggerEvaluationStatus?: "ok" | "error";
  nodeDebuggerEvaluationType?: string;
  nodeDebuggerOutputCount?: number;
  nodeDebuggerOutputTruncated?: boolean;
  nodeDebuggerNodeVersion?: string;
  nodeDebuggerSourcePathSha256?: string;
  nodeDebuggerSourceSha256?: string;
  nodeDebuggerModuleSetSha256?: string;
  nodeDebuggerWorkerSha256?: string;
  nodeDebuggerRuntimeExecutableSha256?: string;
  nodeDebuggerRuntimeCommandSha256?: string;
  nodeDebuggerDapRequestSha256?: string;
  nodeDebuggerDapResponseSha256?: string;
  nodeDebuggerDapEventSha256?: string;
  nodeDebuggerResultSha256?: string;
}

const ACTIONS = new Set([
  "launch",
  "stack_trace",
  "scopes",
  "variables",
  "evaluate",
  "continue",
  "next",
  "step_in",
  "step_out",
  "cancel",
]);

export function nodeDebuggerEventEvidence(
  value: unknown,
): NodeDebuggerToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = value["action"];
  const state = value["state"];
  const processStatus = value["processStatus"];
  if (
    value["kind"] !== "napier.node-debugger" ||
    value["schemaVersion"] !== 1 ||
    typeof action !== "string" ||
    !ACTIONS.has(action) ||
    !debugState(state) ||
    !validProcessStatus(processStatus)
  ) {
    return undefined;
  }
  const sourceBytes = integerInRange(value["sourceBytes"], 0, 1024 * 1024);
  const moduleCount = integerInRange(value["moduleCount"], 1, 256);
  const breakpointCount = integerInRange(value["breakpointCount"], 1, 16);
  const frameCount = integerInRange(value["frameCount"], 0, 32);
  const scopeCount = integerInRange(value["scopeCount"], 0, 8);
  const variableCount = integerInRange(value["variableCount"], 0, 32);
  const outputCount = integerInRange(value["outputCount"], 0, 16);
  const nodeVersion = version(value["nodeVersion"]);
  const hashes = [
    "sourcePathSha256",
    "sourceSha256",
    "moduleSetSha256",
    "workerSha256",
    "runtimeExecutableSha256",
    "runtimeCommandSha256",
    "dapRequestSequenceSha256",
    "dapResponseSequenceSha256",
    "dapEventSequenceSha256",
    "resultSha256",
  ].map((key) => sha256(value[key]));
  if (
    sourceBytes === undefined ||
    moduleCount === undefined ||
    breakpointCount === undefined ||
    frameCount === undefined ||
    scopeCount === undefined ||
    variableCount === undefined ||
    typeof value["variablesTruncated"] !== "boolean" ||
    outputCount === undefined ||
    typeof value["outputTruncated"] !== "boolean" ||
    !nodeVersion ||
    hashes.some((hash) => !hash) ||
    (value["reason"] !== undefined &&
      (typeof value["reason"] !== "string" ||
        !["breakpoint", "exception", "pause", "step"].includes(
          value["reason"],
        ))) ||
    (value["exitCode"] !== undefined &&
      !Number.isSafeInteger(value["exitCode"])) ||
    (value["evaluationStatus"] !== undefined &&
      value["evaluationStatus"] !== "ok" &&
      value["evaluationStatus"] !== "error") ||
    (value["evaluationType"] !== undefined &&
      (typeof value["evaluationType"] !== "string" ||
        value["evaluationType"].length > 40))
  ) {
    return undefined;
  }
  return {
    nodeDebuggerAction: action,
    nodeDebuggerState: state,
    nodeDebuggerProcessStatus: processStatus,
    ...(typeof value["reason"] === "string"
      ? { nodeDebuggerReason: value["reason"] }
      : {}),
    ...(typeof value["exitCode"] === "number"
      ? { nodeDebuggerExitCode: value["exitCode"] }
      : {}),
    nodeDebuggerSourceBytes: sourceBytes,
    nodeDebuggerModuleCount: moduleCount,
    nodeDebuggerBreakpointCount: breakpointCount,
    nodeDebuggerFrameCount: frameCount,
    nodeDebuggerScopeCount: scopeCount,
    nodeDebuggerVariableCount: variableCount,
    ...(value["variablesTruncated"]
      ? { nodeDebuggerVariablesTruncated: true }
      : {}),
    ...(value["evaluationStatus"] === "ok" ||
    value["evaluationStatus"] === "error"
      ? { nodeDebuggerEvaluationStatus: value["evaluationStatus"] }
      : {}),
    ...(typeof value["evaluationType"] === "string"
      ? { nodeDebuggerEvaluationType: value["evaluationType"] }
      : {}),
    nodeDebuggerOutputCount: outputCount,
    ...(value["outputTruncated"] ? { nodeDebuggerOutputTruncated: true } : {}),
    nodeDebuggerNodeVersion: nodeVersion,
    nodeDebuggerSourcePathSha256: hashes[0]!,
    nodeDebuggerSourceSha256: hashes[1]!,
    nodeDebuggerModuleSetSha256: hashes[2]!,
    nodeDebuggerWorkerSha256: hashes[3]!,
    nodeDebuggerRuntimeExecutableSha256: hashes[4]!,
    nodeDebuggerRuntimeCommandSha256: hashes[5]!,
    nodeDebuggerDapRequestSha256: hashes[6]!,
    nodeDebuggerDapResponseSha256: hashes[7]!,
    nodeDebuggerDapEventSha256: hashes[8]!,
    nodeDebuggerResultSha256: hashes[9]!,
  };
}

export function nodeDebuggerSummaryParts(
  view: NodeDebuggerToolEventTraceView,
): string[] {
  return [
    ...(view.nodeDebuggerAction
      ? [`node-debugger ${view.nodeDebuggerAction}`]
      : []),
    ...(view.nodeDebuggerState ? [`debug ${view.nodeDebuggerState}`] : []),
    ...(view.nodeDebuggerReason ? [`stop ${view.nodeDebuggerReason}`] : []),
    ...(view.nodeDebuggerExitCode !== undefined
      ? [`target-exit ${view.nodeDebuggerExitCode}`]
      : []),
    ...(view.nodeDebuggerFrameCount !== undefined
      ? [`frames ${view.nodeDebuggerFrameCount}`]
      : []),
    ...(view.nodeDebuggerScopeCount !== undefined
      ? [`scopes ${view.nodeDebuggerScopeCount}`]
      : []),
    ...(view.nodeDebuggerVariableCount !== undefined
      ? [`variables ${view.nodeDebuggerVariableCount}`]
      : []),
    ...(view.nodeDebuggerEvaluationStatus
      ? [`eval ${view.nodeDebuggerEvaluationStatus}`]
      : []),
    ...(view.nodeDebuggerOutputCount !== undefined
      ? [`target-output ${view.nodeDebuggerOutputCount}`]
      : []),
    ...(view.nodeDebuggerModuleCount !== undefined
      ? [`modules ${view.nodeDebuggerModuleCount}`]
      : []),
    ...(view.nodeDebuggerNodeVersion
      ? [`node ${view.nodeDebuggerNodeVersion}`]
      : []),
    ...(view.nodeDebuggerVariablesTruncated ? ["variables-truncated"] : []),
    ...(view.nodeDebuggerOutputTruncated ? ["output-truncated"] : []),
    ...hashSummary("debug-source", view.nodeDebuggerSourceSha256),
    ...hashSummary("debug-modules", view.nodeDebuggerModuleSetSha256),
    ...hashSummary("dap-request", view.nodeDebuggerDapRequestSha256),
    ...hashSummary("dap-response", view.nodeDebuggerDapResponseSha256),
    ...hashSummary("dap-events", view.nodeDebuggerDapEventSha256),
    ...hashSummary("debug-result", view.nodeDebuggerResultSha256),
  ];
}

function debugState(value: unknown): value is DebugState {
  return (
    value === "starting" ||
    value === "running" ||
    value === "paused" ||
    value === "terminated"
  );
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
