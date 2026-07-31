import type {
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  parsePythonKernelResult,
  type PythonKernelProtocolResult,
  type PythonKernelValueType,
} from "./python-kernel-protocol.js";
import {
  DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_CODE_BYTES,
  MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
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
export const PYTHON_KERNEL_PROTOCOL_RESULT_GRACE_MS = 5_000;

const MAX_PYTHON_KERNEL_PROTOCOL_CHARS = 24 * 1024;
const MAX_PYTHON_KERNEL_STDERR_MARKER_CHARS =
  Math.max(
    PYTHON_KERNEL_MEMORY_LIMIT_MARKER.length,
    PYTHON_KERNEL_TIMEOUT_MARKER.length,
  ) * 2;

export type { PythonKernelValueType } from "./python-kernel-protocol.js";

export interface PythonKernelEvaluation {
  processId: string;
  requestId: string;
  status: "ok" | "error";
  terminal: boolean;
  processStatus: WorkspaceProcessStatus;
  valueType: PythonKernelValueType;
  preview: string;
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
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<PythonKernelEvaluation> {
    const timeoutMs =
      request.timeoutMs ?? DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS;
    validateEvaluation(request.code, timeoutMs);
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
    signal?: AbortSignal;
  }): Promise<PythonKernelProtocolResult> {
    const deadline =
      Date.now() + request.timeoutMs + PYTHON_KERNEL_PROTOCOL_RESULT_GRACE_MS;
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
}

function validateEvaluation(code: string, timeoutMs: number): void {
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
