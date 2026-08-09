import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type, type Static } from "typebox";

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
  formatNodeDebuggerToolResult,
  type NodeDebuggerToolDetails,
} from "./node-debugger-tool-result.js";
import {
  MAX_NODE_DEBUG_BREAKPOINTS,
  MAX_NODE_DEBUG_EXPRESSION_CHARS,
} from "./node-debugger-worker.js";

export { MAX_NODE_DEBUGGER_TOOL_OUTPUT_BYTES } from "./node-debugger-tool-result.js";
export type { NodeDebuggerToolDetails } from "./node-debugger-tool-result.js";

const processId = Type.String({ pattern: "^process_[a-z0-9]{8,80}$" });
const actionTimeout = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: MAX_NODE_DEBUG_ACTION_TIMEOUT_MS,
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
      }),
      programPath: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
          pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        }),
      ),
      sourceMapPath: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
          pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        }),
      ),
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
      action: Type.Union([
        Type.Literal("stack_trace"),
        Type.Literal("scopes"),
        Type.Literal("variables"),
        Type.Literal("evaluate"),
        Type.Literal("continue"),
        Type.Literal("next"),
        Type.Literal("step_in"),
        Type.Literal("step_out"),
        Type.Literal("cancel"),
      ]),
      processId,
      frameId: Type.Optional(Type.Integer({ minimum: 1 })),
      variablesReference: Type.Optional(Type.Integer({ minimum: 1 })),
      expression: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: MAX_NODE_DEBUG_EXPRESSION_CHARS,
        }),
      ),
      timeoutMs: actionTimeout,
    },
    { additionalProperties: false },
  ),
]);
Object.assign(nodeDebuggerSchema, { type: "object" });

export function createNodeDebuggerTool(
  manager: NodeDebuggerManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof nodeDebuggerSchema, NodeDebuggerToolDetails> {
  return {
    name: "node_debugger",
    label: "Node debugger",
    description:
      "Launch/control one Run-owned Node DAP session in the read-only offline OS Sandbox: set source breakpoints; inspect stack/scopes/variables; evaluate paused-frame expressions with throwOnSideEffect; continue/step/cancel. All paths are workspace-relative. path launches JS/Node-executable TS unless compiled TS supplies paired programPath + external-v3 sourceMapPath for original coordinates. Retain processId while paused; timeoutMs bounds each action. Source, paths, values, expressions, args, and output are live-only.",
    parameters: nodeDebuggerSchema,
    async execute(_toolCallId, input, signal) {
      assertDebuggerControlFields(input);
      let result: NodeDebuggerActionResult;
      if (input.action === "launch") {
        result = await manager.launch({
          ...context,
          path: input.path,
          ...(input.programPath ? { programPath: input.programPath } : {}),
          ...(input.sourceMapPath
            ? { sourceMapPath: input.sourceMapPath }
            : {}),
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
          frameId: input.frameId!,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "variables") {
        result = await manager.variables({
          ...context,
          processId: input.processId,
          variablesReference: input.variablesReference!,
          timeoutMs: input.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
      } else if (input.action === "evaluate") {
        result = await manager.evaluate({
          ...context,
          processId: input.processId,
          frameId: input.frameId!,
          expression: input.expression!,
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
      return formatNodeDebuggerToolResult(result);
    },
  };
}

export function nodeDebuggerToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action = debuggerAction(value["action"]);
  const sourcePath = typeof value["path"] === "string" ? value["path"] : "";
  const programPath =
    typeof value["programPath"] === "string" ? value["programPath"] : "";
  const sourceMapPath =
    typeof value["sourceMapPath"] === "string" ? value["sourceMapPath"] : "";
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
          sourceMapMode: programPath && sourceMapPath ? "external" : "none",
          ...(programPath ? { programPathSha256: sha256(programPath) } : {}),
          ...(sourceMapPath
            ? { sourceMapPathSha256: sha256(sourceMapPath) }
            : {}),
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

function assertDebuggerControlFields(
  input: Static<typeof nodeDebuggerSchema>,
): void {
  if (input.action === "launch") return;
  const hasFrame = input.frameId !== undefined;
  const hasVariables = input.variablesReference !== undefined;
  const hasExpression = input.expression !== undefined;
  const valid =
    input.action === "scopes"
      ? hasFrame && !hasVariables && !hasExpression
      : input.action === "variables"
        ? !hasFrame && hasVariables && !hasExpression
        : input.action === "evaluate"
          ? hasFrame && !hasVariables && hasExpression
          : !hasFrame && !hasVariables && !hasExpression;
  if (!valid) throw new Error("Node debugger fields do not match action");
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
