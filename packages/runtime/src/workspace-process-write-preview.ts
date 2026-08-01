import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceProcessWritePreview } from "@napier/contracts";

import {
  assertCommandRuntimeStable,
  prepareCommandExecution,
  type CommandExecutionRequest,
  type CommandRunnerOptions,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import type { WorkspacePathSnapshot } from "./workspace-snapshot.js";
import { createWorkspaceProcessWriteSnapshot } from "./workspace-process-write-snapshot.js";
import {
  bindWorkspaceProcessIo,
  type BoundWorkspaceProcessIo,
  type WorkspaceProcessTerminalSize,
  validateWorkspaceProcessTerminalSize,
} from "./workspace-process-terminal.js";
import {
  acquireWorkspacePathLocks,
  type WorkspacePathLockLease,
} from "./workspace-write-lock.js";

export const MAX_WORKSPACE_PROCESS_WRITE_SCOPES = 8;
export const MAX_WORKSPACE_PROCESS_WRITE_PREVIEWS = 32;
export const WORKSPACE_PROCESS_WRITE_PREVIEW_TTL_MS = 5 * 60_000;
const MAX_WRITE_SCOPE_ENTRIES = 2_000;
const PROTECTED_SEGMENTS = new Set([".git", ".napier", "node_modules"]);
const PREVIEW_ID = /^processpreview_[a-z0-9]{8,80}$/u;

export interface PreviewWorkspaceProcessWriteRequest {
  threadId: string;
  runId: string;
  command: CommandExecutionRequest;
  writePaths: string[];
  interactive?: boolean;
  terminal?: WorkspaceProcessTerminalSize;
  signal?: AbortSignal;
}

export interface StartWorkspaceProcessWriteRequest {
  threadId: string;
  runId: string;
  previewId: string;
  signal?: AbortSignal;
}

export interface PreparedWorkspaceProcessWrite {
  preview: WorkspaceProcessWritePreview;
  command: CommandExecutionRequest;
  interactive: boolean;
  terminal?: WorkspaceProcessTerminalSize;
  prepared: PreparedCommandExecution;
  io: BoundWorkspaceProcessIo;
  beforeSnapshot: WorkspacePathSnapshot;
  absoluteWritePaths: string[];
  relativeWritePaths: string[];
}

export interface WorkspaceProcessWriteStartRequest {
  threadId: string;
  runId: string;
  command: CommandExecutionRequest;
  interactive?: boolean;
  terminal?: WorkspaceProcessTerminalSize;
  signal?: AbortSignal;
}

export interface WorkspaceProcessWriteRuntimeState {
  relativeWritePaths?: string[];
  writePreviewSha256?: string;
  writeScopeSetSha256?: string;
  writeLock?: WorkspacePathLockLease;
}

export class WorkspaceProcessWritePreviewManager {
  private readonly previews = new Map<string, PreparedWorkspaceProcessWrite>();

  constructor(private readonly options: CommandRunnerOptions) {}

  async preview(
    request: PreviewWorkspaceProcessWriteRequest,
  ): Promise<WorkspaceProcessWritePreview> {
    request.signal?.throwIfAborted();
    if (request.terminal !== undefined && request.interactive !== undefined) {
      throw new Error(
        "Workspace Process write PTY mode cannot be combined with pipe interactive mode",
      );
    }
    validateWorkspaceProcessTerminalSize(request.terminal);
    const prepared = await prepareCommandExecution(
      this.options,
      request.command,
    );
    const scopes = await resolveWorkspaceWriteScopes(
      prepared.workspaceRoot,
      request.writePaths,
    );
    const beforeSnapshot = await createWorkspaceProcessWriteSnapshot(
      prepared.workspaceRoot,
    );
    if (beforeSnapshot.truncated) {
      throw new Error(
        "Workspace Process write preview requires a complete workspace snapshot",
      );
    }
    request.signal?.throwIfAborted();
    const writeScopeSetSha256 = writeScopeSetHash(scopes.relative);
    const writePrepared: PreparedCommandExecution = {
      ...prepared,
      launch: {
        ...prepared.launch,
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
        workspaceWritePaths: [...scopes.absolute],
      },
    };
    const io = bindWorkspaceProcessIo(writePrepared, request.terminal);
    const createdAt = nowIso();
    const expiresAt = new Date(
      Date.parse(createdAt) + WORKSPACE_PROCESS_WRITE_PREVIEW_TTL_MS,
    ).toISOString();
    const content = {
      kind: "napier.workspace-process-write-preview" as const,
      schemaVersion: 1 as const,
      id: createId("processpreview"),
      threadId: request.threadId,
      runId: request.runId,
      runtime: prepared.runtime,
      sandbox: prepared.sandboxId,
      argumentCount: prepared.receipt.argumentCount,
      commandSha256: io.commandSha256,
      executableSha256: prepared.executableSha256,
      environmentSha256: io.environmentSha256,
      resourceLimitsSha256: io.resourceLimitsSha256,
      cwdPathSha256: prepared.receipt.cwdPathSha256,
      timeoutMs: prepared.timeoutMs,
      ioMode: request.terminal ? ("pty" as const) : ("pipe" as const),
      ...(request.terminal
        ? {
            terminalType: "xterm-256color" as const,
            terminalColumns: request.terminal.columns,
            terminalRows: request.terminal.rows,
          }
        : {}),
      writeScopeCount: scopes.relative.length,
      writeScopeSetSha256,
      workspaceBeforeSha256: beforeSnapshot.sha256,
      workspaceBeforeFileCount: beforeSnapshot.fileCount,
      workspaceBeforeBytes: beforeSnapshot.bytes,
      createdAt,
      expiresAt,
    };
    const preview: WorkspaceProcessWritePreview = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    this.prune();
    if (this.previews.size >= MAX_WORKSPACE_PROCESS_WRITE_PREVIEWS) {
      const oldest = [...this.previews.values()].sort((left, right) =>
        left.preview.createdAt.localeCompare(right.preview.createdAt),
      )[0];
      if (oldest) this.previews.delete(oldest.preview.id);
    }
    this.previews.set(preview.id, {
      preview,
      command: structuredClone(request.command),
      interactive: request.interactive === true,
      ...(request.terminal
        ? { terminal: structuredClone(request.terminal) }
        : {}),
      prepared: writePrepared,
      io,
      beforeSnapshot,
      absoluteWritePaths: scopes.absolute,
      relativeWritePaths: scopes.relative,
    });
    return structuredClone(preview);
  }

  require(
    threadId: string,
    runId: string,
    previewId: string,
  ): PreparedWorkspaceProcessWrite {
    this.prune();
    if (!PREVIEW_ID.test(previewId)) {
      throw new Error("Workspace Process write preview ID is invalid");
    }
    const prepared = this.previews.get(previewId);
    if (
      !prepared ||
      prepared.preview.threadId !== threadId ||
      prepared.preview.runId !== runId
    ) {
      throw new Error("Workspace Process write preview not found");
    }
    return prepared;
  }

  startRequest(
    request: StartWorkspaceProcessWriteRequest,
  ): WorkspaceProcessWriteStartRequest {
    const preview = this.require(
      request.threadId,
      request.runId,
      request.previewId,
    );
    return {
      threadId: request.threadId,
      runId: request.runId,
      command: structuredClone(preview.command),
      ...(preview.interactive ? { interactive: true } : {}),
      ...(preview.terminal
        ? { terminal: structuredClone(preview.terminal) }
        : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    };
  }

  async acquire(
    request: StartWorkspaceProcessWriteRequest,
    dataRoot: string,
  ): Promise<{
    write: PreparedWorkspaceProcessWrite;
    writeLock: WorkspacePathLockLease;
  }> {
    const candidate = this.require(
      request.threadId,
      request.runId,
      request.previewId,
    );
    const writeLock = await acquireWorkspacePathLocks(
      dataRoot,
      [candidate.prepared.workspaceRoot],
      "workspace_process scoped write",
    );
    try {
      return {
        write: await this.consume(request),
        writeLock,
      };
    } catch (error) {
      await writeLock.release();
      throw error;
    }
  }

  async consume(
    request: StartWorkspaceProcessWriteRequest,
  ): Promise<PreparedWorkspaceProcessWrite> {
    const prepared = this.require(
      request.threadId,
      request.runId,
      request.previewId,
    );
    request.signal?.throwIfAborted();
    const scopes = await resolveWorkspaceWriteScopes(
      prepared.prepared.workspaceRoot,
      prepared.relativeWritePaths,
    );
    if (
      writeScopeSetHash(scopes.relative) !==
        prepared.preview.writeScopeSetSha256 ||
      canonicalJson(scopes.relative) !==
        canonicalJson(prepared.relativeWritePaths)
    ) {
      throw new Error("Workspace Process write preview scope changed");
    }
    const current = await createWorkspaceProcessWriteSnapshot(
      prepared.prepared.workspaceRoot,
    );
    if (
      current.truncated ||
      current.sha256 !== prepared.preview.workspaceBeforeSha256
    ) {
      throw new Error(
        "Workspace Process write preview is stale; preview the command again",
      );
    }
    await assertCommandRuntimeStable(prepared.prepared);
    request.signal?.throwIfAborted();
    this.previews.delete(request.previewId);
    return prepared;
  }

  private prune(): void {
    const now = Date.now();
    for (const [previewId, prepared] of this.previews) {
      if (Date.parse(prepared.preview.expiresAt) <= now) {
        this.previews.delete(previewId);
      }
    }
  }
}

export function workspaceProcessWriteRuntimeState(
  write?: PreparedWorkspaceProcessWrite,
  writeLock?: WorkspacePathLockLease,
): WorkspaceProcessWriteRuntimeState {
  return {
    ...(write
      ? {
          relativeWritePaths: [...write.relativeWritePaths],
          writePreviewSha256: write.preview.contentSha256,
          writeScopeSetSha256: write.preview.writeScopeSetSha256,
        }
      : {}),
    ...(writeLock ? { writeLock } : {}),
  };
}

async function resolveWorkspaceWriteScopes(
  workspaceRoot: string,
  writePaths: string[],
): Promise<{ absolute: string[]; relative: string[] }> {
  if (
    !Array.isArray(writePaths) ||
    writePaths.length < 1 ||
    writePaths.length > MAX_WORKSPACE_PROCESS_WRITE_SCOPES
  ) {
    throw new Error(
      `Workspace Process write preview requires 1-${MAX_WORKSPACE_PROCESS_WRITE_SCOPES} write paths`,
    );
  }
  const canonicalRoot = await realpath(path.resolve(workspaceRoot));
  const scopes = await Promise.all(
    writePaths.map(async (candidate) => {
      if (
        typeof candidate !== "string" ||
        !candidate ||
        candidate.length > 500 ||
        path.isAbsolute(candidate) ||
        /[\u0000-\u001f\u007f]/u.test(candidate)
      ) {
        throw new Error(
          "Workspace Process write paths must be visible workspace-relative paths",
        );
      }
      const lexical = path.resolve(canonicalRoot, candidate);
      if (!inside(lexical, canonicalRoot) || lexical === canonicalRoot) {
        throw new Error("Workspace Process write scope escapes the workspace");
      }
      const relative = path.relative(canonicalRoot, lexical);
      if (
        relative
          .split(path.sep)
          .some((segment) => PROTECTED_SEGMENTS.has(segment))
      ) {
        throw new Error(
          "Workspace Process write scope contains a protected path",
        );
      }
      const resolved = await realpath(lexical).catch(() => undefined);
      if (!resolved || path.resolve(resolved) !== lexical) {
        throw new Error(
          "Workspace Process write scope must be an existing non-symlink path",
        );
      }
      const info = await stat(resolved);
      if (!info.isFile() && !info.isDirectory()) {
        throw new Error(
          "Workspace Process write scope must be a file or directory",
        );
      }
      await assertSafeWriteScopeTree(resolved);
      return { absolute: resolved, relative };
    }),
  );
  scopes.sort((left, right) => left.relative.localeCompare(right.relative));
  if (
    new Set(scopes.map((scope) => scope.relative)).size !== scopes.length ||
    scopes.some((scope, index) =>
      scopes.some(
        (other, otherIndex) =>
          index !== otherIndex && inside(scope.absolute, other.absolute),
      ),
    )
  ) {
    throw new Error("Workspace Process write scopes cannot overlap");
  }
  return {
    absolute: scopes.map((scope) => scope.absolute),
    relative: scopes.map((scope) => scope.relative),
  };
}

async function assertSafeWriteScopeTree(target: string): Promise<void> {
  let entryCount = 0;
  const visit = async (current: string): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error("Workspace Process write scope cannot contain symlinks");
    }
    entryCount += 1;
    if (entryCount > MAX_WRITE_SCOPE_ENTRIES) {
      throw new Error("Workspace Process write scope exceeds its entry limit");
    }
    if (!info.isDirectory()) return;
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      if (PROTECTED_SEGMENTS.has(child.name)) {
        throw new Error(
          "Workspace Process write scope contains a protected path",
        );
      }
      await visit(path.join(current, child.name));
    }
  };
  await visit(target);
}

function writeScopeSetHash(relativePaths: string[]): string {
  return sha256(
    canonicalJson(
      relativePaths.map((relativePath) => ({
        pathSha256: sha256(relativePath),
      })),
    ),
  );
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
