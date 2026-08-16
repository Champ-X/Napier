import { createHash, type Hash } from "node:crypto";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import type {
  WorkspaceProcessDelta,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutput,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackPreview,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessResizeReceipt,
  WorkspaceProcessSession,
  WorkspaceProcessWritePreview,
} from "@napier/contracts";

import type {
  CommandRunnerOptions,
  PreparedCommandExecution,
} from "./command-execution.js";
import type { NodeDebuggerRuntimeIdentity } from "./node-debugger-runtime.js";
import type { SandboxedProcess } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import { WorkspaceProcessLocalServiceLeases } from "./workspace-process-local-service-lease.js";
import { projectActiveWorkspaceProcessSession } from "./workspace-process-runtime-session.js";
import {
  createWorkspaceProcessSession,
  projectWorkspaceProcessRollbackAttempts,
  projectWorkspaceProcessRollbackResults,
  projectWorkspaceProcessSessions,
  WORKSPACE_PROCESS_INPUT_EVENT,
  WORKSPACE_PROCESS_INTERRUPTED_EVENT,
  WORKSPACE_PROCESS_RESIZED_EVENT,
  WORKSPACE_PROCESS_SETTLED_EVENT,
  WORKSPACE_PROCESS_STARTED_EVENT,
  workspaceProcessInputReceiptPayload,
  workspaceProcessSessionPayload,
  workspaceProcessStableSessionInput as stableSessionInput,
} from "./workspace-process-events.js";
import {
  type ResizeWorkspaceProcessRequest,
  type WorkspaceProcessControlEntry,
  WorkspaceProcessControl,
  type WriteWorkspaceProcessInputRequest,
} from "./workspace-process-control.js";
import { reserveWorkspaceProcessStart } from "./workspace-process-admission.js";
import { compensateWorkspaceProcessFailure } from "./workspace-process-auto-compensation.js";
import { WorkspaceProcessRecoveryManager } from "./workspace-process-recovery.js";
import {
  appendWorkspaceProcessRollbackAttempt,
  appendWorkspaceProcessRollbackResult,
} from "./workspace-process-rollback-ledger.js";
import {
  launchWorkspaceProcess,
  type PrivateProtocolWorkspaceProcessLaunchRequest,
  type WorkspaceProcessLaunchRequest,
} from "./workspace-process-launch.js";
import {
  projectWorkspaceProcessDelta,
  projectWorkspaceProcessOutput,
} from "./workspace-process-observation.js";
import type {
  WorkspacePathSnapshot,
  WorkspaceSnapshotDelta,
} from "./workspace-snapshot.js";
import { settleWorkspaceProcessExecution } from "./workspace-process-settlement.js";
import {
  resolveWorkspaceProcessNodeDebuggerRuntime,
  type WorkspaceProcessNodeDebuggerRuntimeOptions,
} from "./workspace-process-node-debugger-runtime.js";
import { workspaceProcessResizeReceiptPayload } from "./workspace-process-resize-events.js";
import { projectInactiveWorkspaceProcessSession } from "./workspace-process-session-projection.js";
import { createInterruptedWorkspaceProcessSession } from "./workspace-process-interrupted-session.js";
import {
  type PreviewWorkspaceProcessWriteRequest,
  type PreparedWorkspaceProcessWrite,
  type StartWorkspaceProcessWriteRequest,
  type WorkspaceProcessWriteRuntimeState,
  WorkspaceProcessWritePreviewManager,
  workspaceProcessWriteRuntimeState,
} from "./workspace-process-write-preview.js";

export const MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD = 4;
export const MAX_ACTIVE_WORKSPACE_PROCESSES = 8;
export const MAX_RETAINED_WORKSPACE_PROCESSES = 64;
export const MAX_WORKSPACE_PROCESS_OUTPUT_CHUNKS = 256;
export const MAX_WORKSPACE_PROCESS_POLL_CHUNKS = 64;
export const MAX_WORKSPACE_PROCESS_POLL_WAIT_MS = 5_000;
export {
  MAX_WORKSPACE_PROCESS_INPUT_BYTES,
  MAX_WORKSPACE_PROCESS_INPUT_WRITES,
  MAX_WORKSPACE_PROCESS_TOTAL_INPUT_BYTES,
} from "./workspace-process-input.js";
type ForcedWorkspaceProcessStatus =
  | "timed_out"
  | "output_capped"
  | "cancelled"
  | "interrupted";

interface StreamCollector {
  completion: Promise<void>;
  decoder: StringDecoder;
  hash: Hash;
  chars: number;
  truncated: boolean;
}

interface ActiveWorkspaceProcess
  extends WorkspaceProcessControlEntry, WorkspaceProcessWriteRuntimeState {
  prepared: PreparedCommandExecution;
  beforeSnapshot: WorkspacePathSnapshot;
  workspaceDelta?: WorkspaceSnapshotDelta;
  chunks: WorkspaceProcessOutputChunk[];
  nextCursor: number;
  stdout: StreamCollector;
  stderr: StreamCollector;
  timeout: ReturnType<typeof setTimeout>;
  forcedStatus?: ForcedWorkspaceProcessStatus;
  compensationPending?: boolean;
  interruptionReason?: string;
  termination?: Promise<void>;
  completion: Promise<void>;
  changeVersion: number;
  changeWaiters: Set<() => void>;
  parentSignal?: AbortSignal;
  parentAbort?: () => void;
}

export interface WorkspaceProcessManagerOptions extends CommandRunnerOptions {
  store: LocalStore;
  dataRoot?: string;
}

export type StartWorkspaceProcessRequest = WorkspaceProcessLaunchRequest;

export interface WorkspaceProcessOutputOptions {
  afterCursor?: number;
  waitMs?: number;
  signal?: AbortSignal;
}

export class WorkspaceProcessManager {
  readonly localServiceLeases: WorkspaceProcessLocalServiceLeases;
  private readonly entries = new Map<string, ActiveWorkspaceProcess>();
  private readonly projectedSessions = new Map<
    string,
    Map<string, WorkspaceProcessSession>
  >();
  private readonly startingByThread = new Map<string, number>();
  private readonly control: WorkspaceProcessControl<ActiveWorkspaceProcess>;
  private readonly writePreviews: WorkspaceProcessWritePreviewManager;
  private readonly recovery?: WorkspaceProcessRecoveryManager;
  private initialized = false;
  private shuttingDown = false;

  constructor(private readonly options: WorkspaceProcessManagerOptions) {
    this.localServiceLeases = new WorkspaceProcessLocalServiceLeases(
      options.store,
    );
    this.writePreviews = new WorkspaceProcessWritePreviewManager(options);
    if (options.dataRoot) {
      this.recovery = new WorkspaceProcessRecoveryManager({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
      });
    }
    this.control = new WorkspaceProcessControl({
      requireSession: (threadId, processId) =>
        this.requireSession(threadId, processId),
      entry: (processId) => this.entries.get(processId),
      notify: (entry) => this.notifyChange(entry),
      interruptUnknown: (entry, reason) =>
        this.forceStop(entry, "interrupted", reason),
      appendInput: (receipt, session) =>
        this.appendInputReceipt(receipt, session),
      appendResize: (receipt, session) =>
        this.appendResizeReceipt(receipt, session),
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.recovery?.initialize();
    this.initialized = true;
    const rollbackAttempts: WorkspaceProcessRollbackAttempt[] = [];
    const rollbackResults: WorkspaceProcessRollbackResult[] = [];
    for (const thread of this.options.store.listThreads()) {
      const events = await this.options.store.listEvents(thread.id);
      const sessions = projectWorkspaceProcessSessions(events);
      rollbackAttempts.push(...projectWorkspaceProcessRollbackAttempts(events));
      rollbackResults.push(...projectWorkspaceProcessRollbackResults(events));
      this.projectedSessions.set(
        thread.id,
        new Map(sessions.map((session) => [session.id, session])),
      );
      for (const session of sessions.filter(
        (candidate) => candidate.status === "running",
      )) {
        const interrupted = createInterruptedWorkspaceProcessSession(session, {
          reason:
            "The Runtime restarted before this Process Session reached a terminal state; its outcome is unknown.",
        });
        await this.appendSession(
          interrupted,
          WORKSPACE_PROCESS_INTERRUPTED_EVENT,
        );
      }
    }
    await this.recovery?.reconcile(
      [...this.projectedSessions.values()].flatMap((sessions) => [
        ...sessions.values(),
      ]),
      rollbackAttempts,
      rollbackResults,
    );
  }

  async start(
    request: StartWorkspaceProcessRequest,
  ): Promise<WorkspaceProcessSession> {
    return this.startProcess(request, false);
  }

  async startPrivateProtocol(
    request: PrivateProtocolWorkspaceProcessLaunchRequest,
  ): Promise<WorkspaceProcessSession> {
    return this.startProcess(request, true);
  }

  async resolveNodeDebuggerRuntime(
    options: WorkspaceProcessNodeDebuggerRuntimeOptions = {},
  ): Promise<NodeDebuggerRuntimeIdentity> {
    this.assertReady();
    return resolveWorkspaceProcessNodeDebuggerRuntime(this.options, options);
  }

  async previewWrite(
    request: PreviewWorkspaceProcessWriteRequest,
  ): Promise<WorkspaceProcessWritePreview> {
    this.assertReady();
    this.assertRunOwnership(request.threadId, request.runId);
    return this.writePreviews.preview(request);
  }

  async startWrite(
    request: StartWorkspaceProcessWriteRequest,
  ): Promise<WorkspaceProcessSession> {
    return this.startProcess(
      this.writePreviews.startRequest(request),
      false,
      request.previewId,
    );
  }

  async previewRollback(
    threadId: string,
    processId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceProcessRollbackPreview> {
    this.assertReady();
    if (!this.recovery) {
      throw new Error(
        "Workspace Process rollback requires the managed local Runtime",
      );
    }
    const session = await this.requireSession(threadId, processId);
    return this.recovery.preview(session, signal);
  }

  async rollback(
    threadId: string,
    processId: string,
    previewId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceProcessRollbackResult> {
    this.assertReady();
    if (!this.recovery) {
      throw new Error(
        "Workspace Process rollback requires the managed local Runtime",
      );
    }
    const session = await this.requireSession(threadId, processId);
    return this.recovery.apply({
      session,
      previewId,
      ...(signal ? { signal } : {}),
      recordAttempt: (attempt) =>
        appendWorkspaceProcessRollbackAttempt(this.options.store, attempt),
      recordResult: (result) =>
        appendWorkspaceProcessRollbackResult(this.options.store, result),
    });
  }

  private async startProcess(
    request:
      | StartWorkspaceProcessRequest
      | PrivateProtocolWorkspaceProcessLaunchRequest,
    privateProtocol: boolean,
    writePreviewId?: string,
  ): Promise<WorkspaceProcessSession> {
    this.assertReady();
    this.assertRunOwnership(request.threadId, request.runId);
    const releaseAdmission = reserveWorkspaceProcessStart({
      sessions: [...this.entries.values()].map((entry) => entry.session),
      startingByThread: this.startingByThread,
      threadId: request.threadId,
      maximumGlobal: MAX_ACTIVE_WORKSPACE_PROCESSES,
      maximumPerThread: MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD,
    });
    let launched: Awaited<ReturnType<typeof launchWorkspaceProcess>>;
    try {
      launched = await launchWorkspaceProcess({
        request,
        privateProtocol,
        ...(writePreviewId ? { writePreviewId } : {}),
        options: this.options,
        writePreviews: this.writePreviews,
        ...(this.recovery ? { recovery: this.recovery } : {}),
        shuttingDown: () => this.shuttingDown,
      });
    } finally {
      releaseAdmission();
    }
    const { session, prepared, beforeSnapshot, child, write, writeLock } =
      launched;
    const processId = session.id;
    const entry = this.createEntry(
      session,
      prepared,
      beforeSnapshot,
      child,
      privateProtocol,
      request.signal,
      write,
      writeLock,
    );
    this.entries.set(processId, entry);
    try {
      await this.appendSession(session, WORKSPACE_PROCESS_STARTED_EVENT);
      await this.localServiceLeases.started(session);
    } catch (error) {
      this.entries.delete(processId);
      await this.localServiceLeases.ended(session, "start_failed");
      await child.terminate().catch(() => undefined);
      await this.recovery?.remove(processId);
      await writeLock?.release();
      throw error;
    }
    entry.timeout = setTimeout(() => {
      this.forceStop(
        entry,
        "timed_out",
        "The Process Session exceeded its wall-time budget.",
      );
    }, prepared.timeoutMs);
    entry.completion = this.monitor(entry).catch(async () => {
      this.failEntryInMemory(entry);
      await this.appendSession(
        entry.session,
        WORKSPACE_PROCESS_INTERRUPTED_EVENT,
      ).catch(() => undefined);
      await this.recovery?.remove(entry.session.id);
      await entry.writeLock?.release();
    });
    return this.runtimeSession(entry);
  }

  async list(threadId: string): Promise<WorkspaceProcessSession[]> {
    this.assertReady();
    this.options.store.getThread(threadId);
    let projection = this.projectedSessions.get(threadId);
    if (!projection) {
      const sessions = projectWorkspaceProcessSessions(
        await this.options.store.listEvents(threadId),
      );
      projection = new Map(sessions.map((session) => [session.id, session]));
      this.projectedSessions.set(threadId, projection);
    }
    const sessions = [...projection.values()].sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
    return sessions.map((session) => {
      const entry = this.entries.get(session.id);
      if (entry) return this.runtimeSession(entry);
      return projectInactiveWorkspaceProcessSession(session, this.recovery);
    });
  }

  async output(
    threadId: string,
    processId: string,
    options: WorkspaceProcessOutputOptions = {},
  ): Promise<WorkspaceProcessOutput> {
    return this.readOutput(threadId, processId, options, false);
  }

  async outputPrivateProtocol(
    threadId: string,
    processId: string,
    options: WorkspaceProcessOutputOptions = {},
  ): Promise<WorkspaceProcessOutput> {
    return this.readOutput(threadId, processId, options, true);
  }

  private async readOutput(
    threadId: string,
    processId: string,
    options: WorkspaceProcessOutputOptions,
    privateProtocolAccess: boolean,
  ): Promise<WorkspaceProcessOutput> {
    this.assertReady();
    const afterCursor = options.afterCursor ?? 0;
    const waitMs = options.waitMs ?? 0;
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) {
      throw new Error("Workspace Process output cursor is invalid");
    }
    if (
      !Number.isSafeInteger(waitMs) ||
      waitMs < 0 ||
      waitMs > MAX_WORKSPACE_PROCESS_POLL_WAIT_MS
    ) {
      throw new Error("Workspace Process poll wait is invalid");
    }
    const session = await this.requireSession(threadId, processId);
    const entry = this.entries.get(processId);
    if (
      entry &&
      entry.session.threadId === threadId &&
      (entry.session.status === "running" ||
        entry.compensationPending === true) &&
      !entry.chunks.some((chunk) => chunk.cursor > afterCursor) &&
      waitMs > 0
    ) {
      await this.waitForChange(entry, waitMs, options.signal);
    }
    const current = entry ? this.runtimeSession(entry) : session;
    if (afterCursor > current.nextCursor) {
      throw new Error(
        "Workspace Process output cursor is ahead of the session",
      );
    }
    return projectWorkspaceProcessOutput({
      session: current,
      ...(entry?.session.threadId === threadId ? { entry } : {}),
      privateProtocolAccess,
      afterCursor,
      maximumChunks: MAX_WORKSPACE_PROCESS_POLL_CHUNKS,
    });
  }

  async delta(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessDelta> {
    this.assertReady();
    const session = await this.requireSession(threadId, processId);
    const entry = this.entries.get(processId);
    return projectWorkspaceProcessDelta(
      entry?.session.threadId === threadId ? entry.session : session,
      entry?.session.threadId === threadId ? entry.workspaceDelta : undefined,
    );
  }

  async writeInput(
    request: WriteWorkspaceProcessInputRequest,
  ): Promise<WorkspaceProcessInputReceipt> {
    return this.control.writeInput(request, false);
  }

  async writePrivateProtocolInput(
    request: WriteWorkspaceProcessInputRequest,
  ): Promise<WorkspaceProcessInputReceipt> {
    return this.control.writeInput(request, true);
  }

  async resize(
    request: ResizeWorkspaceProcessRequest,
  ): Promise<WorkspaceProcessResizeReceipt> {
    this.assertReady();
    return this.control.resize(request);
  }

  async cancel(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessSession> {
    this.assertReady();
    const session = await this.requireSession(threadId, processId);
    const entry = this.entries.get(processId);
    if (
      !entry ||
      entry.session.threadId !== threadId ||
      entry.session.status !== "running"
    ) {
      return session;
    }
    this.forceStop(
      entry,
      "cancelled",
      "The Process Session was cancelled by an operator or Agent.",
    );
    await entry.completion;
    return this.runtimeSession(entry);
  }

  async waitForSettlement(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessSession> {
    const session = await this.requireSession(threadId, processId);
    const entry = this.entries.get(processId);
    if (!entry || entry.session.threadId !== threadId) return session;
    await entry.completion;
    return this.runtimeSession(entry);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const active = [...this.entries.values()].filter(
      (entry) => entry.session.status === "running",
    );
    for (const entry of active) {
      this.forceStop(
        entry,
        "interrupted",
        "The Runtime shut down before this Process Session settled.",
      );
    }
    await Promise.allSettled(active.map((entry) => entry.completion));
    await this.localServiceLeases.revokeAll();
  }

  private createEntry(
    session: WorkspaceProcessSession,
    prepared: PreparedCommandExecution,
    beforeSnapshot: WorkspacePathSnapshot,
    child: SandboxedProcess,
    privateProtocol: boolean,
    parentSignal?: AbortSignal,
    write?: PreparedWorkspaceProcessWrite,
    writeLock?: WorkspaceProcessWriteRuntimeState["writeLock"],
  ): ActiveWorkspaceProcess {
    const entry: ActiveWorkspaceProcess = {
      session,
      prepared,
      beforeSnapshot,
      child,
      privateProtocol,
      chunks: [],
      nextCursor: 0,
      stdout: undefined as unknown as StreamCollector,
      stderr: undefined as unknown as StreamCollector,
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      completion: Promise.resolve(),
      changeVersion: 0,
      changeWaiters: new Set<() => void>(),
      stdinHash: createHash("sha256"),
      controlTail: Promise.resolve(),
      ...(parentSignal ? { parentSignal } : {}),
      ...workspaceProcessWriteRuntimeState(write, writeLock),
    };
    child.stdin.on("error", () => undefined);
    entry.stdout = this.collect(entry, "stdout", child.stdout);
    entry.stderr = this.collect(entry, "stderr", child.stderr);
    if (parentSignal) {
      const parentAbort = (): void => {
        this.forceStop(
          entry,
          "cancelled",
          "The parent Agent Run was cancelled.",
        );
      };
      entry.parentAbort = parentAbort;
      parentSignal.addEventListener("abort", parentAbort, { once: true });
      if (parentSignal.aborted) parentAbort();
    }
    return entry;
  }

  private collect(
    entry: ActiveWorkspaceProcess,
    streamName: "stdout" | "stderr",
    stream: Readable,
  ): StreamCollector {
    const collector: StreamCollector = {
      completion: Promise.resolve(),
      decoder: new StringDecoder("utf8"),
      hash: createHash("sha256"),
      chars: 0,
      truncated: false,
    };
    collector.completion = new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        const trailing = collector.decoder.end();
        if (trailing) this.appendOutput(entry, streamName, collector, trailing);
        resolve();
      };
      stream.on("data", (chunk: Buffer | string) => {
        const text =
          typeof chunk === "string" ? chunk : collector.decoder.write(chunk);
        if (text) this.appendOutput(entry, streamName, collector, text);
      });
      stream.once("end", finish);
      stream.once("close", finish);
      stream.once("error", finish);
    });
    return collector;
  }

  private appendOutput(
    entry: ActiveWorkspaceProcess,
    stream: "stdout" | "stderr",
    collector: StreamCollector,
    text: string,
  ): void {
    if (collector.truncated || entry.session.status !== "running") return;
    const remaining = entry.session.outputLimitChars - collector.chars;
    if (
      remaining <= 0 ||
      entry.chunks.length >= MAX_WORKSPACE_PROCESS_OUTPUT_CHUNKS
    ) {
      collector.truncated = true;
      this.forceStop(
        entry,
        "output_capped",
        "The Process Session exceeded its bounded output budget.",
      );
      return;
    }
    const accepted = text.slice(0, remaining);
    if (accepted) {
      collector.hash.update(accepted);
      collector.chars += accepted.length;
      entry.nextCursor += 1;
      entry.chunks.push({
        cursor: entry.nextCursor,
        stream,
        text: accepted,
      });
      this.notifyChange(entry);
    }
    if (
      accepted.length < text.length ||
      entry.chunks.length >= MAX_WORKSPACE_PROCESS_OUTPUT_CHUNKS
    ) {
      collector.truncated = true;
      this.forceStop(
        entry,
        "output_capped",
        "The Process Session exceeded its bounded output budget.",
      );
    }
  }

  private async monitor(entry: ActiveWorkspaceProcess): Promise<void> {
    const exit = await entry.child.exit;
    await entry.termination;
    await entry.controlTail;
    await Promise.all([entry.stdout.completion, entry.stderr.completion]);
    clearTimeout(entry.timeout);
    entry.parentSignal?.removeEventListener("abort", entry.parentAbort!);
    const settled = await settleWorkspaceProcessExecution({
      session: entry.session,
      prepared: entry.prepared,
      beforeSnapshot: entry.beforeSnapshot,
      ...(entry.relativeWritePaths
        ? { relativeWritePaths: entry.relativeWritePaths }
        : {}),
      ...(entry.forcedStatus ? { forcedStatus: entry.forcedStatus } : {}),
      ...(entry.interruptionReason
        ? { interruptionReason: entry.interruptionReason }
        : {}),
      exit,
      stdoutChars: entry.stdout.chars,
      stderrChars: entry.stderr.chars,
      stdoutSha256: entry.stdout.hash.digest("hex"),
      stderrSha256: entry.stderr.hash.digest("hex"),
      stdoutTruncated: entry.stdout.truncated,
      stderrTruncated: entry.stderr.truncated,
      nextCursor: entry.nextCursor,
    });
    const { session, workspaceDelta } = settled;
    await this.localServiceLeases.ended(session, "process_settled");
    entry.workspaceDelta = workspaceDelta;
    const compensationEligible =
      session.schemaVersion === 7 &&
      session.failureRecovery === "restore_scopes" &&
      session.workspaceDeltaStatus === "changed" &&
      session.workspaceWriteScopeStatus === "within_scope" &&
      session.status !== "succeeded" &&
      session.status !== "interrupted";
    entry.compensationPending = compensationEligible;
    entry.session = session;
    if (!compensationEligible) this.notifyChange(entry);
    await this.appendSession(
      session,
      session.status === "interrupted"
        ? WORKSPACE_PROCESS_INTERRUPTED_EVENT
        : WORKSPACE_PROCESS_SETTLED_EVENT,
    );
    if (compensationEligible) {
      try {
        await compensateWorkspaceProcessFailure({
          recovery: this.recovery!,
          store: this.options.store,
          session,
        }).catch(() => undefined);
      } finally {
        entry.compensationPending = false;
      }
      this.notifyChange(entry);
    }
    if (
      session.workspaceAccess === "scoped_write" &&
      session.schemaVersion >= 6 &&
      session.workspaceDeltaStatus !== "changed"
    ) {
      await this.recovery?.remove(session.id);
    }
    await entry.writeLock?.release();
    this.pruneRetainedEntries();
  }

  private forceStop(
    entry: ActiveWorkspaceProcess,
    status: ForcedWorkspaceProcessStatus,
    reason: string,
  ): void {
    if (
      entry.session.status !== "running" ||
      entry.forcedStatus !== undefined
    ) {
      return;
    }
    entry.forcedStatus = status;
    entry.interruptionReason = reason;
    if (entry.session.schemaVersion >= 3 && entry.session.stdinOpen === true) {
      entry.session = createWorkspaceProcessSession({
        ...stableSessionInput(entry.session),
        schemaVersion: entry.session.schemaVersion,
        status: entry.session.status,
        stdinOpen: false,
      });
    }
    entry.termination = entry.child.terminate();
    this.notifyChange(entry);
  }

  private failEntryInMemory(entry: ActiveWorkspaceProcess): void {
    clearTimeout(entry.timeout);
    entry.parentSignal?.removeEventListener("abort", entry.parentAbort!);
    delete entry.workspaceDelta;
    entry.compensationPending = false;
    entry.session = createInterruptedWorkspaceProcessSession(entry.session, {
      stdoutChars: entry.stdout.chars,
      stderrChars: entry.stderr.chars,
      stdoutTruncated: entry.stdout.truncated,
      stderrTruncated: entry.stderr.truncated,
      nextCursor: entry.nextCursor,
      reason:
        "Process settlement evidence could not be persisted; the outcome is unknown.",
    });
    this.notifyChange(entry);
  }

  private async appendSession(
    session: WorkspaceProcessSession,
    type: string,
  ): Promise<void> {
    await this.appendProjection(session, {
      threadId: session.threadId,
      runId: session.runId,
      type,
      category: "lifecycle",
      visibility: "user",
      payload: workspaceProcessSessionPayload(session),
    });
  }

  private async appendInputReceipt(
    receipt: WorkspaceProcessInputReceipt,
    session: WorkspaceProcessSession,
  ): Promise<void> {
    await this.appendProjection(session, {
      threadId: receipt.threadId,
      runId: receipt.runId,
      type: WORKSPACE_PROCESS_INPUT_EVENT,
      category: "tool",
      visibility: "user",
      payload: workspaceProcessInputReceiptPayload(receipt),
    });
  }

  private async appendResizeReceipt(
    receipt: WorkspaceProcessResizeReceipt,
    session: WorkspaceProcessSession,
  ): Promise<void> {
    await this.appendProjection(session, {
      threadId: receipt.threadId,
      runId: receipt.runId,
      type: WORKSPACE_PROCESS_RESIZED_EVENT,
      category: "tool",
      visibility: "user",
      payload: workspaceProcessResizeReceiptPayload(receipt),
    });
  }

  private async appendProjection(
    session: WorkspaceProcessSession,
    input: Parameters<LocalStore["appendEvent"]>[0],
  ): Promise<void> {
    await this.options.store.appendEvent(input);
    const projection =
      this.projectedSessions.get(session.threadId) ??
      new Map<string, WorkspaceProcessSession>();
    projection.set(session.id, session);
    this.projectedSessions.set(session.threadId, projection);
  }

  private async requireSession(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessSession> {
    const session = (await this.list(threadId)).find(
      (candidate) => candidate.id === processId,
    );
    if (!session) throw new Error("Workspace Process Session not found");
    return session;
  }
  private runtimeSession(
    entry: ActiveWorkspaceProcess,
  ): WorkspaceProcessSession {
    const compensationStatus = entry.compensationPending
      ? "pending"
      : this.recovery?.compensationStatus(entry.session);
    return projectActiveWorkspaceProcessSession({
      session: entry.session,
      nextCursor: entry.nextCursor,
      privateProtocol: entry.privateProtocol,
      workspaceDeltaAvailable: Boolean(entry.workspaceDelta),
      workspaceRollbackAvailable:
        this.recovery?.available(entry.session) === true,
      ...(compensationStatus
        ? { workspaceCompensationStatus: compensationStatus }
        : {}),
    });
  }

  private async waitForChange(
    entry: ActiveWorkspaceProcess,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new Error("workspace process poll was aborted");
    const version = entry.changeVersion;
    await new Promise<void>((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timeout);
        entry.changeWaiters.delete(onChange);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onChange = (): void => {
        if (entry.changeVersion !== version) finish();
      };
      const onAbort = (): void => {
        clearTimeout(timeout);
        entry.changeWaiters.delete(onChange);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("workspace process poll was aborted"));
      };
      const timeout = setTimeout(finish, waitMs);
      entry.changeWaiters.add(onChange);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private notifyChange(entry: ActiveWorkspaceProcess): void {
    entry.changeVersion += 1;
    for (const waiter of [...entry.changeWaiters]) waiter();
  }

  private pruneRetainedEntries(): void {
    if (this.entries.size <= MAX_RETAINED_WORKSPACE_PROCESSES) return;
    const settled = [...this.entries.values()]
      .filter((entry) => entry.session.status !== "running")
      .sort((left, right) =>
        left.session.startedAt.localeCompare(right.session.startedAt),
      );
    while (
      this.entries.size > MAX_RETAINED_WORKSPACE_PROCESSES &&
      settled.length > 0
    ) {
      const oldest = settled.shift();
      if (oldest) this.entries.delete(oldest.session.id);
    }
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error(
        "WorkspaceProcessManager.initialize() must be called first",
      );
    }
  }

  private assertRunOwnership(threadId: string, runId: string): void {
    this.options.store.getThread(threadId);
    const ownsRun = this.options.store
      .listRuns(threadId)
      .some((run) => run.id === runId);
    if (!ownsRun) {
      throw new Error("Workspace Process Run does not belong to the Thread");
    }
  }
}
