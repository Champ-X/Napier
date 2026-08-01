import type { WorkspaceProcessSession } from "@napier/contracts";

import {
  MAX_COMMAND_OUTPUT_CHARS,
  prepareCommandExecution,
  type CommandExecutionRequest,
  type CommandRunnerOptions,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import type { SandboxedProcess } from "./sandbox.js";
import { createWorkspaceProcessSession } from "./workspace-process-events.js";
import {
  type WorkspaceProcessRecoveryBinding,
  WorkspaceProcessRecoveryManager,
} from "./workspace-process-recovery.js";
import {
  bindWorkspaceProcessIo,
  type WorkspaceProcessTerminalSize,
  validateWorkspaceProcessTerminalSize,
} from "./workspace-process-terminal.js";
import {
  type PreparedWorkspaceProcessWrite,
  WorkspaceProcessWritePreviewManager,
  type WorkspaceProcessWriteRuntimeState,
} from "./workspace-process-write-preview.js";
import {
  createWorkspacePathSnapshot,
  type WorkspacePathSnapshot,
} from "./workspace-snapshot.js";

export interface WorkspaceProcessLaunchRequest {
  threadId: string;
  runId: string;
  command: CommandExecutionRequest;
  interactive?: boolean;
  terminal?: WorkspaceProcessTerminalSize;
  signal?: AbortSignal;
}

export interface LaunchedWorkspaceProcess {
  session: WorkspaceProcessSession;
  prepared: PreparedCommandExecution;
  beforeSnapshot: WorkspacePathSnapshot;
  child: SandboxedProcess;
  write?: PreparedWorkspaceProcessWrite;
  writeLock?: WorkspaceProcessWriteRuntimeState["writeLock"];
}

export async function launchWorkspaceProcess(input: {
  request: WorkspaceProcessLaunchRequest;
  privateProtocol: boolean;
  writePreviewId?: string;
  options: CommandRunnerOptions & { dataRoot?: string };
  writePreviews: WorkspaceProcessWritePreviewManager;
  recovery?: WorkspaceProcessRecoveryManager;
  shuttingDown(): boolean;
}): Promise<LaunchedWorkspaceProcess> {
  const { request } = input;
  assertLaunchRequest(request, input.privateProtocol, input.shuttingDown());
  const processId = createId("process");
  let prepared: PreparedCommandExecution;
  let beforeSnapshot: WorkspacePathSnapshot;
  let child: SandboxedProcess;
  let io: ReturnType<typeof bindWorkspaceProcessIo>;
  let write: PreparedWorkspaceProcessWrite | undefined;
  let writeLock: WorkspaceProcessWriteRuntimeState["writeLock"];
  let recoveryBinding: WorkspaceProcessRecoveryBinding | undefined;
  try {
    if (input.writePreviewId) {
      if (input.privateProtocol || !input.options.dataRoot || !input.recovery) {
        throw new Error(
          "Workspace Process scoped writes require the managed local Runtime",
        );
      }
      ({ write, writeLock } = await input.writePreviews.acquire(
        {
          threadId: request.threadId,
          runId: request.runId,
          previewId: input.writePreviewId,
          ...(request.signal ? { signal: request.signal } : {}),
        },
        input.options.dataRoot,
      ));
      prepared = write.prepared;
      io = write.io;
      beforeSnapshot = write.beforeSnapshot;
      recoveryBinding = await input.recovery.capture({
        processId,
        threadId: request.threadId,
        runId: request.runId,
        write,
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } else {
      prepared = await prepareCommandExecution(input.options, request.command);
      io = bindWorkspaceProcessIo(prepared, request.terminal);
      beforeSnapshot = await createWorkspacePathSnapshot(
        prepared.workspaceRoot,
        prepared.workspaceRoot,
      );
    }
    if (input.shuttingDown()) {
      throw new Error("Workspace Process Manager is shutting down");
    }
    if (request.signal?.aborted) {
      throw new Error("workspace process start was aborted");
    }
    child = await input.options.sandbox.launch(io.launch);
  } catch (error) {
    await input.recovery?.remove(processId);
    await writeLock?.release();
    throw error;
  }
  if (input.shuttingDown()) {
    await abandonLaunch(input.recovery, processId, child, writeLock);
    throw new Error("Workspace Process Manager is shutting down");
  }
  if (request.terminal && !child.resize) {
    await abandonLaunch(input.recovery, processId, child, writeLock);
    throw new Error("The selected Sandbox does not support PTY resize");
  }
  if (request.interactive !== true && !request.terminal) child.stdin.end();
  const session = createRunningSession({
    processId,
    request,
    prepared,
    beforeSnapshot,
    io,
    ...(write ? { write } : {}),
    ...(recoveryBinding ? { recoveryBinding } : {}),
  });
  return {
    session,
    prepared,
    beforeSnapshot,
    child,
    ...(write ? { write } : {}),
    ...(writeLock ? { writeLock } : {}),
  };
}

function createRunningSession(input: {
  processId: string;
  request: WorkspaceProcessLaunchRequest;
  prepared: PreparedCommandExecution;
  beforeSnapshot: WorkspacePathSnapshot;
  io: ReturnType<typeof bindWorkspaceProcessIo>;
  write?: PreparedWorkspaceProcessWrite;
  recoveryBinding?: WorkspaceProcessRecoveryBinding;
}): WorkspaceProcessSession {
  return createWorkspaceProcessSession({
    schemaVersion: input.write ? (input.write.failureRecovery ? 7 : 6) : 4,
    id: input.processId,
    threadId: input.request.threadId,
    runId: input.request.runId,
    runtime: input.prepared.runtime,
    status: "running",
    sandbox: input.prepared.sandboxId,
    workspaceAccess: input.write ? "scoped_write" : "read_only",
    networkAccess: "denied",
    argumentCount: input.prepared.receipt.argumentCount,
    commandSha256: input.io.commandSha256,
    executableSha256: input.prepared.executableSha256,
    environmentSha256: input.io.environmentSha256,
    resourceLimitsSha256: input.io.resourceLimitsSha256,
    cwdPathSha256: input.prepared.receipt.cwdPathSha256,
    timeoutMs: input.prepared.timeoutMs,
    outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
    ...input.io.session,
    ...(input.request.interactive === true
      ? { stdinMode: "interactive" as const, stdinOpen: true }
      : {}),
    stdinWriteCount: 0,
    stdinBytes: 0,
    stdinSha256: sha256(""),
    workspaceBeforeSha256: input.beforeSnapshot.sha256,
    workspaceBeforeTruncated: input.beforeSnapshot.truncated,
    ...(input.write
      ? {
          writePreviewSha256: input.write.preview.contentSha256,
          writeScopeCount: input.write.preview.writeScopeCount,
          writeScopeSetSha256: input.write.preview.writeScopeSetSha256,
          ...(input.write.failureRecovery
            ? { failureRecovery: input.write.failureRecovery }
            : {}),
          ...input.recoveryBinding!,
        }
      : {}),
    startedAt: nowIso(),
    stdoutChars: 0,
    stderrChars: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    nextCursor: 0,
  });
}

function assertLaunchRequest(
  request: WorkspaceProcessLaunchRequest,
  privateProtocol: boolean,
  shuttingDown: boolean,
): void {
  if (shuttingDown) {
    throw new Error("Workspace Process Manager is shutting down");
  }
  if (request.signal?.aborted) {
    throw new Error("workspace process start was aborted");
  }
  if (request.terminal !== undefined && request.interactive !== undefined) {
    throw new Error(
      "Workspace Process PTY mode cannot be combined with pipe interactive mode",
    );
  }
  if (privateProtocol && request.terminal !== undefined) {
    throw new Error("Private Process protocols cannot use PTY mode");
  }
  validateWorkspaceProcessTerminalSize(request.terminal);
}

async function abandonLaunch(
  recovery: WorkspaceProcessRecoveryManager | undefined,
  processId: string,
  child: SandboxedProcess,
  writeLock: WorkspaceProcessWriteRuntimeState["writeLock"],
): Promise<void> {
  await child.terminate().catch(() => undefined);
  await recovery?.remove(processId);
  await writeLock?.release();
}
