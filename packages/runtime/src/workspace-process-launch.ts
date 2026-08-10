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
  type WorkspaceProcessLocalServiceRequest,
  validateWorkspaceProcessLocalServiceRequest,
  workspaceProcessLocalServiceProjection,
} from "./workspace-process-local-service.js";
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
  localService?: WorkspaceProcessLocalServiceRequest;
  signal?: AbortSignal;
}

export interface PrivateProtocolWorkspaceProcessLaunchRequest extends WorkspaceProcessLaunchRequest {
  outputLimitChars?: number;
}

export interface PrivateWorkspaceProcessLaunchRequest extends WorkspaceProcessLaunchRequest {
  privateWorkspace: {
    workspaceRoot: string;
    runtimeReadPaths?: string[];
  };
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
  request:
    | WorkspaceProcessLaunchRequest
    | PrivateProtocolWorkspaceProcessLaunchRequest
    | PrivateWorkspaceProcessLaunchRequest;
  privateProtocol: boolean;
  writePreviewId?: string;
  options: CommandRunnerOptions & { dataRoot?: string };
  writePreviews: WorkspaceProcessWritePreviewManager;
  recovery?: WorkspaceProcessRecoveryManager;
  shuttingDown(): boolean;
}): Promise<LaunchedWorkspaceProcess> {
  const { request } = input;
  assertLaunchRequest(
    request,
    input.privateProtocol,
    input.writePreviewId !== undefined,
    input.shuttingDown(),
  );
  const commandOptions = processCommandOptions(request, input.options);
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
      prepared = await prepareCommandExecution(commandOptions, request.command);
      io = bindWorkspaceProcessIo(
        prepared,
        request.terminal,
        request.localService,
      );
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
    child = await input.options.sandbox.launch({
      ...io.launch,
      ...(request.signal ? { signal: request.signal } : {}),
    });
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
  if (Boolean(request.localService) !== Boolean(child.localService)) {
    await abandonLaunch(input.recovery, processId, child, writeLock);
    throw new Error(
      "The selected Sandbox did not bind the requested local service",
    );
  }
  if (request.interactive !== true && !request.terminal) child.stdin.end();
  const session = createRunningSession({
    processId,
    request,
    prepared,
    beforeSnapshot,
    io,
    child,
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
  request:
    | WorkspaceProcessLaunchRequest
    | PrivateProtocolWorkspaceProcessLaunchRequest;
  prepared: PreparedCommandExecution;
  beforeSnapshot: WorkspacePathSnapshot;
  io: ReturnType<typeof bindWorkspaceProcessIo>;
  child: SandboxedProcess;
  write?: PreparedWorkspaceProcessWrite;
  recoveryBinding?: WorkspaceProcessRecoveryBinding;
}): WorkspaceProcessSession {
  return createWorkspaceProcessSession({
    schemaVersion: input.child.localService
      ? 8
      : input.write
        ? input.write.failureRecovery
          ? 7
          : 6
        : 4,
    id: input.processId,
    threadId: input.request.threadId,
    runId: input.request.runId,
    runtime: input.prepared.runtime,
    status: "running",
    sandbox: input.prepared.sandboxId,
    workspaceAccess: input.write ? "scoped_write" : "read_only",
    networkAccess: input.child.localService
      ? "outbound_denied_loopback_service"
      : "denied",
    ...(input.child.localService
      ? {
          localService: workspaceProcessLocalServiceProjection(
            input.child.localService,
          ),
        }
      : {}),
    argumentCount: input.prepared.receipt.argumentCount,
    commandSha256: input.io.commandSha256,
    executableSha256: input.prepared.executableSha256,
    environmentSha256: input.io.environmentSha256,
    resourceLimitsSha256: input.io.resourceLimitsSha256,
    cwdPathSha256: input.prepared.receipt.cwdPathSha256,
    timeoutMs: input.prepared.timeoutMs,
    outputLimitChars:
      "outputLimitChars" in input.request &&
      input.request.outputLimitChars !== undefined
        ? input.request.outputLimitChars
        : MAX_COMMAND_OUTPUT_CHARS,
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
  request:
    | WorkspaceProcessLaunchRequest
    | PrivateProtocolWorkspaceProcessLaunchRequest
    | PrivateWorkspaceProcessLaunchRequest,
  privateProtocol: boolean,
  writePreview: boolean,
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
  validateWorkspaceProcessLocalServiceRequest({
    ...(request.localService ? { localService: request.localService } : {}),
    ...(request.interactive ? { interactive: request.interactive } : {}),
    ...(request.terminal ? { terminal: request.terminal } : {}),
    privateProtocol,
    writePreview,
  });
  if ("privateWorkspace" in request && !privateProtocol) {
    throw new Error(
      "Private Process workspace scope requires the private protocol path",
    );
  }
  if (
    "outputLimitChars" in request &&
    request.outputLimitChars !== undefined &&
    (!privateProtocol ||
      !Number.isSafeInteger(request.outputLimitChars) ||
      request.outputLimitChars < 1 ||
      request.outputLimitChars > 128 * 1024)
  ) {
    throw new Error("Private Process output limit is invalid");
  }
  validateWorkspaceProcessTerminalSize(request.terminal);
}

function processCommandOptions(
  request:
    | WorkspaceProcessLaunchRequest
    | PrivateProtocolWorkspaceProcessLaunchRequest
    | PrivateWorkspaceProcessLaunchRequest,
  options: CommandRunnerOptions & { dataRoot?: string },
): CommandRunnerOptions & { dataRoot?: string } {
  if (!("privateWorkspace" in request)) return options;
  const scope = request.privateWorkspace;
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    Object.keys(scope).some(
      (key) => key !== "workspaceRoot" && key !== "runtimeReadPaths",
    ) ||
    typeof scope.workspaceRoot !== "string" ||
    !scope.workspaceRoot ||
    (scope.runtimeReadPaths !== undefined &&
      (!Array.isArray(scope.runtimeReadPaths) ||
        scope.runtimeReadPaths.some(
          (candidate) => typeof candidate !== "string",
        )))
  ) {
    throw new Error("Private Process workspace scope is invalid");
  }
  const runtimeReadPaths = [
    ...(options.runtimeReadPaths ?? []),
    ...(scope.runtimeReadPaths ?? []),
  ];
  return {
    ...options,
    workspaceRoot: scope.workspaceRoot,
    ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
  };
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
