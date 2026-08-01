import type { WorkspaceProcessStatus } from "@napier/contracts";

import type { NodeDebuggerActionResult } from "./node-debugger.js";

export const MAX_NODE_DEBUGGER_TOOL_OUTPUT_BYTES = 32 * 1024;

export interface NodeDebuggerToolDetails {
  kind: "napier.node-debugger";
  schemaVersion: 2;
  action: NodeDebuggerActionResult["action"];
  processId: string;
  state: NodeDebuggerActionResult["state"];
  processStatus: WorkspaceProcessStatus;
  reason?: string;
  exitCode?: number;
  sourcePathSha256: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceMapMode: "none" | "external";
  programPathSha256: string;
  programSha256: string;
  programBytes: number;
  sourceMapPathSha256?: string;
  sourceMapSha256?: string;
  sourceMapBytes?: number;
  moduleCount: number;
  moduleSetSha256: string;
  breakpointCount: number;
  frameCount: number;
  scopeCount: number;
  variableCount: number;
  variablesTruncated: boolean;
  evaluationStatus?: "ok" | "error";
  evaluationType?: string;
  outputCount: number;
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

export function formatNodeDebuggerToolResult(
  result: NodeDebuggerActionResult,
): {
  content: Array<{ type: "text"; text: string }>;
  details: NodeDebuggerToolDetails;
} {
  const details: NodeDebuggerToolDetails = {
    kind: "napier.node-debugger",
    schemaVersion: 2,
    action: result.action,
    processId: result.processId,
    state: result.state,
    processStatus: result.processStatus,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    sourcePathSha256: result.sourcePathSha256,
    sourceSha256: result.sourceSha256,
    sourceBytes: result.sourceBytes,
    sourceMapMode: result.sourceMapMode,
    programPathSha256: result.programPathSha256,
    programSha256: result.programSha256,
    programBytes: result.programBytes,
    ...(result.sourceMapPathSha256
      ? { sourceMapPathSha256: result.sourceMapPathSha256 }
      : {}),
    ...(result.sourceMapSha256
      ? { sourceMapSha256: result.sourceMapSha256 }
      : {}),
    ...(result.sourceMapBytes !== undefined
      ? { sourceMapBytes: result.sourceMapBytes }
      : {}),
    moduleCount: result.moduleCount,
    moduleSetSha256: result.moduleSetSha256,
    breakpointCount: result.breakpointCount,
    frameCount: result.frames.length,
    scopeCount: result.scopes.length,
    variableCount: result.variables.length,
    variablesTruncated: result.variablesTruncated,
    ...(result.evaluation
      ? {
          evaluationStatus: result.evaluation.status,
          evaluationType: result.evaluation.type,
        }
      : {}),
    outputCount: result.output.length,
    outputTruncated: result.outputTruncated,
    nodeVersion: result.nodeVersion,
    workerSha256: result.workerSha256,
    runtimeExecutableSha256: result.runtimeExecutableSha256,
    runtimeCommandSha256: result.runtimeCommandSha256,
    dapRequestSequenceSha256: result.dapRequestSequenceSha256,
    dapResponseSequenceSha256: result.dapResponseSequenceSha256,
    dapEventSequenceSha256: result.dapEventSequenceSha256,
    resultSha256: result.resultSha256,
  };
  const lines = [
    `Node debugger ${result.processId}: ${result.state}`,
    `Action: ${result.action}`,
    `Process: ${result.processStatus}`,
    `Source: ${result.sourcePath}`,
    `Source SHA-256: ${result.sourceSha256}`,
    `Program: ${result.programPath}`,
    `Program SHA-256: ${result.programSha256}`,
    `Source map: ${result.sourceMapMode}`,
    ...(result.sourceMapPath
      ? [
          `Source map file: ${result.sourceMapPath}`,
          `Source map SHA-256: ${result.sourceMapSha256}`,
        ]
      : []),
    `Workspace modules: ${result.moduleCount} / ${result.moduleSetSha256}`,
    `Breakpoints: ${result.breakpointCount}`,
    ...(result.reason ? [`Stop reason: ${result.reason}`] : []),
    ...(result.exitCode !== undefined
      ? [`Target exit code: ${result.exitCode}`]
      : []),
    `Node: ${result.nodeVersion}`,
    ...(result.frames.length > 0
      ? [
          "",
          "STACK (untrusted live data)",
          ...result.frames.map(
            (frame) =>
              `#${frame.id} ${frame.name} ${frame.path ?? "(external)"}:${frame.line}:${frame.column}`,
          ),
        ]
      : []),
    ...(result.scopes.length > 0
      ? [
          "",
          "SCOPES (untrusted live data)",
          ...result.scopes.map(
            (scope) =>
              `${scope.name} -> variablesReference ${scope.variablesReference}`,
          ),
        ]
      : []),
    ...(result.variables.length > 0
      ? [
          "",
          "VARIABLES (untrusted live data)",
          ...result.variables.map(
            (variable) =>
              `${variable.name}: ${variable.value} (${variable.type})${
                variable.variablesReference
                  ? ` -> ${variable.variablesReference}`
                  : ""
              }`,
          ),
        ]
      : []),
    ...(result.evaluation
      ? [
          "",
          "EVALUATION (untrusted live data)",
          `${result.evaluation.status}: ${result.evaluation.result} (${result.evaluation.type})${
            result.evaluation.variablesReference
              ? ` -> ${result.evaluation.variablesReference}`
              : ""
          }`,
        ]
      : []),
    ...(result.output.length > 0
      ? [
          "",
          "TARGET OUTPUT (untrusted live data)",
          ...result.output.map(
            (entry, index) => `${index + 1} ${entry.category}: ${entry.text}`,
          ),
        ]
      : []),
    ...(result.outputTruncated || result.variablesTruncated
      ? ["", "[debug data truncated]"]
      : []),
  ];
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > MAX_NODE_DEBUGGER_TOOL_OUTPUT_BYTES) {
    throw new Error(
      `Node debugger tool output exceeds ${MAX_NODE_DEBUGGER_TOOL_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }
  return {
    content: [{ type: "text", text }],
    details,
  };
}
