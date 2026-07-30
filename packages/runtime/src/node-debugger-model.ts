import type { WorkspaceProcessStatus } from "@napier/contracts";

import {
  MAX_NODE_DEBUG_BREAKPOINTS,
  MAX_NODE_DEBUG_EXPRESSION_CHARS,
} from "./node-debugger-worker.js";
import type { WorkspaceSourceFile } from "./workspace-source.js";

export const DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS = 120_000;
export const MIN_NODE_DEBUG_SESSION_TIMEOUT_MS = 10_000;
export const MAX_NODE_DEBUG_SESSION_TIMEOUT_MS = 120_000;
export const DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS = 5_000;
export const MAX_NODE_DEBUG_ACTION_TIMEOUT_MS = 10_000;

export type NodeDebugSessionState =
  | "starting"
  | "running"
  | "paused"
  | "terminated";

export interface NodeDebugBreakpoint {
  line: number;
  column?: number;
}

export interface NodeDebugStackFrame {
  id: number;
  name: string;
  path?: string;
  line: number;
  column: number;
}

export interface NodeDebugScope {
  name: string;
  variablesReference: number;
  presentationHint?: string;
}

export interface NodeDebugVariable {
  name: string;
  value: string;
  type: string;
  variablesReference: number;
}

export interface NodeDebugEvaluation {
  status: "ok" | "error";
  result: string;
  type: string;
  variablesReference: number;
}

export interface NodeDebuggerActionResult {
  action:
    | "launch"
    | "stack_trace"
    | "scopes"
    | "variables"
    | "evaluate"
    | "continue"
    | "next"
    | "step_in"
    | "step_out"
    | "cancel";
  processId: string;
  state: NodeDebugSessionState;
  processStatus: WorkspaceProcessStatus;
  reason?: string;
  exitCode?: number;
  sourcePath: string;
  sourcePathSha256: string;
  sourceSha256: string;
  sourceBytes: number;
  moduleCount: number;
  moduleSetSha256: string;
  breakpointCount: number;
  frames: NodeDebugStackFrame[];
  scopes: NodeDebugScope[];
  variables: NodeDebugVariable[];
  variablesTruncated: boolean;
  evaluation?: NodeDebugEvaluation;
  output: Array<{ category: "stdout" | "stderr" | "console"; text: string }>;
  outputTruncated: boolean;
  nodeVersion: string;
  workerSha256: string;
  runtimeExecutableSha256: string;
  runtimeCommandSha256: string;
  dapRequestSequenceSha256: string;
  dapResponseSequenceSha256: string;
  dapEventSequenceSha256: string;
  resultSha256: string;
}

export class NodeDebuggerRequestError extends Error {}

export function parseModuleSnapshot(
  body: Record<string, unknown> | undefined,
): { moduleCount: number; moduleSetSha256: string } {
  if (
    !record(body) ||
    !Number.isSafeInteger(body["moduleCount"]) ||
    Number(body["moduleCount"]) < 1 ||
    typeof body["moduleSetSha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body["moduleSetSha256"]) ||
    body["stable"] !== true
  ) {
    throw new Error("DAP module snapshot is invalid or stale");
  }
  return {
    moduleCount: Number(body["moduleCount"]),
    moduleSetSha256: body["moduleSetSha256"],
  };
}

export function validateInitializeResponse(
  body: Record<string, unknown> | undefined,
): void {
  if (
    !record(body) ||
    body["supportsConfigurationDoneRequest"] !== true ||
    body["supportsEvaluateForHovers"] !== true ||
    body["supportsSetVariable"] !== false ||
    body["supportsStepBack"] !== false
  ) {
    throw new Error("DAP initialize response is invalid");
  }
}

export function validateLaunchResponse(
  body: Record<string, unknown> | undefined,
  source: WorkspaceSourceFile,
): string {
  if (
    !record(body) ||
    body["sourceSha256"] !== source.fileSha256 ||
    body["sourcePath"] !== source.path ||
    typeof body["nodeVersion"] !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(body["nodeVersion"])
  ) {
    throw new Error("DAP launch response is invalid");
  }
  return body["nodeVersion"];
}

export function validateBreakpointResponse(
  body: Record<string, unknown> | undefined,
  requested: NodeDebugBreakpoint[],
): void {
  if (!record(body) || !Array.isArray(body["breakpoints"])) {
    throw new Error("DAP breakpoint response is invalid");
  }
  if (
    body["breakpoints"].length !== requested.length ||
    body["breakpoints"].some((value, index) => {
      const breakpoint = record(value) ? value : undefined;
      return (
        !breakpoint ||
        breakpoint["verified"] !== true ||
        breakpoint["line"] !== requested[index]?.line
      );
    })
  ) {
    throw new Error("DAP breakpoint response does not match the request");
  }
}

export function parseStackFrames(
  body: Record<string, unknown> | undefined,
): NodeDebugStackFrame[] {
  if (!record(body) || !Array.isArray(body["stackFrames"])) {
    throw new NodeDebuggerRequestError("DAP stack response is invalid");
  }
  return body["stackFrames"].map((value) => {
    if (!record(value)) {
      throw new NodeDebuggerRequestError("DAP stack frame is invalid");
    }
    const id = positiveInteger(value["id"]);
    const name = boundedString(value["name"], 120);
    const line = positiveInteger(value["line"]);
    const column = positiveInteger(value["column"]);
    const source = record(value["source"]) ? value["source"] : undefined;
    const sourcePath =
      source?.["path"] === undefined
        ? undefined
        : boundedString(source["path"], 500);
    if (!id || !name || !line || !column) {
      throw new NodeDebuggerRequestError("DAP stack frame is invalid");
    }
    return {
      id,
      name,
      ...(sourcePath ? { path: sourcePath } : {}),
      line,
      column,
    };
  });
}

export function parseScopes(
  body: Record<string, unknown> | undefined,
): NodeDebugScope[] {
  if (!record(body) || !Array.isArray(body["scopes"])) {
    throw new NodeDebuggerRequestError("DAP scopes response is invalid");
  }
  return body["scopes"].map((value) => {
    if (!record(value)) {
      throw new NodeDebuggerRequestError("DAP scope is invalid");
    }
    const name = boundedString(value["name"], 80);
    const variablesReference = positiveInteger(value["variablesReference"]);
    const presentationHint =
      value["presentationHint"] === undefined
        ? undefined
        : boundedString(value["presentationHint"], 40);
    if (!name || !variablesReference) {
      throw new NodeDebuggerRequestError("DAP scope is invalid");
    }
    return {
      name,
      variablesReference,
      ...(presentationHint ? { presentationHint } : {}),
    };
  });
}

export function parseVariables(
  body: Record<string, unknown> | undefined,
): Pick<NodeDebuggerActionResult, "variables" | "variablesTruncated"> {
  if (
    !record(body) ||
    !Array.isArray(body["variables"]) ||
    typeof body["truncated"] !== "boolean"
  ) {
    throw new NodeDebuggerRequestError("DAP variables response is invalid");
  }
  const variables = body["variables"].map((value) => {
    if (!record(value)) {
      throw new NodeDebuggerRequestError("DAP variable is invalid");
    }
    const name = boundedString(value["name"], 200);
    const rendered = boundedString(value["value"], 256);
    const type = boundedString(value["type"], 40);
    const variablesReference = nonNegativeInteger(value["variablesReference"]);
    if (
      !name ||
      rendered === undefined ||
      !type ||
      variablesReference === undefined
    ) {
      throw new NodeDebuggerRequestError("DAP variable is invalid");
    }
    return { name, value: rendered, type, variablesReference };
  });
  return {
    variables,
    variablesTruncated: body["truncated"],
  };
}

export function parseEvaluation(
  body: Record<string, unknown> | undefined,
): NodeDebugEvaluation {
  if (!record(body)) {
    throw new NodeDebuggerRequestError("DAP evaluation response is invalid");
  }
  const result = boundedString(body["result"], 256);
  const type = boundedString(body["type"], 40);
  const variablesReference = nonNegativeInteger(body["variablesReference"]);
  if (result === undefined || !type || variablesReference === undefined) {
    throw new NodeDebuggerRequestError("DAP evaluation response is invalid");
  }
  return {
    status: "ok",
    result,
    type,
    variablesReference,
  };
}

export function validateSessionTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_NODE_DEBUG_SESSION_TIMEOUT_MS ||
    value > MAX_NODE_DEBUG_SESSION_TIMEOUT_MS
  ) {
    throw new Error(
      `Node debugger sessionTimeoutMs must be ${MIN_NODE_DEBUG_SESSION_TIMEOUT_MS}-${MAX_NODE_DEBUG_SESSION_TIMEOUT_MS}`,
    );
  }
}

export function validateActionTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_NODE_DEBUG_ACTION_TIMEOUT_MS
  ) {
    throw new Error(
      `Node debugger timeoutMs must be 1-${MAX_NODE_DEBUG_ACTION_TIMEOUT_MS}`,
    );
  }
}

export function validateBreakpoints(values: NodeDebugBreakpoint[]): void {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_NODE_DEBUG_BREAKPOINTS ||
    values.some(
      (value) =>
        !record(value) ||
        !positiveInteger(value.line) ||
        (value.column !== undefined && !positiveInteger(value.column)),
    )
  ) {
    throw new Error("Node debugger breakpoints are invalid");
  }
  const keys = values.map(
    (breakpoint) => `${breakpoint.line}:${breakpoint.column ?? 1}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Node debugger breakpoints must be unique");
  }
}

export function validateBreakpointLines(
  breakpoints: NodeDebugBreakpoint[],
  source: string,
): void {
  const lineCount = source.split("\n").length;
  if (breakpoints.some((breakpoint) => breakpoint.line > lineCount)) {
    throw new Error("Node debugger breakpoint exceeds the source line count");
  }
}

export function validateArguments(values: string[]): void {
  if (
    !Array.isArray(values) ||
    values.length > 16 ||
    values.some(
      (value) =>
        typeof value !== "string" ||
        value.length > 500 ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  ) {
    throw new Error("Node debugger program arguments are invalid");
  }
}

export function validateExpression(value: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_NODE_DEBUG_EXPRESSION_CHARS ||
    Buffer.from(value, "utf8").toString("utf8") !== value ||
    /[\u0000\u007f]/u.test(value)
  ) {
    throw new Error("Node debugger expression is invalid");
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length <= maximum
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Number(value)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
