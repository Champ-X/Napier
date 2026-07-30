import { createHash, type Hash } from "node:crypto";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import type {
  WorkspaceProcessDelta,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutput,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import {
  assertCommandRuntimeStable,
  MAX_COMMAND_OUTPUT_CHARS,
  prepareCommandExecution,
  type CommandExecutionRequest,
  type CommandRunnerOptions,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import type { SandboxedProcess } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import {
  createWorkspaceProcessSession,
  projectWorkspaceProcessSessions,
  WORKSPACE_PROCESS_INPUT_EVENT,
  WORKSPACE_PROCESS_INTERRUPTED_EVENT,
  WORKSPACE_PROCESS_SETTLED_EVENT,
  WORKSPACE_PROCESS_STARTED_EVENT,
  workspaceProcessInputReceiptPayload,
  workspaceProcessSessionPayload,
  workspaceProcessSessionWithRuntimeState,
} from "./workspace-process-events.js";
import {
  type WorkspaceProcessInput,
  writeWorkspaceProcessInput,
} from "./workspace-process-input.js";
import {
  createWorkspacePathSnapshot,
  diffWorkspaceSnapshots,
  type WorkspacePathSnapshot,
  type WorkspaceSnapshotDelta,
  unavailableWorkspacePathSnapshot,
} from "./workspace-snapshot.js";

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

interface ActiveWorkspaceProcess {
  session: WorkspaceProcessSession;
  prepared: PreparedCommandExecution;
  child: SandboxedProcess;
  privateProtocol: boolean;
  beforeSnapshot: WorkspacePathSnapshot;
  workspaceDelta?: WorkspaceSnapshotDelta;
  chunks: WorkspaceProcessOutputChunk[];
  nextCursor: number;
  stdout: StreamCollector;
  stderr: StreamCollector;
  timeout: ReturnType<typeof setTimeout>;
  forcedStatus?: ForcedWorkspaceProcessStatus;
  interruptionReason?: string;
  termination?: Promise<void>;
  completion: Promise<void>;
  changeVersion: number;
  changeWaiters: Set<() => void>;
  parentSignal?: AbortSignal;
  parentAbort?: () => void;
  stdinHash: Hash;
  inputTail: Promise<void>;
}

export interface WorkspaceProcessManagerOptions extends CommandRunnerOptions {
  store: LocalStore;
}

export interface StartWorkspaceProcessRequest {
  threadId: string;
  runId: string;
  command: CommandExecutionRequest;
  interactive?: boolean;
  signal?: AbortSignal;
}

export interface WriteWorkspaceProcessInputRequest extends WorkspaceProcessInput {
  threadId: string;
  processId: string;
  runId?: string;
  signal?: AbortSignal;
}

export interface WorkspaceProcessOutputOptions {
  afterCursor?: number;
  waitMs?: number;
  signal?: AbortSignal;
}

export class WorkspaceProcessManager {
  private readonly entries = new Map<string, ActiveWorkspaceProcess>();
  private readonly projectedSessions = new Map<
    string,
    Map<string, WorkspaceProcessSession>
  >();
  private readonly startingByThread = new Map<string, number>();
  private initialized = false;
  private shuttingDown = false;

  constructor(private readonly options: WorkspaceProcessManagerOptions) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const thread of this.options.store.listThreads()) {
      const sessions = projectWorkspaceProcessSessions(
        await this.options.store.listEvents(thread.id),
      );
      this.projectedSessions.set(
        thread.id,
        new Map(sessions.map((session) => [session.id, session])),
      );
      for (const session of sessions.filter(
        (candidate) => candidate.status === "running",
      )) {
        const interrupted = createWorkspaceProcessSession({
          schemaVersion: session.schemaVersion,
          ...stableSessionInput(session),
          status: "interrupted",
          ...(session.schemaVersion === 3 ? { stdinOpen: false } : {}),
          settledAt: nowIso(),
          stdoutChars: session.stdoutChars,
          stderrChars: session.stderrChars,
          stdoutTruncated: session.stdoutTruncated,
          stderrTruncated: session.stderrTruncated,
          nextCursor: session.nextCursor,
          interruptionReason:
            "The Runtime restarted before this Process Session reached a terminal state; its outcome is unknown.",
        });
        await this.appendSession(
          interrupted,
          WORKSPACE_PROCESS_INTERRUPTED_EVENT,
        );
      }
    }
  }

  async start(
    request: StartWorkspaceProcessRequest,
  ): Promise<WorkspaceProcessSession> {
    return this.startProcess(request, false);
  }

  async startPrivateProtocol(
    request: StartWorkspaceProcessRequest,
  ): Promise<WorkspaceProcessSession> {
    return this.startProcess(request, true);
  }

  private async startProcess(
    request: StartWorkspaceProcessRequest,
    privateProtocol: boolean,
  ): Promise<WorkspaceProcessSession> {
    this.assertReady();
    if (this.shuttingDown) {
      throw new Error("Workspace Process Manager is shutting down");
    }
    if (request.signal?.aborted) {
      throw new Error("workspace process start was aborted");
    }
    this.options.store.getThread(request.threadId);
    if (
      !this.options.store
        .listRuns(request.threadId)
        .some((run) => run.id === request.runId)
    ) {
      throw new Error("Workspace Process Run does not belong to the Thread");
    }
    const activeCount = [...this.entries.values()].filter(
      (entry) =>
        entry.session.threadId === request.threadId &&
        entry.session.status === "running",
    ).length;
    const startingCount = this.startingByThread.get(request.threadId) ?? 0;
    const activeGlobalCount = [...this.entries.values()].filter(
      (entry) => entry.session.status === "running",
    ).length;
    const startingGlobalCount = [...this.startingByThread.values()].reduce(
      (total, count) => total + count,
      0,
    );
    if (
      activeGlobalCount + startingGlobalCount >=
      MAX_ACTIVE_WORKSPACE_PROCESSES
    ) {
      throw new Error(
        `Runtime already has ${MAX_ACTIVE_WORKSPACE_PROCESSES} active Process Sessions`,
      );
    }
    if (
      activeCount + startingCount >=
      MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD
    ) {
      throw new Error(
        `Thread already has ${MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD} active Process Sessions`,
      );
    }
    this.startingByThread.set(request.threadId, startingCount + 1);
    let prepared: PreparedCommandExecution;
    let beforeSnapshot: WorkspacePathSnapshot;
    let child: SandboxedProcess;
    try {
      prepared = await prepareCommandExecution(this.options, request.command);
      beforeSnapshot = await createWorkspacePathSnapshot(
        prepared.workspaceRoot,
        prepared.workspaceRoot,
      );
      if (this.shuttingDown) {
        throw new Error("Workspace Process Manager is shutting down");
      }
      if (request.signal?.aborted) {
        throw new Error("workspace process start was aborted");
      }
      child = await this.options.sandbox.launch(prepared.launch);
    } finally {
      const remaining = (this.startingByThread.get(request.threadId) ?? 1) - 1;
      if (remaining > 0) {
        this.startingByThread.set(request.threadId, remaining);
      } else {
        this.startingByThread.delete(request.threadId);
      }
    }
    if (this.shuttingDown) {
      await child.terminate().catch(() => undefined);
      throw new Error("Workspace Process Manager is shutting down");
    }
    if (request.interactive !== true) child.stdin.end();
    const processId = createId("process");
    const startedAt = nowIso();
    const session = createWorkspaceProcessSession({
      id: processId,
      threadId: request.threadId,
      runId: request.runId,
      runtime: prepared.runtime,
      status: "running",
      sandbox: prepared.sandboxId,
      workspaceAccess: "read_only",
      networkAccess: "denied",
      argumentCount: prepared.receipt.argumentCount,
      commandSha256: sha256(canonicalJson(prepared.receipt)),
      executableSha256: prepared.executableSha256,
      environmentSha256: prepared.receipt.environmentSha256,
      resourceLimitsSha256: prepared.receipt.resourceLimitsSha256,
      cwdPathSha256: prepared.receipt.cwdPathSha256,
      timeoutMs: prepared.timeoutMs,
      outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
      stdinMode: request.interactive === true ? "interactive" : "closed",
      stdinOpen: request.interactive === true,
      stdinWriteCount: 0,
      stdinBytes: 0,
      stdinSha256: sha256(""),
      workspaceBeforeSha256: beforeSnapshot.sha256,
      workspaceBeforeTruncated: beforeSnapshot.truncated,
      startedAt,
      stdoutChars: 0,
      stderrChars: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      nextCursor: 0,
    });
    const entry = this.createEntry(
      session,
      prepared,
      beforeSnapshot,
      child,
      privateProtocol,
      request.signal,
    );
    this.entries.set(processId, entry);
    try {
      await this.appendSession(session, WORKSPACE_PROCESS_STARTED_EVENT);
    } catch (error) {
      this.entries.delete(processId);
      await child.terminate().catch(() => undefined);
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
      return entry ? this.runtimeSession(entry) : session;
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
    if (entry && entry.privateProtocol !== privateProtocolAccess) {
      if (privateProtocolAccess) {
        throw new Error(
          "Workspace Process Session is not a private protocol session",
        );
      }
      const current = this.runtimeSession(entry);
      if (afterCursor > current.nextCursor) {
        throw new Error(
          "Workspace Process output cursor is ahead of the session",
        );
      }
      return {
        kind: "napier.workspace-process-output",
        schemaVersion: 1,
        processId,
        status: current.status,
        afterCursor,
        nextCursor: current.nextCursor,
        hasMore: false,
        outputAvailable: false,
        chunks: [],
      };
    }
    if (
      entry &&
      entry.session.threadId === threadId &&
      entry.session.status === "running" &&
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
    if (!entry || entry.session.threadId !== threadId) {
      return {
        kind: "napier.workspace-process-output",
        schemaVersion: 1,
        processId,
        status: current.status,
        afterCursor,
        nextCursor: current.nextCursor,
        hasMore: false,
        outputAvailable: false,
        chunks: [],
      };
    }
    const available = entry.chunks.filter(
      (chunk) => chunk.cursor > afterCursor,
    );
    const chunks = available.slice(0, MAX_WORKSPACE_PROCESS_POLL_CHUNKS);
    return {
      kind: "napier.workspace-process-output",
      schemaVersion: 1,
      processId,
      status: entry.session.status,
      afterCursor,
      nextCursor: chunks.at(-1)?.cursor ?? afterCursor,
      hasMore: available.length > chunks.length,
      outputAvailable: true,
      chunks: structuredClone(chunks),
    };
  }

  async delta(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessDelta> {
    this.assertReady();
    const session = await this.requireSession(threadId, processId);
    const entry = this.entries.get(processId);
    if (
      !entry ||
      entry.session.threadId !== threadId ||
      !entry.workspaceDelta
    ) {
      return {
        kind: "napier.workspace-process-delta",
        schemaVersion: 1,
        processId,
        ...(session.workspaceDeltaStatus
          ? { status: session.workspaceDeltaStatus }
          : {}),
        available: false,
        entriesTruncated: false,
        entries: [],
      };
    }
    return {
      kind: "napier.workspace-process-delta",
      schemaVersion: 1,
      processId,
      status: entry.workspaceDelta.status,
      available: true,
      entriesTruncated: entry.workspaceDelta.entriesTruncated,
      entries: structuredClone(entry.workspaceDelta.entries),
    };
  }

  async writeInput(
    request: WriteWorkspaceProcessInputRequest,
  ): Promise<WorkspaceProcessInputReceipt> {
    return this.writeInputWithProtocolAccess(request, false);
  }

  async writePrivateProtocolInput(
    request: WriteWorkspaceProcessInputRequest,
  ): Promise<WorkspaceProcessInputReceipt> {
    return this.writeInputWithProtocolAccess(request, true);
  }

  private async writeInputWithProtocolAccess(
    request: WriteWorkspaceProcessInputRequest,
    privateProtocolAccess: boolean,
  ): Promise<WorkspaceProcessInputReceipt> {
    this.assertReady();
    if (request.signal?.aborted) {
      throw new Error("workspace process input was aborted");
    }
    const session = await this.requireSession(
      request.threadId,
      request.processId,
    );
    if (request.runId && request.runId !== session.runId) {
      throw new Error("Workspace Process Session does not belong to the Run");
    }
    const entry = this.entries.get(request.processId);
    if (!entry || entry.session.threadId !== request.threadId) {
      throw new Error("Workspace Process input is unavailable after restart");
    }
    if (entry.privateProtocol !== privateProtocolAccess) {
      throw new Error(
        privateProtocolAccess
          ? "Workspace Process Session is not a private protocol session"
          : "Workspace Process input is unavailable for a private protocol session",
      );
    }
    const operation = entry.inputTail.then(async () => {
      if (request.signal?.aborted) {
        throw new Error("workspace process input was aborted");
      }
      return this.writeInputNow(entry, request);
    });
    entry.inputTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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
  }

  private createEntry(
    session: WorkspaceProcessSession,
    prepared: PreparedCommandExecution,
    beforeSnapshot: WorkspacePathSnapshot,
    child: SandboxedProcess,
    privateProtocol: boolean,
    parentSignal?: AbortSignal,
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
      inputTail: Promise.resolve(),
      ...(parentSignal ? { parentSignal } : {}),
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
    const remaining = MAX_COMMAND_OUTPUT_CHARS - collector.chars;
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

  private async writeInputNow(
    entry: ActiveWorkspaceProcess,
    request: WriteWorkspaceProcessInputRequest,
  ): Promise<WorkspaceProcessInputReceipt> {
    const { session, receipt } = await writeWorkspaceProcessInput(
      entry.session,
      entry.child.stdin,
      entry.stdinHash,
      request,
    );
    entry.session = session;
    this.notifyChange(entry);
    try {
      await this.appendInputReceipt(receipt, session);
    } catch {
      this.forceStop(
        entry,
        "interrupted",
        "Process input may have been accepted but its Ledger evidence could not be persisted; the outcome is unknown.",
      );
      throw new Error(
        "Workspace Process input outcome is unknown because Ledger evidence could not be persisted",
      );
    }
    return receipt;
  }

  private async monitor(entry: ActiveWorkspaceProcess): Promise<void> {
    const exit = await entry.child.exit;
    await entry.termination;
    await entry.inputTail;
    await Promise.all([entry.stdout.completion, entry.stderr.completion]);
    clearTimeout(entry.timeout);
    entry.parentSignal?.removeEventListener("abort", entry.parentAbort!);
    let status: WorkspaceProcessStatus =
      entry.forcedStatus ?? (exit.code === 0 ? "succeeded" : "failed");
    let interruptionReason = entry.interruptionReason;
    try {
      await assertCommandRuntimeStable(entry.prepared);
    } catch {
      status = "failed";
      interruptionReason =
        "The bound command runtime changed during execution.";
    }
    const afterSnapshot = await createWorkspacePathSnapshot(
      entry.prepared.workspaceRoot,
      entry.prepared.workspaceRoot,
    ).catch(() => unavailableWorkspacePathSnapshot(entry.beforeSnapshot.kind));
    const workspaceDelta = diffWorkspaceSnapshots(
      entry.beforeSnapshot,
      afterSnapshot,
    );
    entry.workspaceDelta = workspaceDelta;
    const settledAt = nowIso();
    const stdoutSha256 = entry.stdout.hash.digest("hex");
    const stderrSha256 = entry.stderr.hash.digest("hex");
    const session = createWorkspaceProcessSession({
      ...stableSessionInput(entry.session),
      status,
      ...(entry.session.schemaVersion === 3 ? { stdinOpen: false } : {}),
      settledAt,
      durationMs: Math.max(
        0,
        Date.parse(settledAt) - Date.parse(entry.session.startedAt),
      ),
      exitCode: exit.code,
      signal: exit.signal,
      stdoutChars: entry.stdout.chars,
      stderrChars: entry.stderr.chars,
      stdoutSha256,
      stderrSha256,
      stdoutTruncated: entry.stdout.truncated,
      stderrTruncated: entry.stderr.truncated,
      nextCursor: entry.nextCursor,
      workspaceAfterSha256: afterSnapshot.sha256,
      workspaceAfterTruncated: afterSnapshot.truncated,
      workspaceDeltaStatus: workspaceDelta.status,
      workspaceChangedFileCount: workspaceDelta.changedFileCount,
      workspaceChangedPathSetSha256: workspaceDelta.changedPathSetSha256,
      ...(interruptionReason ? { interruptionReason } : {}),
    });
    entry.session = session;
    this.notifyChange(entry);
    await this.appendSession(
      session,
      status === "interrupted"
        ? WORKSPACE_PROCESS_INTERRUPTED_EVENT
        : WORKSPACE_PROCESS_SETTLED_EVENT,
    );
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
    if (entry.session.schemaVersion === 3 && entry.session.stdinOpen === true) {
      entry.session = createWorkspaceProcessSession({
        ...stableSessionInput(entry.session),
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
    entry.session = createWorkspaceProcessSession({
      ...stableSessionInput(entry.session),
      status: "interrupted",
      ...(entry.session.schemaVersion === 3 ? { stdinOpen: false } : {}),
      settledAt: nowIso(),
      stdoutChars: entry.stdout.chars,
      stderrChars: entry.stderr.chars,
      stdoutTruncated: entry.stdout.truncated,
      stderrTruncated: entry.stderr.truncated,
      nextCursor: entry.nextCursor,
      interruptionReason:
        "Process settlement evidence could not be persisted; the outcome is unknown.",
    });
    this.notifyChange(entry);
  }

  private async appendSession(
    session: WorkspaceProcessSession,
    type: string,
  ): Promise<void> {
    await this.options.store.appendEvent({
      threadId: session.threadId,
      runId: session.runId,
      type,
      category: "lifecycle",
      visibility: "user",
      payload: workspaceProcessSessionPayload(session),
    });
    const projection =
      this.projectedSessions.get(session.threadId) ??
      new Map<string, WorkspaceProcessSession>();
    projection.set(session.id, session);
    this.projectedSessions.set(session.threadId, projection);
  }

  private async appendInputReceipt(
    receipt: WorkspaceProcessInputReceipt,
    session: WorkspaceProcessSession,
  ): Promise<void> {
    await this.options.store.appendEvent({
      threadId: receipt.threadId,
      runId: receipt.runId,
      type: WORKSPACE_PROCESS_INPUT_EVENT,
      category: "tool",
      visibility: "user",
      payload: workspaceProcessInputReceiptPayload(receipt),
    });
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
    return workspaceProcessSessionWithRuntimeState(entry.session, {
      nextCursor: entry.nextCursor,
      outputAvailable: !entry.privateProtocol,
      workspaceDeltaAvailable: Boolean(entry.workspaceDelta),
      ...(entry.privateProtocol &&
      entry.session.schemaVersion === 3 &&
      entry.session.stdinMode === "interactive"
        ? { stdinOpen: false }
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
}

function stableSessionInput(
  session: WorkspaceProcessSession,
): Omit<
  WorkspaceProcessSession,
  | "kind"
  | "schemaVersion"
  | "status"
  | "outputAvailable"
  | "workspaceDeltaAvailable"
  | "contentSha256"
> {
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    status: _status,
    outputAvailable: _outputAvailable,
    workspaceDeltaAvailable: _workspaceDeltaAvailable,
    contentSha256: _contentSha256,
    ...input
  } = session;
  return input;
}
