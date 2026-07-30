import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, WorkspaceProcessStatus } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
  DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS,
  MAX_NODE_DEBUG_ACTION_TIMEOUT_MS,
  MAX_NODE_DEBUG_SESSION_TIMEOUT_MS,
  MIN_NODE_DEBUG_SESSION_TIMEOUT_MS,
  NodeDebuggerManager,
  type NodeDebuggerActionResult,
} from "./node-debugger.js";
import {
  MAX_NODE_DEBUG_BREAKPOINTS,
  MAX_NODE_DEBUG_EXPRESSION_CHARS,
} from "./node-debugger-worker.js";

export const MAX_NODE_DEBUGGER_TOOL_OUTPUT_BYTES = 32 * 1024;

const processId = Type.String({ pattern: "^process_[a-z0-9]{8,80}$" });
const actionTimeout = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: MAX_NODE_DEBUG_ACTION_TIMEOUT_MS,
    description: "Wall-time budget for this DAP action.",
  }),
);
const nodeDebuggerSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("launch"),
      path: Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        description:
          "Workspace-relative JavaScript or Node-executable TypeScript program.",
      }),
      breakpoints: Type.Array(
        Type.Object(
          {
            line: Type.Integer({ minimum: 1 }),
            column: Type.Optional(Type.Integer({ minimum: 1 })),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_NODE_DEBUG_BREAKPOINTS },
      ),
      args: Type.Optional(
        Type.Array(
          Type.String({
            maxLength: 500,
            pattern: "^[^\\u0000-\\u001f\\u007f]*$",
          }),
          { maxItems: 16 },
        ),
      ),
      pauseOnExceptions: Type.Optional(
        Type.Union([
          Type.Literal("none"),
          Type.Literal("uncaught"),
          Type.Literal("all"),
        ]),
      ),
      sessionTimeoutMs: Type.Optional(
        Type.Integer({
          minimum: MIN_NODE_DEBUG_SESSION_TIMEOUT_MS,
          maximum: MAX_NODE_DEBUG_SESSION_TIMEOUT_MS,
        }),
      ),
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("stack_trace"),
      processId,
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("scopes"),
      processId,
      frameId: Type.Integer({ minimum: 1 }),
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("variables"),
      processId,
      variablesReference: Type.Integer({ minimum: 1 }),
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("evaluate"),
      processId,
      frameId: Type.Integer({ minimum: 1 }),
      expression: Type.String({
        minLength: 1,
        maxLength: MAX_NODE_DEBUG_EXPRESSION_CHARS,
        description:
          "Expression evaluated on the paused frame with throwOnSideEffect enabled.",
      }),
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Union([
        Type.Literal("continue"),
        Type.Literal("next"),
        Type.Literal("step_in"),
        Type.Literal("step_out"),
        Type.Literal("cancel"),
      ]),
      processId,
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
]);

export interface NodeDebuggerToolDetails {
  kind: "napier.node-debugger";
  schemaVersion: 1;
  action: NodeDebuggerActionResult["action"];
  processId: string;
  state: NodeDebuggerActionResult["state"];
  processStatus: WorkspaceProcessStatus;
  reason?: string;
  exitCode?: number;
  sourcePathSha256: string;
  sourceSha256: string;
  sourceBytes: number;
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

export function createNodeDebuggerTool(
  manager: NodeDebuggerManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof nodeDebuggerSchema, NodeDebuggerToolDetails> {
  return {
    name: "node_debugger",
    label: "Node debugger",
    description:
      "Launch and control one Run-owned Node Debug Adapter Protocol session in the read-only, offline OS Sandbox. Set source breakpoints, inspect stack/scopes/variables, evaluate expressions without side effects, continue, or single-step. Retain the processId while paused. Source, paths, variable names/values, expressions, arguments, and target output are live-only.",
    parameters: nodeDebuggerSchema,
    async execute(_toolCallId, input, signal) {
      let result: NodeDebuggerActionResult;
      if (input.action === "launch") {
        result = await manager.launch({
          ...context,
          path: input.path,
          breakpoints: input.breakpoints,
          args: input.args ?? [],
          pauseOnExceptions: input.pauseOnExceptions ?? "uncaught",
          sessionTimeoutMs:
            input.sessionTimeoutMs ?? DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS,
          actionTimeoutMs:
            input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "stack_trace") {
        result = await manager.stackTrace({
          ...context,
          processId: input.processId,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "scopes") {
        result = await manager.scopes({
          ...context,
          processId: input.processId,
          frameId: input.frameId,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "variables") {
        result = await manager.variables({
          ...context,
          processId: input.processId,
          variablesReference: input.variablesReference,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "evaluate") {
        result = await manager.evaluate({
          ...context,
          processId: input.processId,
          frameId: input.frameId,
          expression: input.expression,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (
        input.action === "continue" ||
        input.action === "next" ||
        input.action === "step_in" ||
        input.action === "step_out"
      ) {
        result = await manager.resume({
          ...context,
          action: input.action,
          processId: input.processId,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else {
        result = await manager.cancel({
          ...context,
          processId: input.processId,
        });
      }
      return formatToolResult(result);
    },
  };
}

export function nodeDebuggerToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action = debuggerAction(value["action"]);
  const sourcePath = typeof value["path"] === "string" ? value["path"] : "";
  const expression =
    typeof value["expression"] === "string" ? value["expression"] : "";
  const programArgs = Array.isArray(value["args"]) ? value["args"] : [];
  const breakpoints = Array.isArray(value["breakpoints"])
    ? value["breakpoints"]
    : [];
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(typeof value["processId"] === "string"
      ? { processId: value["processId"] }
      : {}),
    ...(typeof value["frameId"] === "number"
      ? { frameId: value["frameId"] }
      : {}),
    ...(typeof value["variablesReference"] === "number"
      ? { variablesReference: value["variablesReference"] }
      : {}),
    ...(action === "launch"
      ? {
          sourcePathSha256: sha256(sourcePath),
          breakpointCount: breakpoints.length,
          breakpointSetSha256: sha256(canonicalJson(breakpoints)),
          argumentCount: programArgs.length,
          argumentSetSha256: sha256(canonicalJson(programArgs)),
          sessionTimeoutMs:
            typeof value["sessionTimeoutMs"] === "number"
              ? value["sessionTimeoutMs"]
              : DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS,
        }
      : {}),
    ...(action === "evaluate"
      ? {
          expressionBytes: Buffer.byteLength(expression, "utf8"),
          expressionSha256: sha256(expression),
        }
      : {}),
    ...(action !== "cancel"
      ? {
          timeoutMs:
            typeof value["timeoutMs"] === "number"
              ? value["timeoutMs"]
              : DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
        }
      : {}),
    inputSha256: nodeDebuggerCallSha256(args),
  };
}

export function nodeDebuggerToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: nodeDebuggerCallSha256(args),
    inputRedacted: true,
  };
}

export function nodeDebuggerToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details && hash(details["resultSha256"])
      ? { resultSha256: details["resultSha256"] }
      : {}),
  };
}

function formatToolResult(result: NodeDebuggerActionResult) {
  const details: NodeDebuggerToolDetails = {
    kind: "napier.node-debugger",
    schemaVersion: 1,
    action: result.action,
    processId: result.processId,
    state: result.state,
    processStatus: result.processStatus,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    sourcePathSha256: result.sourcePathSha256,
    sourceSha256: result.sourceSha256,
    sourceBytes: result.sourceBytes,
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
    content: [{ type: "text" as const, text }],
    details,
  };
}

function debuggerAction(
  value: unknown,
): NodeDebuggerActionResult["action"] | "unknown" {
  return value === "launch" ||
    value === "stack_trace" ||
    value === "scopes" ||
    value === "variables" ||
    value === "evaluate" ||
    value === "continue" ||
    value === "next" ||
    value === "step_in" ||
    value === "step_out" ||
    value === "cancel"
    ? value
    : "unknown";
}

function nodeDebuggerCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "node_debugger", args }));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
