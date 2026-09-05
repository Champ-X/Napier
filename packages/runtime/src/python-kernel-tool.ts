import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, WorkspaceProcessStatus } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
  MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
  PythonKernelManager,
  type PythonKernelEvaluation,
} from "./python-kernel.js";
import {
  DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_CODE_BYTES,
  MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  PYTHON_KERNEL_WORKER_SHA256,
} from "./python-kernel-worker.js";
import type { PythonKernelCodeBridgeDispatcher } from "./python-kernel-code-bridge.js";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
} from "./tool-progress-semantics.js";

export const MAX_PYTHON_KERNEL_TOOL_OUTPUT_BYTES = 32 * 1024;

const pythonKernelSchema = Type.Union([
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
          minimum: MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
          maximum: MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
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
        maxLength: MAX_PYTHON_KERNEL_CODE_BYTES,
      }),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
        }),
      ),
      bridge: Type.Optional(Type.Literal(true)),
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
Object.assign(pythonKernelSchema, { type: "object" });

export interface PythonKernelToolDetails {
  kind: "napier.python-kernel";
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
  pythonVersion?: string;
  memoryPeakBytes?: number;
  memoryLimitBytes?: number;
  requestSha256?: string;
  workerSha256: string;
  runtimeExecutableSha256: string;
  runtimeCommandSha256: string;
  resultSha256: string;
}

export function createPythonKernelTool(
  manager: PythonKernelManager,
  context: { threadId: string; runId: string },
  codeBridge?: PythonKernelCodeBridgeDispatcher,
): AgentTool<typeof pythonKernelSchema, PythonKernelToolDetails> {
  const tool: AgentTool<typeof pythonKernelSchema, PythonKernelToolDetails> = {
    name: "python_kernel",
    label: "Python kernel",
    description:
      "Persistent restricted Python in a read-only offline OS Sandbox. start: workspace-relative cwd, sessionTimeoutMs. evaluate: processId, code, timeoutMs; bridge=true enables governed napier.call. State persists for this Run. imports, async, private/dynamic code, file/process/network/env access and writes are unavailable. Timeout or uncertainty terminates the kernel.",
    parameters: pythonKernelSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "start") {
        const session = await manager.start({
          ...context,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          timeoutMs:
            input.sessionTimeoutMs ?? DEFAULT_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        });
        return toolResult(
          {
            kind: "napier.python-kernel",
            schemaVersion: 1,
            action: "start",
            processId: session.id,
            processStatus: session.status,
            workerSha256: PYTHON_KERNEL_WORKER_SHA256,
            runtimeExecutableSha256: session.executableSha256,
            runtimeCommandSha256: session.commandSha256,
            resultSha256: sha256(
              canonicalJson({
                action: "start",
                processId: session.id,
                processStatus: session.status,
                workerSha256: PYTHON_KERNEL_WORKER_SHA256,
                runtimeExecutableSha256: session.executableSha256,
                runtimeCommandSha256: session.commandSha256,
                sessionSha256: session.contentSha256,
              }),
            ),
          },
          [
            `Python kernel ${session.id}: ${session.status}`,
            "State: empty and persistent for this Run",
            "Language: restricted synchronous Python",
            "Workspace: read-only",
            "Network: denied",
            `Worker SHA-256: ${PYTHON_KERNEL_WORKER_SHA256}`,
            `Runtime executable SHA-256: ${session.executableSha256}`,
          ],
        );
      }
      if (input.action === "evaluate") {
        const evaluation = await manager.evaluate({
          ...context,
          processId: input.processId,
          code: input.code,
          timeoutMs:
            input.timeoutMs ?? DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
          ...(input.bridge === true && codeBridge ? { codeBridge } : {}),
        });
        return evaluationResult(evaluation);
      }
      const session = await manager.cancel({
        ...context,
        processId: input.processId,
      });
      return toolResult(
        {
          kind: "napier.python-kernel",
          schemaVersion: 1,
          action: "cancel",
          processId: session.id,
          processStatus: session.status,
          workerSha256: PYTHON_KERNEL_WORKER_SHA256,
          runtimeExecutableSha256: session.executableSha256,
          runtimeCommandSha256: session.commandSha256,
          resultSha256: sha256(
            canonicalJson({
              action: "cancel",
              processId: session.id,
              processStatus: session.status,
              workerSha256: PYTHON_KERNEL_WORKER_SHA256,
              runtimeExecutableSha256: session.executableSha256,
              runtimeCommandSha256: session.commandSha256,
              sessionSha256: session.contentSha256,
            }),
          ),
        },
        [
          `Python kernel ${session.id}: ${session.status}`,
          "The persistent state is no longer available.",
          `Worker SHA-256: ${PYTHON_KERNEL_WORKER_SHA256}`,
        ],
      );
    },
  };
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.1.0",
    modes: [
      {
        modeId: "python_kernel_session",
        operation: "coordinate",
        scope: "session",
        contribution: "neutral",
      },
    ],
    resolve(input) {
      const value = recordValue(input);
      const processId = value["processId"];
      const resourceKey =
        typeof processId === "string"
          ? { kind: "python-kernel-session", processId }
          : { kind: "python-kernel-manager", runId: context.runId };
      return {
        semantics: progressSemantics("coordinate", "session", "neutral"),
        resourceKey,
        failureBindings: {
          target: resourceKey,
          route: {
            kind: "kernel-route",
            runtime: "python",
            action: value["action"],
          },
          capability: { kind: "kernel-capability", runtime: "python" },
          session: resourceKey,
        },
        failureDomainKey: resourceKey,
      };
    },
  });
}

export function pythonKernelToolCallArgumentsLedgerProjection(
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
              : DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
          bridge: value["bridge"] === true,
        }
      : {}),
    ...(action === "start"
      ? {
          cwdPathSha256: sha256(cwd),
          sessionTimeoutMs:
            typeof value["sessionTimeoutMs"] === "number"
              ? value["sessionTimeoutMs"]
              : DEFAULT_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
        }
      : {}),
    inputSha256: pythonKernelCallSha256(args),
  };
}

export function pythonKernelToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: pythonKernelCallSha256(args),
    inputRedacted: true,
  };
}

export function pythonKernelToolOutputLedgerProjection(
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

function evaluationResult(evaluation: PythonKernelEvaluation) {
  const details: PythonKernelToolDetails = {
    kind: "napier.python-kernel",
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
    pythonVersion: evaluation.pythonVersion,
    memoryPeakBytes: evaluation.memoryPeakBytes,
    memoryLimitBytes: evaluation.memoryLimitBytes,
    requestSha256: evaluation.requestSha256,
    workerSha256: evaluation.workerSha256,
    runtimeExecutableSha256: evaluation.runtimeExecutableSha256,
    runtimeCommandSha256: evaluation.runtimeCommandSha256,
    resultSha256: evaluation.resultSha256,
  };
  return toolResult(details, [
    `Python kernel ${evaluation.processId}: ${evaluation.status}`,
    `Process: ${evaluation.processStatus}`,
    `Python: ${evaluation.pythonVersion}`,
    `Value type: ${evaluation.valueType}`,
    `Duration: ${evaluation.durationMs} ms`,
    `Traced Python memory: ${evaluation.memoryPeakBytes} / ${evaluation.memoryLimitBytes} bytes`,
    `Terminal evaluation: ${String(evaluation.terminal)}`,
    `Request SHA-256: ${evaluation.requestSha256}`,
    `Worker SHA-256: ${evaluation.workerSha256}`,
    `Runtime executable SHA-256: ${evaluation.runtimeExecutableSha256}`,
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

function toolResult(details: PythonKernelToolDetails, lines: string[]) {
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > MAX_PYTHON_KERNEL_TOOL_OUTPUT_BYTES) {
    throw new Error(
      `Python kernel tool output exceeds ${MAX_PYTHON_KERNEL_TOOL_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function pythonKernelCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "python_kernel", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
