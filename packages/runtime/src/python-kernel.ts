import type {
  JsonValue,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { MAX_PYTHON_KERNEL_INPUT_BYTES } from "./python-kernel-json-worker.js";
import {
  formatPythonKernelCodeBridgeResponse,
  parsePythonKernelCodeBridgeRequest,
  type PythonKernelCodeBridgeDispatcher,
} from "./python-kernel-code-bridge.js";
import {
  parsePythonKernelResult,
  type PythonKernelProtocolResult,
  type PythonKernelValueType,
} from "./python-kernel-protocol.js";
import {
  DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_CODE_BYTES,
  MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS,
  PYTHON_KERNEL_MEMORY_LIMIT_MARKER,
  PYTHON_KERNEL_TIMEOUT_MARKER,
  PYTHON_KERNEL_WORKER_ARGUMENTS,
  PYTHON_KERNEL_WORKER_SHA256,
} from "./python-kernel-worker.js";
import {
  MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
  type WorkspaceProcessManager,
} from "./workspace-processes.js";

export const DEFAULT_PYTHON_KERNEL_SESSION_TIMEOUT_MS = 120_000;
export const MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS = 10_000;
export const MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS = 120_000;
const PYTHON_KERNEL_PROTOCOL_RESULT_GRACE_MS = 5_000;
const PYTHON_KERNEL_CODE_BRIDGE_RESULT_GRACE_MS = 30_000;
const MAX_PYTHON_KERNEL_PROTOCOL_CHARS = MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS;
const MAX_PYTHON_KERNEL_STDERR_MARKER_CHARS =
  Math.max(
    PYTHON_KERNEL_MEMORY_LIMIT_MARKER.length,
    PYTHON_KERNEL_TIMEOUT_MARKER.length,
  ) * 2;

export type { PythonKernelValueType } from "./python-kernel-protocol.js";
export type PythonKernelResultMode =
  | "standard"
  | "workflow_intermediate"
  | "workflow_final";

export interface PythonKernelEvaluation {
  processId: string;
  requestId: string;
  status: "ok" | "error";
  terminal: boolean;
  processStatus: WorkspaceProcessStatus;
  valueType: PythonKernelValueType;
  preview: string;
  jsonValue?: JsonValue;
  jsonValueSha256?: string;
  jsonValueBytes?: number;
  previewTruncated: boolean;
  console: string[];
  consoleTruncated: boolean;
  durationMs: number;
  pythonVersion: string;
  memoryPeakBytes: number;
  memoryLimitBytes: number;
  requestSha256: string;
  workerSha256: string;
  runtimeExecutableSha256: string;
  runtimeCommandSha256: string;
  resultSha256: string;
}

interface RegisteredPythonKernel {
  threadId: string;
  runId: string;
  runtimeExecutableSha256: string;
  runtimeCommandSha256: string;
}

export class PythonKernelManager {
  private readonly registrations = new Map<string, RegisteredPythonKernel>();

  constructor(private readonly processes: WorkspaceProcessManager) {}

  async start(request: {
    threadId: string;
    runId: string;
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceProcessSession> {
    const timeoutMs =
      request.timeoutMs ?? DEFAULT_PYTHON_KERNEL_SESSION_TIMEOUT_MS;
    validateSessionTimeout(timeoutMs);
    const session = await this.processes.startPrivateProtocol({
      threadId: request.threadId,
      runId: request.runId,
      command: {
        runtime: "python",
        args: [...PYTHON_KERNEL_WORKER_ARGUMENTS],
        ...(request.cwd ? { cwd: request.cwd } : {}),
        timeoutMs,
      },
      interactive: true,
      outputLimitChars: MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    this.registrations.set(session.id, {
      threadId: request.threadId,
      runId: request.runId,
      runtimeExecutableSha256: session.executableSha256,
      runtimeCommandSha256: session.commandSha256,
    });
    return session;
  }

  async evaluate(request: {
    threadId: string;
    runId: string;
    processId: string;
    code: string;
    input?: JsonValue;
    resultMode?: PythonKernelResultMode;
    timeoutMs?: number;
    signal?: AbortSignal;
    codeBridge?: PythonKernelCodeBridgeDispatcher;
  }): Promise<PythonKernelEvaluation> {
    const timeoutMs =
      request.timeoutMs ?? DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS;
    const resultMode = request.resultMode ?? "standard";
    validateEvaluation(request.code, request.input, resultMode, timeoutMs);
    const registration = this.requireRegistration(request);
    const session = (await this.processes.list(request.threadId)).find(
      (candidate) => candidate.id === request.processId,
    );
    if (
      !session ||
      session.status !== "running" ||
      session.runId !== registration.runId ||
      session.runtime !== "python"
    ) {
      this.registrations.delete(request.processId);
      throw new Error("Python kernel is not running");
    }
    const requestId = createId("pykernelrequest");
    const input = {
      kind: "napier.python-kernel-request" as const,
      schemaVersion: 1 as const,
      id: requestId,
      codeBase64: Buffer.from(request.code, "utf8").toString("base64"),
      timeoutMs,
      ...(request.input !== undefined
        ? {
            inputJsonBase64: Buffer.from(
              canonicalJson(request.input),
              "utf8",
            ).toString("base64"),
          }
        : {}),
      ...(resultMode !== "standard" ? { resultMode } : {}),
      bridge: Boolean(request.codeBridge),
    };
    const requestSha256 = sha256(canonicalJson(input));
    let written = false;
    try {
      await this.processes.writePrivateProtocolInput({
        threadId: request.threadId,
        runId: request.runId,
        processId: request.processId,
        text: JSON.stringify(input),
        appendNewline: true,
        initiatedBy: "agent",
        ...(request.signal ? { signal: request.signal } : {}),
      });
      written = true;
      const result = await this.waitForResult({
        threadId: request.threadId,
        processId: request.processId,
        requestId,
        afterCursor: session.nextCursor,
        timeoutMs,
        runId: request.runId,
        ...(request.codeBridge ? { codeBridge: request.codeBridge } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      let processStatus: WorkspaceProcessStatus = "running";
      if (result.terminal) {
        processStatus = (
          await this.processes.cancel(request.threadId, request.processId)
        ).status;
        this.registrations.delete(request.processId);
      }
      const base = {
        processId: request.processId,
        requestId,
        status: result.status,
        terminal: result.terminal,
        processStatus,
        valueType: result.valueType,
        previewSha256: sha256(result.preview),
        ...(result.jsonValue !== undefined
          ? {
              jsonValueSha256: sha256(canonicalJson(result.jsonValue)),
              jsonValueBytes: Buffer.byteLength(
                canonicalJson(result.jsonValue),
                "utf8",
              ),
            }
          : {}),
        previewTruncated: result.previewTruncated,
        consoleCount: result.console.length,
        consoleSetSha256: sha256(canonicalJson(result.console)),
        consoleTruncated: result.consoleTruncated,
        durationMs: result.durationMs,
        pythonVersion: result.pythonVersion,
        memoryPeakBytes: result.memoryPeakBytes,
        memoryLimitBytes: result.memoryLimitBytes,
        requestSha256,
        workerSha256: PYTHON_KERNEL_WORKER_SHA256,
        runtimeExecutableSha256: registration.runtimeExecutableSha256,
        runtimeCommandSha256: registration.runtimeCommandSha256,
      };
      return {
        processId: request.processId,
        requestId,
        status: result.status,
        terminal: result.terminal,
        processStatus,
        valueType: result.valueType,
        preview: result.preview,
        ...(result.jsonValue !== undefined
          ? {
              jsonValue: structuredClone(result.jsonValue),
              jsonValueSha256: sha256(canonicalJson(result.jsonValue)),
              jsonValueBytes: Buffer.byteLength(
                canonicalJson(result.jsonValue),
                "utf8",
              ),
            }
          : {}),
        previewTruncated: result.previewTruncated,
        console: result.console,
        consoleTruncated: result.consoleTruncated,
        durationMs: result.durationMs,
        pythonVersion: result.pythonVersion,
        memoryPeakBytes: result.memoryPeakBytes,
        memoryLimitBytes: result.memoryLimitBytes,
        requestSha256,
        workerSha256: PYTHON_KERNEL_WORKER_SHA256,
        runtimeExecutableSha256: registration.runtimeExecutableSha256,
        runtimeCommandSha256: registration.runtimeCommandSha256,
        resultSha256: sha256(canonicalJson(base)),
      };
    } catch (error) {
      if (written) {
        await this.processes
          .cancel(request.threadId, request.processId)
          .catch(() => undefined);
        this.registrations.delete(request.processId);
      }
      throw error;
    }
  }

  async cancel(request: {
    threadId: string;
    runId: string;
    processId: string;
  }): Promise<WorkspaceProcessSession> {
    this.requireRegistration(request);
    const session = await this.processes.cancel(
      request.threadId,
      request.processId,
    );
    this.registrations.delete(request.processId);
    return session;
  }

  async cancelRun(request: { threadId: string; runId: string }): Promise<void> {
    const processIds = [...this.registrations.entries()]
      .filter(
        ([, registration]) =>
          registration.threadId === request.threadId &&
          registration.runId === request.runId,
      )
      .map(([processId]) => processId);
    const settlements = await Promise.allSettled(
      processIds.map(async (processId) => {
        try {
          await this.processes.cancel(request.threadId, processId);
        } finally {
          this.registrations.delete(processId);
        }
      }),
    );
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  private requireRegistration(request: {
    threadId: string;
    runId: string;
    processId: string;
  }): RegisteredPythonKernel {
    const registration = this.registrations.get(request.processId);
    if (
      !registration ||
      registration.threadId !== request.threadId ||
      registration.runId !== request.runId
    ) {
      throw new Error(
        "Python kernel does not belong to the current Thread and Run",
      );
    }
    return registration;
  }

  private async waitForResult(request: {
    threadId: string;
    processId: string;
    requestId: string;
    afterCursor: number;
    timeoutMs: number;
    runId: string;
    signal?: AbortSignal;
    codeBridge?: PythonKernelCodeBridgeDispatcher;
  }): Promise<PythonKernelProtocolResult> {
    const deadline =
      Date.now() +
      request.timeoutMs +
      (request.codeBridge
        ? PYTHON_KERNEL_CODE_BRIDGE_RESULT_GRACE_MS
        : PYTHON_KERNEL_PROTOCOL_RESULT_GRACE_MS);
    let cursor = request.afterCursor;
    let buffer = "";
    let stderrBuffer = "";
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const output = await this.processes.outputPrivateProtocol(
        request.threadId,
        request.processId,
        {
          afterCursor: cursor,
          waitMs: Math.min(
            MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
            Math.max(0, remaining),
          ),
          ...(request.signal ? { signal: request.signal } : {}),
        },
      );
      cursor = output.nextCursor;
      for (const chunk of output.chunks) {
        if (chunk.stream === "stderr") {
          stderrBuffer = (stderrBuffer + chunk.text).slice(
            -MAX_PYTHON_KERNEL_STDERR_MARKER_CHARS,
          );
          if (stderrBuffer.includes(PYTHON_KERNEL_MEMORY_LIMIT_MARKER)) {
            throw new Error("Python kernel traced memory limit exceeded");
          }
          if (stderrBuffer.includes(PYTHON_KERNEL_TIMEOUT_MARKER)) {
            throw new Error("Python kernel evaluation timed out");
          }
          continue;
        }
        buffer += chunk.text;
        if (buffer.length > MAX_PYTHON_KERNEL_PROTOCOL_CHARS) {
          throw new Error("Python kernel protocol output exceeded its limit");
        }
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const result = parsePythonKernelResult(line, request.requestId);
          if (result) return result;
          const codeBridgeRequest = parsePythonKernelCodeBridgeRequest(
            line,
            request.requestId,
          );
          if (codeBridgeRequest) {
            await this.respondToCodeBridgeCall(request, codeBridgeRequest);
          }
          newline = buffer.indexOf("\n");
        }
      }
      if (output.status !== "running" && !output.hasMore) {
        throw new Error(
          "Python kernel exited before returning an evaluation result",
        );
      }
    }
    throw new Error("Python kernel evaluation timed out");
  }

  private async respondToCodeBridgeCall(
    request: {
      threadId: string;
      runId: string;
      processId: string;
      requestId: string;
      signal?: AbortSignal;
      codeBridge?: PythonKernelCodeBridgeDispatcher;
    },
    call: Parameters<PythonKernelCodeBridgeDispatcher>[0],
  ): Promise<void> {
    let responses: readonly string[];
    try {
      if (!request.codeBridge) {
        throw new Error("Python Code Bridge is unavailable");
      }
      const result = await request.codeBridge(call, request.signal);
      responses = formatPythonKernelCodeBridgeResponse({
        evaluationId: request.requestId,
        callId: call.callId,
        result,
      });
    } catch (error) {
      responses = formatPythonKernelCodeBridgeResponse({
        evaluationId: request.requestId,
        callId: call.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    for (const response of responses) {
      await this.processes.writePrivateProtocolInput({
        threadId: request.threadId,
        runId: request.runId,
        processId: request.processId,
        text: response,
        appendNewline: true,
        initiatedBy: "agent",
        ...(request.signal ? { signal: request.signal } : {}),
      });
    }
  }
}

function validateEvaluation(
  code: string,
  input: JsonValue | undefined,
  resultMode: PythonKernelResultMode,
  timeoutMs: number,
): void {
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    Buffer.from(code, "utf8").toString("utf8") !== code ||
    Buffer.byteLength(code, "utf8") > MAX_PYTHON_KERNEL_CODE_BYTES
  ) {
    throw new Error(
      `Python kernel code must be 1-${MAX_PYTHON_KERNEL_CODE_BYTES} UTF-8 bytes`,
    );
  }
  if (
    input !== undefined &&
    Buffer.byteLength(canonicalJson(input), "utf8") >
      MAX_PYTHON_KERNEL_INPUT_BYTES
  ) {
    throw new Error(
      `Python kernel input exceeds ${MAX_PYTHON_KERNEL_INPUT_BYTES} UTF-8 bytes`,
    );
  }
  if (
    resultMode !== "standard" &&
    resultMode !== "workflow_intermediate" &&
    resultMode !== "workflow_final"
  ) {
    throw new Error("Python kernel resultMode is invalid");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS
  ) {
    throw new Error(
      `Python kernel timeoutMs must be 1-${MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS}`,
    );
  }
}

function validateSessionTimeout(timeoutMs: number): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS ||
    timeoutMs > MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS
  ) {
    throw new Error(
      `Python kernel session timeoutMs must be ${MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS}-${MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS}`,
    );
  }
}
