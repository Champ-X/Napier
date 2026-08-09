import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, WorkspaceProcessStatus } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  JavascriptKernelManager,
  MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  type JavascriptKernelEvaluation,
} from "./javascript-kernel.js";
import {
  DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
  JAVASCRIPT_KERNEL_WORKER_SHA256,
  MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
  MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
} from "./javascript-kernel-worker.js";

export const MAX_JAVASCRIPT_KERNEL_TOOL_OUTPUT_BYTES = 32 * 1024;

const javascriptKernelSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("start"),
      cwd: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
          pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        }),
      ),
      sessionTimeoutMs: Type.Optional(
        Type.Integer({
          minimum: MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
          maximum: MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("evaluate"),
      processId: Type.String({ pattern: "^process_[a-z0-9]{8,80}$" }),
      code: Type.String({
        minLength: 1,
        maxLength: MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
      }),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("cancel"),
      processId: Type.String({ pattern: "^process_[a-z0-9]{8,80}$" }),
    },
    { additionalProperties: false },
  ),
]);
Object.assign(javascriptKernelSchema, { type: "object" });

export interface JavascriptKernelToolDetails {
  kind: "napier.javascript-kernel";
  schemaVersion: 1;
  action: "start" | "evaluate" | "cancel";
  processId: string;
  processStatus: WorkspaceProcessStatus;
  evaluationStatus?: "ok" | "error";
  terminal?: boolean;
  valueType?: string;
  previewTruncated?: boolean;
  consoleCount?: number;
  consoleTruncated?: boolean;
  durationMs?: number;
  requestSha256?: string;
  workerSha256: string;
  resultSha256: string;
}

export function createJavascriptKernelTool(
  manager: JavascriptKernelManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof javascriptKernelSchema, JavascriptKernelToolDetails> {
  return {
    name: "javascript_kernel",
    label: "JavaScript kernel",
    description:
      "Start/evaluate/cancel persistent synchronous JavaScript in a read-only offline OS Sandbox. start: workspace-relative cwd + total sessionTimeoutMs; evaluate: processId, code, CPU timeoutMs. State persists across this Run. process/require/fetch/WebAssembly/shared-memory Atomics/GC callbacks/dynamic string code/workspace writes/inherited env are unavailable. Promise microtasks drain within timeout; returned Promise/thenable or uncertain outcome terminates the kernel.",
    parameters: javascriptKernelSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "start") {
        const session = await manager.start({
          ...context,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          timeoutMs:
            input.sessionTimeoutMs ??
            DEFAULT_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
        return toolResult(
          {
            kind: "napier.javascript-kernel",
            schemaVersion: 1,
            action: "start",
            processId: session.id,
            processStatus: session.status,
            workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
            resultSha256: sha256(
              canonicalJson({
                action: "start",
                processId: session.id,
                processStatus: session.status,
                workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
                sessionSha256: session.contentSha256,
              }),
            ),
          },
          [
            `JavaScript kernel ${session.id}: ${session.status}`,
            "State: empty and persistent for this Run",
            "Workspace: read-only",
            "Network: denied",
            `Worker SHA-256: ${JAVASCRIPT_KERNEL_WORKER_SHA256}`,
          ],
        );
      }
      if (input.action === "evaluate") {
        const evaluation = await manager.evaluate({
          ...context,
          processId: input.processId,
          code: input.code,
          timeoutMs:
            input.timeoutMs ?? DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
        return evaluationResult(evaluation);
      }
      const session = await manager.cancel({
        ...context,
        processId: input.processId,
      });
      return toolResult(
        {
          kind: "napier.javascript-kernel",
          schemaVersion: 1,
          action: "cancel",
          processId: session.id,
          processStatus: session.status,
          workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
          resultSha256: sha256(
            canonicalJson({
              action: "cancel",
              processId: session.id,
              processStatus: session.status,
              workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
              sessionSha256: session.contentSha256,
            }),
          ),
        },
        [
          `JavaScript kernel ${session.id}: ${session.status}`,
          "The persistent context is no longer available.",
          `Worker SHA-256: ${JAVASCRIPT_KERNEL_WORKER_SHA256}`,
        ],
      );
    },
  };
}

export function javascriptKernelToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action =
    value["action"] === "start" ||
    value["action"] === "evaluate" ||
    value["action"] === "cancel"
      ? value["action"]
      : "unknown";
  const code = typeof value["code"] === "string" ? value["code"] : "";
  const cwd = typeof value["cwd"] === "string" ? value["cwd"] : ".";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(typeof value["processId"] === "string"
      ? { processId: value["processId"] }
      : {}),
    ...(action === "evaluate"
      ? {
          codeBytes: Buffer.byteLength(code, "utf8"),
          codeSha256: sha256(code),
          timeoutMs:
            typeof value["timeoutMs"] === "number"
              ? value["timeoutMs"]
              : DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
        }
      : {}),
    ...(action === "start"
      ? {
          cwdPathSha256: sha256(cwd),
          sessionTimeoutMs:
            typeof value["sessionTimeoutMs"] === "number"
              ? value["sessionTimeoutMs"]
              : DEFAULT_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
        }
      : {}),
    inputSha256: javascriptKernelCallSha256(args),
  };
}

export function javascriptKernelToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: javascriptKernelCallSha256(args),
    inputRedacted: true,
  };
}

export function javascriptKernelToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : undefined;
  const resultSha256 =
    details && hash(details["resultSha256"])
      ? details["resultSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
  };
}

function evaluationResult(evaluation: JavascriptKernelEvaluation) {
  const details: JavascriptKernelToolDetails = {
    kind: "napier.javascript-kernel",
    schemaVersion: 1,
    action: "evaluate",
    processId: evaluation.processId,
    processStatus: evaluation.processStatus,
    evaluationStatus: evaluation.status,
    terminal: evaluation.terminal,
    valueType: evaluation.valueType,
    previewTruncated: evaluation.previewTruncated,
    consoleCount: evaluation.console.length,
    consoleTruncated: evaluation.consoleTruncated,
    durationMs: evaluation.durationMs,
    requestSha256: evaluation.requestSha256,
    workerSha256: evaluation.workerSha256,
    resultSha256: evaluation.resultSha256,
  };
  return toolResult(details, [
    `JavaScript kernel ${evaluation.processId}: ${evaluation.status}`,
    `Process: ${evaluation.processStatus}`,
    `Value type: ${evaluation.valueType}`,
    `Duration: ${evaluation.durationMs} ms`,
    `Terminal evaluation: ${String(evaluation.terminal)}`,
    `Request SHA-256: ${evaluation.requestSha256}`,
    `Worker SHA-256: ${evaluation.workerSha256}`,
    "",
    "VALUE (untrusted live output)",
    evaluation.preview || "(empty)",
    ...(evaluation.console.length > 0
      ? [
          "",
          "CONSOLE (untrusted live output)",
          ...evaluation.console.map((entry, index) => `${index + 1}: ${entry}`),
        ]
      : []),
    ...(evaluation.previewTruncated || evaluation.consoleTruncated
      ? ["", "[kernel output truncated]"]
      : []),
  ]);
}

function toolResult(details: JavascriptKernelToolDetails, lines: string[]) {
  const text = lines.join("\n");
  if (
    Buffer.byteLength(text, "utf8") > MAX_JAVASCRIPT_KERNEL_TOOL_OUTPUT_BYTES
  ) {
    throw new Error(
      `JavaScript kernel tool output exceeds ${MAX_JAVASCRIPT_KERNEL_TOOL_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function javascriptKernelCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "javascript_kernel", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
