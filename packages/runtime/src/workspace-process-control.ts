import type { Hash } from "node:crypto";

import type {
  WorkspaceProcessInputReceipt,
  WorkspaceProcessResizeReceipt,
  WorkspaceProcessSession,
} from "@napier/contracts";

import type { SandboxedProcess } from "./sandbox.js";
import {
  type WorkspaceProcessInput,
  writeWorkspaceProcessInput,
} from "./workspace-process-input.js";
import {
  resizeWorkspaceProcessTerminal,
  validateWorkspaceProcessTerminalSize,
} from "./workspace-process-terminal.js";

export interface WriteWorkspaceProcessInputRequest extends WorkspaceProcessInput {
  threadId: string;
  processId: string;
  runId?: string;
  signal?: AbortSignal;
}

export interface ResizeWorkspaceProcessRequest {
  threadId: string;
  processId: string;
  runId?: string;
  columns: number;
  rows: number;
  initiatedBy: WorkspaceProcessResizeReceipt["initiatedBy"];
  signal?: AbortSignal;
}

export interface WorkspaceProcessControlEntry {
  session: WorkspaceProcessSession;
  child: SandboxedProcess;
  privateProtocol: boolean;
  stdinHash: Hash;
  controlTail: Promise<void>;
}

export interface WorkspaceProcessControlHost<
  TEntry extends WorkspaceProcessControlEntry,
> {
  requireSession(
    threadId: string,
    processId: string,
  ): Promise<WorkspaceProcessSession>;
  entry(processId: string): TEntry | undefined;
  notify(entry: TEntry): void;
  interruptUnknown(entry: TEntry, reason: string): void;
  appendInput(
    receipt: WorkspaceProcessInputReceipt,
    session: WorkspaceProcessSession,
  ): Promise<void>;
  appendResize(
    receipt: WorkspaceProcessResizeReceipt,
    session: WorkspaceProcessSession,
  ): Promise<void>;
}

export class WorkspaceProcessControl<
  TEntry extends WorkspaceProcessControlEntry,
> {
  constructor(private readonly host: WorkspaceProcessControlHost<TEntry>) {}

  async writeInput(
    request: WriteWorkspaceProcessInputRequest,
    privateProtocolAccess: boolean,
  ): Promise<WorkspaceProcessInputReceipt> {
    if (request.signal?.aborted) {
      throw new Error("workspace process input was aborted");
    }
    const session = await this.host.requireSession(
      request.threadId,
      request.processId,
    );
    assertRunOwnership(session, request.runId);
    const entry = this.liveEntry(request.threadId, request.processId, "input");
    if (entry.privateProtocol !== privateProtocolAccess) {
      throw new Error(
        privateProtocolAccess
          ? "Workspace Process Session is not a private protocol session"
          : "Workspace Process input is unavailable for a private protocol session",
      );
    }
    return this.serialize(entry, request.signal, "input", async () => {
      const { session: updated, receipt } = await writeWorkspaceProcessInput(
        entry.session,
        entry.child.stdin,
        entry.stdinHash,
        request,
      );
      entry.session = updated;
      this.host.notify(entry);
      try {
        await this.host.appendInput(receipt, updated);
      } catch {
        this.host.interruptUnknown(
          entry,
          "Process input may have been accepted but its Ledger evidence could not be persisted; the outcome is unknown.",
        );
        throw new Error(
          "Workspace Process input outcome is unknown because Ledger evidence could not be persisted",
        );
      }
      return receipt;
    });
  }

  async resize(
    request: ResizeWorkspaceProcessRequest,
  ): Promise<WorkspaceProcessResizeReceipt> {
    if (request.signal?.aborted) {
      throw new Error("workspace process resize was aborted");
    }
    validateWorkspaceProcessTerminalSize({
      columns: request.columns,
      rows: request.rows,
    });
    const session = await this.host.requireSession(
      request.threadId,
      request.processId,
    );
    assertRunOwnership(session, request.runId);
    const entry = this.liveEntry(request.threadId, request.processId, "resize");
    if (entry.privateProtocol) {
      throw new Error(
        "Workspace Process resize is unavailable for a private protocol session",
      );
    }
    return this.serialize(entry, request.signal, "resize", async () => {
      const resized = await resizeWorkspaceProcessTerminal({
        session: entry.session,
        child: entry.child,
        columns: request.columns,
        rows: request.rows,
        initiatedBy: request.initiatedBy,
      });
      entry.session = resized.session;
      this.host.notify(entry);
      try {
        await this.host.appendResize(resized.receipt, resized.session);
      } catch {
        this.host.interruptUnknown(
          entry,
          "The PTY may have resized but its Ledger evidence could not be persisted; the outcome is unknown.",
        );
        throw new Error(
          "Workspace Process resize outcome is unknown because Ledger evidence could not be persisted",
        );
      }
      return resized.receipt;
    });
  }

  private liveEntry(
    threadId: string,
    processId: string,
    action: "input" | "resize",
  ): TEntry {
    const entry = this.host.entry(processId);
    if (!entry || entry.session.threadId !== threadId) {
      throw new Error(
        `Workspace Process ${action} is unavailable after restart`,
      );
    }
    return entry;
  }

  private async serialize<TResult>(
    entry: TEntry,
    signal: AbortSignal | undefined,
    action: "input" | "resize",
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = entry.controlTail.then(async () => {
      if (signal?.aborted) {
        throw new Error(`workspace process ${action} was aborted`);
      }
      return operation();
    });
    entry.controlTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function assertRunOwnership(
  session: WorkspaceProcessSession,
  runId: string | undefined,
): void {
  if (runId && runId !== session.runId) {
    throw new Error("Workspace Process Session does not belong to the Run");
  }
}
