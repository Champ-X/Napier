import type { WorkspaceProcessSession } from "@napier/contracts";

import {
  DapMessageDecoder,
  encodeDapRequest,
  type DapEvent,
  type DapMessage,
  type DapRequest,
  type DapResponse,
} from "./dap-protocol.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_NODE_DEBUG_OUTPUT_CHARS,
  MAX_NODE_DEBUG_OUTPUT_ENTRIES,
  MAX_NODE_DEBUG_SOURCE_BYTES,
  NODE_DEBUGGER_PROTOCOL_FAILURE_MARKER,
  NODE_DEBUGGER_WORKER_FAILURE_MARKER,
  NODE_DEBUGGER_WORKER_SHA256,
} from "./node-debugger-worker.js";
import {
  DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
  DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS,
  NodeDebuggerRequestError,
  parseEvaluation,
  parseModuleSnapshot,
  parseScopes,
  parseStackFrames,
  parseVariables,
  type NodeDebugBreakpoint,
  type NodeDebuggerActionResult,
  type NodeDebugSessionState,
  type NodeDebugStackFrame,
  validateActionTimeout,
  validateArguments,
  validateBreakpointLines,
  validateBreakpointResponse,
  validateBreakpoints,
  validateExpression,
  validateInitializeResponse,
  validateLaunchResponse,
  validateSessionTimeout,
} from "./node-debugger-model.js";
import {
  createNodeDebuggerProtocolSourceBinding,
  nodeDebuggerLaunchArguments,
} from "./node-debugger-protocol-path-binding.js";
import {
  assertNodeDebuggerSourceBindingCurrent,
  loadNodeDebuggerSourceBinding,
} from "./node-debugger-source-binding.js";
import type { NodeDebuggerProcessManager } from "./node-debugger-process.js";
import { startBoundNodeDebuggerProcess } from "./node-debugger-runtime-launch.js";
import { MAX_WORKSPACE_PROCESS_POLL_WAIT_MS } from "./workspace-processes.js";
import type { WorkspaceSourceFile } from "./workspace-source.js";

export {
  DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
  DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS,
  MAX_NODE_DEBUG_ACTION_TIMEOUT_MS,
  MAX_NODE_DEBUG_SESSION_TIMEOUT_MS,
  MIN_NODE_DEBUG_SESSION_TIMEOUT_MS,
} from "./node-debugger-model.js";
export type {
  NodeDebugBreakpoint,
  NodeDebugEvaluation,
  NodeDebuggerActionResult,
  NodeDebugScope,
  NodeDebugSessionState,
  NodeDebugStackFrame,
  NodeDebugVariable,
} from "./node-debugger-model.js";

const AUTH = /^[a-f0-9]{32}$/u;

interface RegisteredNodeDebugger {
  threadId: string;
  runId: string;
  source: WorkspaceSourceFile;
  program: WorkspaceSourceFile;
  sourceMap?: WorkspaceSourceFile;
  breakpointCount: number;
  processId: string;
  state: NodeDebugSessionState;
  reason?: string;
  exitCode?: number;
  nodeVersion: string;
  runtimeExecutableSha256: string;
  runtimeIdentitySha256: string;
  runtimeCommandSha256: string;
  cursor: number;
  requestSequence: number;
  decoder: DapMessageDecoder;
  inbox: DapMessage[];
  auth?: string;
  busy: boolean;
  stderrBuffer: string;
  output: Array<{ category: "stdout" | "stderr" | "console"; text: string }>;
  outputChars: number;
  outputTruncated: boolean;
  moduleCount: number;
  moduleSetSha256: string;
}

interface DapOperationEvidence {
  written: boolean;
  requestHashes: string[];
  responseHashes: string[];
  eventHashes: string[];
}

export class NodeDebuggerManager {
  private readonly registrations = new Map<string, RegisteredNodeDebugger>();

  constructor(
    private readonly processes: NodeDebuggerProcessManager,
    private readonly workspaceRoot: string,
  ) {}

  async launch(request: {
    threadId: string;
    runId: string;
    path: string;
    programPath?: string;
    sourceMapPath?: string;
    breakpoints: NodeDebugBreakpoint[];
    args?: string[];
    pauseOnExceptions?: "none" | "uncaught" | "all";
    sessionTimeoutMs?: number;
    actionTimeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<NodeDebuggerActionResult> {
    const sessionTimeoutMs =
      request.sessionTimeoutMs ?? DEFAULT_NODE_DEBUG_SESSION_TIMEOUT_MS;
    const actionTimeoutMs =
      request.actionTimeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS;
    validateSessionTimeout(sessionTimeoutMs);
    validateActionTimeout(actionTimeoutMs);
    validateBreakpoints(request.breakpoints);
    validateArguments(request.args ?? []);
    const { source, program, sourceMap } = await loadNodeDebuggerSourceBinding({
      workspaceRoot: this.workspaceRoot,
      path: request.path,
      ...(request.programPath ? { programPath: request.programPath } : {}),
      ...(request.sourceMapPath
        ? { sourceMapPath: request.sourceMapPath }
        : {}),
      maxBytes: MAX_NODE_DEBUG_SOURCE_BYTES,
    });
    validateBreakpointLines(request.breakpoints, source.source);
    const { session, runtime } = await startBoundNodeDebuggerProcess({
      processes: this.processes,
      threadId: request.threadId,
      runId: request.runId,
      sessionTimeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const protocol = createNodeDebuggerProtocolSourceBinding(
      { source, program, ...(sourceMap ? { sourceMap } : {}) },
      runtime.protocolWorkspaceRoot,
    );
    const registration: RegisteredNodeDebugger = {
      threadId: request.threadId,
      runId: request.runId,
      source,
      program,
      ...(sourceMap ? { sourceMap } : {}),
      breakpointCount: request.breakpoints.length,
      processId: session.id,
      state: "starting",
      nodeVersion: runtime.nodeVersion,
      runtimeExecutableSha256: session.executableSha256,
      runtimeIdentitySha256: runtime.runtimeIdentitySha256,
      runtimeCommandSha256: session.commandSha256,
      cursor: session.nextCursor,
      requestSequence: 1,
      decoder: new DapMessageDecoder(),
      inbox: [],
      busy: true,
      stderrBuffer: "",
      output: [],
      outputChars: 0,
      outputTruncated: false,
      moduleCount: 0,
      moduleSetSha256: sha256(canonicalJson([])),
    };
    this.registrations.set(session.id, registration);
    const evidence = operationEvidence();
    try {
      const initialize = await this.sendRequest(
        registration,
        "initialize",
        {
          clientID: "napier",
          clientName: "Napier",
          adapterID: "napier-node",
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsVariableType: true,
          supportsVariablePaging: false,
          supportsRunInTerminalRequest: false,
        },
        actionTimeoutMs,
        evidence,
        request.signal,
        true,
      );
      validateInitializeResponse(initialize.body);
      const launched = await this.sendRequest(
        registration,
        "launch",
        nodeDebuggerLaunchArguments({
          binding: { source, program, ...(sourceMap ? { sourceMap } : {}) },
          protocol,
          args: request.args ?? [],
        }),
        actionTimeoutMs,
        evidence,
        request.signal,
      );
      registration.nodeVersion = validateLaunchResponse(
        launched.body,
        source,
        program,
        sourceMap,
        runtime.nodeVersion,
      );
      await this.sendRequest(
        registration,
        "setExceptionBreakpoints",
        {
          filters:
            request.pauseOnExceptions === "all"
              ? ["all"]
              : request.pauseOnExceptions === "none"
                ? []
                : ["uncaught"],
        },
        actionTimeoutMs,
        evidence,
        request.signal,
      );
      const breakpointResponse = await this.sendRequest(
        registration,
        "setBreakpoints",
        {
          source: { path: source.path },
          breakpoints: request.breakpoints.map((breakpoint) => ({
            line: breakpoint.line,
            ...(breakpoint.column ? { column: breakpoint.column } : {}),
          })),
        },
        actionTimeoutMs,
        evidence,
        request.signal,
      );
      validateBreakpointResponse(breakpointResponse.body, request.breakpoints);
      await this.sendRequest(
        registration,
        "configurationDone",
        {},
        actionTimeoutMs,
        evidence,
        request.signal,
      );
      registration.state = "running";
      await this.waitForPauseOrTermination(
        registration,
        actionTimeoutMs,
        evidence,
        request.signal,
      );
      const frames = isPaused(registration)
        ? await this.requestStack(
            registration,
            actionTimeoutMs,
            evidence,
            request.signal,
          )
        : [];
      return await this.result(registration, "launch", { frames }, evidence);
    } catch (error) {
      await this.cancelProcess(registration).catch(() => undefined);
      throw error;
    } finally {
      registration.busy = false;
    }
  }

  async stackTrace(
    request: DebugSessionRequest,
  ): Promise<NodeDebuggerActionResult> {
    return this.withOperation(
      request,
      "stack_trace",
      async (registration, evidence) => ({
        frames: await this.requestStack(
          registration,
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
        ),
      }),
    );
  }

  async scopes(
    request: DebugSessionRequest & { frameId: number },
  ): Promise<NodeDebuggerActionResult> {
    return this.withOperation(
      request,
      "scopes",
      async (registration, evidence) => {
        requirePaused(registration);
        const response = await this.sendRequest(
          registration,
          "scopes",
          { frameId: request.frameId },
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
        );
        return { scopes: parseScopes(response.body) };
      },
    );
  }

  async variables(
    request: DebugSessionRequest & { variablesReference: number },
  ): Promise<NodeDebuggerActionResult> {
    return this.withOperation(
      request,
      "variables",
      async (registration, evidence) => {
        requirePaused(registration);
        const response = await this.sendRequest(
          registration,
          "variables",
          { variablesReference: request.variablesReference },
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
        );
        return parseVariables(response.body);
      },
    );
  }

  async evaluate(
    request: DebugSessionRequest & { frameId: number; expression: string },
  ): Promise<NodeDebuggerActionResult> {
    validateExpression(request.expression);
    return this.withOperation(
      request,
      "evaluate",
      async (registration, evidence) => {
        requirePaused(registration);
        const response = await this.sendRequest(
          registration,
          "evaluate",
          {
            frameId: request.frameId,
            expression: request.expression,
            context: "watch",
          },
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
          false,
          true,
        );
        return {
          evaluation: response.success
            ? parseEvaluation(response.body)
            : {
                status: "error" as const,
                result:
                  response.message ??
                  "Expression could not be evaluated without side effects",
                type: "error",
                variablesReference: 0,
              },
        };
      },
    );
  }

  async resume(
    request: DebugSessionRequest & {
      action: "continue" | "next" | "step_in" | "step_out";
    },
  ): Promise<NodeDebuggerActionResult> {
    return this.withOperation(
      request,
      request.action,
      async (registration, evidence) => {
        requirePaused(registration);
        const command =
          request.action === "step_in"
            ? "stepIn"
            : request.action === "step_out"
              ? "stepOut"
              : request.action;
        await this.sendRequest(
          registration,
          command,
          command === "continue" ? { threadId: 1 } : { threadId: 1 },
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
        );
        registration.state = "running";
        await this.waitForPauseOrTermination(
          registration,
          request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          request.signal,
        );
        return {
          frames: isPaused(registration)
            ? await this.requestStack(
                registration,
                request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
                evidence,
                request.signal,
              )
            : [],
        };
      },
    );
  }

  async cancel(
    request: Omit<DebugSessionRequest, "timeoutMs" | "signal">,
  ): Promise<NodeDebuggerActionResult> {
    const registration = this.requireRegistration(request);
    if (registration.busy) {
      throw new NodeDebuggerRequestError(
        "Node debugger is already processing an action",
      );
    }
    registration.busy = true;
    const evidence = operationEvidence();
    try {
      if (registration.state !== "terminated") {
        await this.sendRequest(
          registration,
          "disconnect",
          { restart: false, terminateDebuggee: true },
          DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
          evidence,
          undefined,
          false,
          true,
        ).catch(() => undefined);
      }
      const session = await this.cancelProcess(registration);
      return this.result(
        registration,
        "cancel",
        { processStatus: session.status },
        evidence,
      );
    } finally {
      registration.busy = false;
    }
  }

  async cancelRun(request: { threadId: string; runId: string }): Promise<void> {
    const registrations = [...this.registrations.values()].filter(
      (registration) =>
        registration.threadId === request.threadId &&
        registration.runId === request.runId,
    );
    const settlements = await Promise.allSettled(
      registrations.map((registration) => this.cancelProcess(registration)),
    );
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  private async withOperation(
    request: DebugSessionRequest,
    action: NodeDebuggerActionResult["action"],
    operation: (
      registration: RegisteredNodeDebugger,
      evidence: DapOperationEvidence,
    ) => Promise<Partial<NodeDebuggerActionResult>>,
  ): Promise<NodeDebuggerActionResult> {
    validateActionTimeout(
      request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
    );
    const registration = this.requireRegistration(request);
    if (registration.busy) {
      throw new NodeDebuggerRequestError(
        "Node debugger is already processing an action",
      );
    }
    if (registration.state === "terminated") {
      throw new NodeDebuggerRequestError("Node debugger has terminated");
    }
    registration.busy = true;
    const evidence = operationEvidence();
    try {
      await assertNodeDebuggerSourceBindingCurrent(
        registration,
        MAX_NODE_DEBUG_SOURCE_BYTES,
      );
      requirePaused(registration);
      const moduleSnapshot = parseModuleSnapshot(
        (
          await this.sendRequest(
            registration,
            "napierVerifyModules",
            {},
            request.timeoutMs ?? DEFAULT_NODE_DEBUG_ACTION_TIMEOUT_MS,
            evidence,
            request.signal,
          )
        ).body,
      );
      registration.moduleCount = moduleSnapshot.moduleCount;
      registration.moduleSetSha256 = moduleSnapshot.moduleSetSha256;
      const values = await operation(registration, evidence);
      return await this.result(registration, action, values, evidence);
    } catch (error) {
      if (!(error instanceof NodeDebuggerRequestError)) {
        await this.cancelProcess(registration).catch(() => undefined);
      }
      throw error;
    } finally {
      registration.busy = false;
    }
  }

  private requireRegistration(request: {
    threadId: string;
    runId: string;
    processId: string;
  }): RegisteredNodeDebugger {
    const registration = this.registrations.get(request.processId);
    if (
      !registration ||
      registration.threadId !== request.threadId ||
      registration.runId !== request.runId
    ) {
      throw new NodeDebuggerRequestError(
        "Node debugger does not belong to the current Thread and Run",
      );
    }
    return registration;
  }

  private async requestStack(
    registration: RegisteredNodeDebugger,
    timeoutMs: number,
    evidence: DapOperationEvidence,
    signal?: AbortSignal,
  ): Promise<NodeDebugStackFrame[]> {
    requirePaused(registration);
    const response = await this.sendRequest(
      registration,
      "stackTrace",
      { threadId: 1, startFrame: 0, levels: 32 },
      timeoutMs,
      evidence,
      signal,
    );
    return parseStackFrames(response.body);
  }

  private async sendRequest(
    registration: RegisteredNodeDebugger,
    command: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    evidence: DapOperationEvidence,
    signal?: AbortSignal,
    bootstrapAuth = false,
    allowFailure = false,
  ): Promise<DapResponse> {
    if (signal?.aborted) throw new Error("Node debugger action was aborted");
    const request: DapRequest = {
      seq: registration.requestSequence++,
      type: "request",
      command,
      arguments: args,
    };
    evidence.requestHashes.push(sha256(canonicalJson(request)));
    const encoded = encodeDapRequest(request);
    await this.processes.writePrivateProtocolInput({
      threadId: registration.threadId,
      runId: registration.runId,
      processId: registration.processId,
      text: encoded,
      appendNewline: false,
      initiatedBy: "agent",
      ...(signal ? { signal } : {}),
    });
    evidence.written = true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.nextMessage(
        registration,
        deadline,
        bootstrapAuth,
        signal,
      );
      if (message.type === "event") {
        evidence.eventHashes.push(sha256(canonicalJson(message)));
        this.applyEvent(registration, message);
        continue;
      }
      if (message.request_seq !== request.seq || message.command !== command) {
        throw new Error("DAP response does not match the active request");
      }
      evidence.responseHashes.push(sha256(canonicalJson(message)));
      if (!message.success && !allowFailure) {
        throw new NodeDebuggerRequestError(
          message.message ?? "Node debugger request failed",
        );
      }
      return message;
    }
    throw new Error("Node debugger action timed out");
  }

  private async waitForPauseOrTermination(
    registration: RegisteredNodeDebugger,
    timeoutMs: number,
    evidence: DapOperationEvidence,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      registration.state === "paused" ||
      registration.state === "terminated"
    ) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.nextMessage(
        registration,
        deadline,
        false,
        signal,
      );
      if (message.type !== "event") {
        throw new Error("DAP emitted an unexpected response");
      }
      evidence.eventHashes.push(sha256(canonicalJson(message)));
      this.applyEvent(registration, message);
      if (isPausedOrTerminated(registration)) {
        return;
      }
    }
    throw new Error("Node debugger action timed out");
  }

  private async nextMessage(
    registration: RegisteredNodeDebugger,
    deadline: number,
    bootstrapAuth: boolean,
    signal?: AbortSignal,
  ): Promise<DapMessage> {
    const queued = registration.inbox.shift();
    if (queued) return queued;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const output = await this.processes.outputPrivateProtocol(
        registration.threadId,
        registration.processId,
        {
          afterCursor: registration.cursor,
          waitMs: Math.min(
            MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
            Math.max(0, remaining),
          ),
          ...(signal ? { signal } : {}),
        },
      );
      registration.cursor = output.nextCursor;
      for (const chunk of output.chunks) {
        if (chunk.stream === "stderr") {
          registration.stderrBuffer = (
            registration.stderrBuffer + chunk.text
          ).slice(-128);
          if (
            registration.stderrBuffer.includes(
              NODE_DEBUGGER_PROTOCOL_FAILURE_MARKER,
            ) ||
            registration.stderrBuffer.includes(
              NODE_DEBUGGER_WORKER_FAILURE_MARKER,
            )
          ) {
            throw new Error("Node debugger adapter failed");
          }
          continue;
        }
        const messages = registration.decoder.push(chunk.text);
        for (const message of messages) {
          registration.inbox.push(
            authenticateMessage(registration, message, bootstrapAuth),
          );
        }
      }
      const message = registration.inbox.shift();
      if (message) return message;
      if (output.status !== "running" && !output.hasMore) {
        throw new Error(
          "Node debugger adapter exited before completing the action",
        );
      }
    }
    throw new Error("Node debugger action timed out");
  }

  private applyEvent(
    registration: RegisteredNodeDebugger,
    message: DapEvent,
  ): void {
    const body = message.body ?? {};
    switch (message.event) {
      case "initialized":
        return;
      case "napierModuleSnapshot": {
        const moduleSnapshot = parseModuleSnapshot(body);
        registration.moduleCount = moduleSnapshot.moduleCount;
        registration.moduleSetSha256 = moduleSnapshot.moduleSetSha256;
        return;
      }
      case "output": {
        const category = body["category"];
        const text = body["output"];
        const truncated = body["napierTruncated"];
        if (
          (category !== "stdout" &&
            category !== "stderr" &&
            category !== "console") ||
          typeof text !== "string" ||
          (truncated !== undefined &&
            (truncated !== true || category !== "console"))
        ) {
          throw new Error("DAP output event is invalid");
        }
        if (truncated === true) registration.outputTruncated = true;
        const remaining =
          MAX_NODE_DEBUG_OUTPUT_CHARS - registration.outputChars;
        if (
          registration.output.length >= MAX_NODE_DEBUG_OUTPUT_ENTRIES ||
          remaining <= 0
        ) {
          registration.outputTruncated = true;
          return;
        }
        const accepted = text.slice(0, remaining);
        registration.output.push({ category, text: accepted });
        registration.outputChars += accepted.length;
        if (accepted.length < text.length) registration.outputTruncated = true;
        return;
      }
      case "stopped": {
        const reason = body["reason"];
        if (
          reason !== "breakpoint" &&
          reason !== "exception" &&
          reason !== "pause" &&
          reason !== "step"
        ) {
          throw new Error("DAP stopped event is invalid");
        }
        registration.state = "paused";
        registration.reason = reason;
        return;
      }
      case "continued":
        registration.state = "running";
        delete registration.reason;
        return;
      case "exited":
        if (!Number.isSafeInteger(body["exitCode"])) {
          throw new Error("DAP exited event is invalid");
        }
        registration.exitCode = Number(body["exitCode"]);
        return;
      case "terminated":
        registration.state = "terminated";
        delete registration.reason;
        return;
      default:
        throw new Error(`DAP event is unsupported: ${message.event}`);
    }
  }

  private async result(
    registration: RegisteredNodeDebugger,
    action: NodeDebuggerActionResult["action"],
    values: Partial<NodeDebuggerActionResult>,
    evidence: DapOperationEvidence,
  ): Promise<NodeDebuggerActionResult> {
    const frames = values.frames ?? [];
    const scopes = values.scopes ?? [];
    const variables = values.variables ?? [];
    const outputs = registration.output.splice(0);
    registration.outputChars = 0;
    const processStatus =
      values.processStatus ??
      (registration.state === "terminated"
        ? (
            await this.processes.cancel(
              registration.threadId,
              registration.processId,
            )
          ).status
        : "running");
    if (registration.state === "terminated") {
      this.registrations.delete(registration.processId);
    }
    const base = {
      action,
      processId: registration.processId,
      state: registration.state,
      processStatus,
      ...(registration.reason ? { reason: registration.reason } : {}),
      ...(registration.exitCode !== undefined
        ? { exitCode: registration.exitCode }
        : {}),
      sourcePathSha256: registration.source.pathSha256,
      sourceSha256: registration.source.fileSha256,
      sourceBytes: registration.source.fileBytes,
      sourceMapMode: registration.sourceMap ? "external" : "none",
      programPathSha256: registration.program.pathSha256,
      programSha256: registration.program.fileSha256,
      programBytes: registration.program.fileBytes,
      ...(registration.sourceMap
        ? {
            sourceMapPathSha256: registration.sourceMap.pathSha256,
            sourceMapSha256: registration.sourceMap.fileSha256,
            sourceMapBytes: registration.sourceMap.fileBytes,
          }
        : {}),
      moduleCount: registration.moduleCount,
      moduleSetSha256: registration.moduleSetSha256,
      breakpointCount: registration.breakpointCount,
      frameCount: frames.length,
      frameSetSha256: sha256(canonicalJson(frames)),
      scopeCount: scopes.length,
      scopeSetSha256: sha256(canonicalJson(scopes)),
      variableCount: variables.length,
      variableSetSha256: sha256(canonicalJson(variables)),
      variablesTruncated: values.variablesTruncated ?? false,
      evaluationSha256: sha256(canonicalJson(values.evaluation ?? null)),
      outputCount: outputs.length,
      outputSetSha256: sha256(canonicalJson(outputs)),
      outputTruncated:
        registration.outputTruncated || values.outputTruncated === true,
      nodeVersion: registration.nodeVersion,
      workerSha256: NODE_DEBUGGER_WORKER_SHA256,
      runtimeExecutableSha256: registration.runtimeExecutableSha256,
      runtimeIdentitySha256: registration.runtimeIdentitySha256,
      runtimeCommandSha256: registration.runtimeCommandSha256,
      dapRequestSequenceSha256: sha256(canonicalJson(evidence.requestHashes)),
      dapResponseSequenceSha256: sha256(canonicalJson(evidence.responseHashes)),
      dapEventSequenceSha256: sha256(canonicalJson(evidence.eventHashes)),
    };
    const evaluation = values.evaluation;
    return {
      action,
      processId: registration.processId,
      state: registration.state,
      processStatus,
      ...(registration.reason ? { reason: registration.reason } : {}),
      ...(registration.exitCode !== undefined
        ? { exitCode: registration.exitCode }
        : {}),
      sourcePath: registration.source.path,
      sourcePathSha256: registration.source.pathSha256,
      sourceSha256: registration.source.fileSha256,
      sourceBytes: registration.source.fileBytes,
      sourceMapMode: registration.sourceMap ? "external" : "none",
      programPath: registration.program.path,
      programPathSha256: registration.program.pathSha256,
      programSha256: registration.program.fileSha256,
      programBytes: registration.program.fileBytes,
      ...(registration.sourceMap
        ? {
            sourceMapPath: registration.sourceMap.path,
            sourceMapPathSha256: registration.sourceMap.pathSha256,
            sourceMapSha256: registration.sourceMap.fileSha256,
            sourceMapBytes: registration.sourceMap.fileBytes,
          }
        : {}),
      moduleCount: registration.moduleCount,
      moduleSetSha256: registration.moduleSetSha256,
      breakpointCount: registration.breakpointCount,
      frames,
      scopes,
      variables,
      variablesTruncated: values.variablesTruncated ?? false,
      ...(evaluation ? { evaluation } : {}),
      output: outputs,
      outputTruncated: base.outputTruncated,
      nodeVersion: registration.nodeVersion,
      workerSha256: NODE_DEBUGGER_WORKER_SHA256,
      runtimeExecutableSha256: registration.runtimeExecutableSha256,
      runtimeIdentitySha256: registration.runtimeIdentitySha256,
      runtimeCommandSha256: registration.runtimeCommandSha256,
      dapRequestSequenceSha256: base.dapRequestSequenceSha256,
      dapResponseSequenceSha256: base.dapResponseSequenceSha256,
      dapEventSequenceSha256: base.dapEventSequenceSha256,
      resultSha256: sha256(canonicalJson(base)),
    };
  }

  private async cancelProcess(
    registration: RegisteredNodeDebugger,
  ): Promise<WorkspaceProcessSession> {
    try {
      return await this.processes.cancel(
        registration.threadId,
        registration.processId,
      );
    } finally {
      registration.state = "terminated";
      this.registrations.delete(registration.processId);
    }
  }
}

interface DebugSessionRequest {
  threadId: string;
  runId: string;
  processId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function authenticateMessage(
  registration: RegisteredNodeDebugger,
  message: DapMessage,
  bootstrap: boolean,
): DapMessage {
  const body = message.body;
  const auth = body?.["napierAuth"];
  if (
    typeof auth !== "string" ||
    !AUTH.test(auth) ||
    (!registration.auth && !bootstrap) ||
    (registration.auth && auth !== registration.auth)
  ) {
    throw new Error("DAP message authentication failed");
  }
  if (!registration.auth) registration.auth = auth;
  const { napierAuth: _napierAuth, ...cleanBody } = body!;
  return {
    ...message,
    body: cleanBody,
  } as DapMessage;
}

function operationEvidence(): DapOperationEvidence {
  return {
    written: false,
    requestHashes: [],
    responseHashes: [],
    eventHashes: [],
  };
}

function requirePaused(registration: RegisteredNodeDebugger): void {
  if (registration.state !== "paused") {
    throw new NodeDebuggerRequestError("Debug target is not paused");
  }
}

function isPaused(registration: RegisteredNodeDebugger): boolean {
  return registration.state === "paused";
}

function isPausedOrTerminated(registration: RegisteredNodeDebugger): boolean {
  return registration.state === "paused" || registration.state === "terminated";
}
