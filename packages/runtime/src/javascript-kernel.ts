import type {
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  parseJavascriptKernelResult,
  type JavascriptKernelProtocolResult,
  type JavascriptKernelValueType,
} from "./javascript-kernel-protocol.js";
import {
  DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
  JAVASCRIPT_KERNEL_WORKER_ARGUMENTS,
  JAVASCRIPT_KERNEL_WORKER_SHA256,
  MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
  MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
} from "./javascript-kernel-worker.js";
import {
  MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
  type WorkspaceProcessManager,
} from "./workspace-processes.js";

export const DEFAULT_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS = 120_000;
export const MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS = 10_000;
export const MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS = 120_000;

const MAX_JAVASCRIPT_KERNEL_PROTOCOL_CHARS = 24 * 1024;

export type { JavascriptKernelValueType } from "./javascript-kernel-protocol.js";

export interface JavascriptKernelEvaluation {
  processId: string;
  requestId: string;
  status: "ok" | "error";
  terminal: boolean;
  processStatus: WorkspaceProcessStatus;
  valueType: JavascriptKernelValueType;
  preview: string;
  previewTruncated: boolean;
  console: string[];
  consoleTruncated: boolean;
  durationMs: number;
  requestSha256: string;
  workerSha256: string;
  resultSha256: string;
}

interface RegisteredJavascriptKernel {
  threadId: string;
  runId: string;
}

export class JavascriptKernelManager {
  private readonly registrations = new Map<
    string,
    RegisteredJavascriptKernel
  >();

  constructor(private readonly processes: WorkspaceProcessManager) {}

  async start(request: {
    threadId: string;
    runId: string;
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceProcessSession> {
    const timeoutMs =
      request.timeoutMs ?? DEFAULT_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS;
    validateSessionTimeout(timeoutMs);
    const session = await this.processes.startPrivateProtocol({
      threadId: request.threadId,
      runId: request.runId,
      command: {
        runtime: "node",
        args: [...JAVASCRIPT_KERNEL_WORKER_ARGUMENTS],
        ...(request.cwd ? { cwd: request.cwd } : {}),
        timeoutMs,
      },
      interactive: true,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    this.registrations.set(session.id, {
      threadId: request.threadId,
      runId: request.runId,
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
  }): Promise<JavascriptKernelEvaluation> {
    const timeoutMs =
      request.timeoutMs ?? DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS;
    await validateEvaluation(request.code, timeoutMs);
    const registration = this.requireRegistration(request);
    const session = (await this.processes.list(request.threadId)).find(
      (candidate) => candidate.id === request.processId,
    );
    if (
      !session ||
      session.status !== "running" ||
      session.runId !== registration.runId
    ) {
      this.registrations.delete(request.processId);
      throw new Error("JavaScript kernel is not running");
    }
    const requestId = createId("kernelrequest");
    const input = {
      kind: "napier.javascript-kernel-request" as const,
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
        requestSha256,
        workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
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
        requestSha256,
        workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
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
  }): RegisteredJavascriptKernel {
    const registration = this.registrations.get(request.processId);
    if (
      !registration ||
      registration.threadId !== request.threadId ||
      registration.runId !== request.runId
    ) {
      throw new Error(
        "JavaScript kernel does not belong to the current Thread and Run",
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
  }): Promise<JavascriptKernelProtocolResult> {
    const deadline = Date.now() + request.timeoutMs + 1_000;
    let cursor = request.afterCursor;
    let buffer = "";
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
        if (chunk.stream !== "stdout") continue;
        buffer += chunk.text;
        if (buffer.length > MAX_JAVASCRIPT_KERNEL_PROTOCOL_CHARS) {
          throw new Error(
            "JavaScript kernel protocol output exceeded its limit",
          );
        }
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const result = parseJavascriptKernelResult(line, request.requestId);
          if (result) return result;
          newline = buffer.indexOf("\n");
        }
      }
      if (output.status !== "running" && !output.hasMore) {
        throw new Error(
          "JavaScript kernel exited before returning an evaluation result",
        );
      }
    }
    throw new Error("JavaScript kernel evaluation timed out");
  }
}

async function validateEvaluation(
  code: string,
  timeoutMs: number,
): Promise<void> {
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    Buffer.from(code, "utf8").toString("utf8") !== code ||
    Buffer.byteLength(code, "utf8") > MAX_JAVASCRIPT_KERNEL_CODE_BYTES
  ) {
    throw new Error(
      `JavaScript kernel code must be 1-${MAX_JAVASCRIPT_KERNEL_CODE_BYTES} UTF-8 bytes`,
    );
  }
  if (await containsDynamicImport(code)) {
    throw new Error("JavaScript kernel dynamic import is unavailable");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS
  ) {
    throw new Error(
      `JavaScript kernel timeoutMs must be 1-${MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS}`,
    );
  }
}

async function containsDynamicImport(code: string): Promise<boolean> {
  const { default: ts } = await import("typescript");
  const source = ts.createSourceFile(
    "napier-kernel.js",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const pending: Array<import("typescript").Node> = [source];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      return true;
    }
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  return false;
}

function validateSessionTimeout(timeoutMs: number): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS ||
    timeoutMs > MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS
  ) {
    throw new Error(
      `JavaScript kernel session timeoutMs must be ${MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS}-${MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS}`,
    );
  }
}
