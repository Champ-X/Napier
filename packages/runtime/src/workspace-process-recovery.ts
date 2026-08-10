import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackPreview,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  WorkspaceProcessCompensationProjection,
  workspaceProcessStatusIsCompensable,
} from "./workspace-process-compensation.js";
import {
  captureWorkspaceProcessRecoveryScopes,
  removeWorkspaceProcessRecovery,
  verifyWorkspaceProcessRecoveryScopes,
} from "./workspace-process-recovery-files.js";
import {
  createWorkspaceProcessRecoveryManifest,
  MAX_WORKSPACE_PROCESS_RECOVERY_BYTES,
  MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES,
  parseWorkspaceProcessRecoveryManifest,
  validWorkspaceProcessRecoveryProcessId,
  workspaceProcessRecoveryBinding,
  type WorkspaceProcessRecoveryBinding,
  type WorkspaceProcessRecoveryManifest,
} from "./workspace-process-recovery-manifest.js";
import { WorkspaceProcessRollbackPreviewStore } from "./workspace-process-rollback-preview-store.js";
import { executeWorkspaceProcessRollbackTransaction } from "./workspace-process-rollback-transaction.js";
import { createWorkspaceProcessWriteSnapshot } from "./workspace-process-write-snapshot.js";
import type { PreparedWorkspaceProcessWrite } from "./workspace-process-write-preview.js";
import { writeJsonExclusive } from "./workspace-file-scope.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export const MAX_WORKSPACE_PROCESS_ROLLBACK_PREVIEWS = 32;
export const WORKSPACE_PROCESS_ROLLBACK_PREVIEW_TTL_MS = 5 * 60_000;
export {
  MAX_WORKSPACE_PROCESS_RECOVERY_BYTES,
  MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES,
} from "./workspace-process-recovery-manifest.js";

const PREVIEW_ID = /^processrbprev_[a-z0-9]{8,80}$/u;

export type { WorkspaceProcessRecoveryBinding };

export class WorkspaceProcessRecoveryManager {
  private readonly recoveryRoot: string;
  private readonly manifests = new Map<
    string,
    WorkspaceProcessRecoveryManifest
  >();
  private readonly previews: WorkspaceProcessRollbackPreviewStore;
  private readonly blocked = new Set<string>();
  private readonly compensation = new WorkspaceProcessCompensationProjection();
  private initialized = false;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      dataRoot: string;
      now?: () => Date;
    },
  ) {
    this.recoveryRoot = path.join(
      path.resolve(options.dataRoot),
      "workspace-process-recovery",
    );
    this.previews = new WorkspaceProcessRollbackPreviewStore(
      () => this.now(),
      MAX_WORKSPACE_PROCESS_ROLLBACK_PREVIEWS,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.recoveryRoot, { recursive: true, mode: 0o700 });
    const children = await readdir(this.recoveryRoot, {
      withFileTypes: true,
    });
    for (const child of children) {
      if (
        !child.isDirectory() ||
        !validWorkspaceProcessRecoveryProcessId(child.name)
      ) {
        continue;
      }
      const manifest = await this.readManifest(child.name).catch(
        () => undefined,
      );
      if (manifest) {
        this.manifests.set(child.name, manifest);
      } else {
        await removeWorkspaceProcessRecovery(
          this.recoveryDirectory(child.name),
        ).catch(() => undefined);
      }
    }
    this.initialized = true;
  }

  async reconcile(
    sessions: WorkspaceProcessSession[],
    attempts: WorkspaceProcessRollbackAttempt[],
    results: WorkspaceProcessRollbackResult[],
  ): Promise<void> {
    this.assertReady();
    const sessionsById = new Map(
      sessions.map((session) => [session.id, session]),
    );
    const latestResults = new Map<string, WorkspaceProcessRollbackResult>();
    for (const result of results) latestResults.set(result.processId, result);
    const completedAttemptIds = new Set(results.map((result) => result.id));
    const pendingProcessIds = new Set(
      attempts
        .filter((attempt) => !completedAttemptIds.has(attempt.id))
        .map((attempt) => attempt.processId),
    );
    this.compensation.reconcile(attempts, results);
    for (const [processId, manifest] of [...this.manifests]) {
      if (pendingProcessIds.has(processId)) {
        this.blocked.add(processId);
        continue;
      }
      const result = latestResults.get(processId);
      if (result?.status === "restored") {
        await this.remove(processId);
        continue;
      }
      if (result?.status === "indeterminate") {
        this.blocked.add(processId);
        continue;
      }
      const session = sessionsById.get(processId);
      if (!session || !this.manifestMatchesSession(manifest, session)) {
        await this.remove(processId);
      }
    }
  }

  async capture(input: {
    processId: string;
    threadId: string;
    runId: string;
    write: PreparedWorkspaceProcessWrite;
    signal?: AbortSignal;
  }): Promise<WorkspaceProcessRecoveryBinding> {
    this.assertReady();
    if (!validWorkspaceProcessRecoveryProcessId(input.processId)) {
      throw new Error("Workspace Process recovery Process ID is invalid");
    }
    this.blocked.delete(input.processId);
    this.compensation.reset(input.processId);
    const recoveryDirectory = this.recoveryDirectory(input.processId);
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: input.write.absoluteWritePaths,
      relativePaths: input.write.relativeWritePaths,
      maximumEntries: MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES,
      maximumBytes: MAX_WORKSPACE_PROCESS_RECOVERY_BYTES,
      pathSha256: sha256,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const manifest = createWorkspaceProcessRecoveryManifest({
      processId: input.processId,
      threadId: input.threadId,
      runId: input.runId,
      writePreviewSha256: input.write.preview.contentSha256,
      writeScopeSetSha256: input.write.preview.writeScopeSetSha256,
      workspaceBeforeSha256: input.write.beforeSnapshot.sha256,
      scopes: captured.scopes,
      totals: captured.totals,
      createdAt: this.now().toISOString(),
    });
    try {
      await writeJsonExclusive(
        path.join(recoveryDirectory, "manifest.json"),
        manifest,
      );
    } catch (error) {
      await removeWorkspaceProcessRecovery(recoveryDirectory).catch(
        () => undefined,
      );
      throw error;
    }
    this.manifests.set(input.processId, manifest);
    return workspaceProcessRecoveryBinding(manifest);
  }

  async remove(processId: string): Promise<void> {
    this.manifests.delete(processId);
    this.blocked.delete(processId);
    this.previews.removeProcess(processId);
    await removeWorkspaceProcessRecovery(
      this.recoveryDirectory(processId),
    ).catch(() => undefined);
  }

  available(session: WorkspaceProcessSession): boolean {
    if (
      session.workspaceAccess !== "scoped_write" ||
      session.schemaVersion < 6 ||
      session.status === "running" ||
      !session.recoverySnapshotSha256 ||
      session.workspaceAfterTruncated === true ||
      !session.workspaceAfterSha256 ||
      this.blocked.has(session.id)
    ) {
      return false;
    }
    const manifest = this.manifests.get(session.id);
    return Boolean(manifest && this.manifestMatchesSession(manifest, session));
  }

  compensationStatus(
    session: WorkspaceProcessSession,
  ): WorkspaceProcessSession["workspaceCompensationStatus"] {
    return this.compensation.status(session);
  }

  async preview(
    session: WorkspaceProcessSession,
    signal?: AbortSignal,
  ): Promise<WorkspaceProcessRollbackPreview> {
    this.assertReady();
    signal?.throwIfAborted();
    const manifest = await this.requireManifest(session);
    const current = await this.requireCurrentWorkspace(session);
    await verifyWorkspaceProcessRecoveryScopes({
      recoveryDirectory: this.recoveryDirectory(session.id),
      scopes: manifest.scopes,
    });
    signal?.throwIfAborted();
    const createdAt = this.now().toISOString();
    const content = {
      kind: "napier.workspace-process-rollback-preview" as const,
      schemaVersion: 1 as const,
      id: createId("processrbprev"),
      threadId: session.threadId,
      runId: session.runId,
      processId: session.id,
      sessionSha256: session.contentSha256,
      recoverySnapshotSha256: manifest.contentSha256,
      expectedWorkspaceSha256: current.sha256,
      scopeCount: manifest.totals.scopeCount,
      fileCount: manifest.totals.fileCount,
      directoryCount: manifest.totals.directoryCount,
      bytes: manifest.totals.bytes,
      createdAt,
      expiresAt: new Date(
        Date.parse(createdAt) + WORKSPACE_PROCESS_ROLLBACK_PREVIEW_TTL_MS,
      ).toISOString(),
    };
    const preview: WorkspaceProcessRollbackPreview = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    this.previews.set(preview);
    return structuredClone(preview);
  }

  async apply(input: {
    session: WorkspaceProcessSession;
    previewId: string;
    signal?: AbortSignal;
    recordAttempt(attempt: WorkspaceProcessRollbackAttempt): Promise<void>;
    recordResult(result: WorkspaceProcessRollbackResult): Promise<void>;
  }): Promise<WorkspaceProcessRollbackResult> {
    this.assertReady();
    if (!PREVIEW_ID.test(input.previewId)) {
      throw new Error("Workspace Process rollback preview ID is invalid");
    }
    const preview = this.previews.consume(input.previewId);
    if (
      !preview ||
      preview.threadId !== input.session.threadId ||
      preview.processId !== input.session.id
    ) {
      throw new Error("Workspace Process rollback preview not found");
    }
    input.signal?.throwIfAborted();
    const manifest = await this.requireManifest(input.session);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [path.resolve(this.options.workspaceRoot)],
      "workspace_process rollback",
      async () => {
        const current = await this.requireCurrentWorkspace(input.session);
        if (
          preview.sessionSha256 !== input.session.contentSha256 ||
          preview.recoverySnapshotSha256 !== manifest.contentSha256 ||
          preview.expectedWorkspaceSha256 !== current.sha256
        ) {
          throw new Error(
            "Workspace Process rollback preview is stale; preview again",
          );
        }
        input.signal?.throwIfAborted();
        const result = await executeWorkspaceProcessRollbackTransaction({
          session: input.session,
          manifest,
          initiatedBy: "operator",
          authorizationSha256: preview.contentSha256,
          workspaceRoot: this.options.workspaceRoot,
          recoveryDirectory: this.recoveryDirectory(input.session.id),
          ...(input.signal ? { signal: input.signal } : {}),
          now: () => this.now(),
          recordAttempt: input.recordAttempt,
          attemptRecorded: () => this.blocked.add(input.session.id),
          recordResult: input.recordResult,
        });
        await this.acceptResult(result);
        return result;
      },
    );
  }

  async compensate(input: {
    session: WorkspaceProcessSession;
    recordAttempt(attempt: WorkspaceProcessRollbackAttempt): Promise<void>;
    recordResult(result: WorkspaceProcessRollbackResult): Promise<void>;
  }): Promise<WorkspaceProcessRollbackResult> {
    this.assertReady();
    if (
      input.session.schemaVersion !== 7 ||
      input.session.failureRecovery !== "restore_scopes" ||
      !workspaceProcessStatusIsCompensable(input.session.status) ||
      input.session.workspaceDeltaStatus !== "changed" ||
      input.session.workspaceWriteScopeStatus !== "within_scope" ||
      !input.session.writePreviewSha256
    ) {
      throw new Error(
        "Workspace Process automatic compensation is unavailable",
      );
    }
    const manifest = await this.requireManifest(input.session);
    await this.requireCurrentWorkspace(input.session);
    const result = await executeWorkspaceProcessRollbackTransaction({
      session: input.session,
      manifest,
      initiatedBy: "automatic_compensation",
      authorizationSha256: input.session.writePreviewSha256,
      workspaceRoot: this.options.workspaceRoot,
      recoveryDirectory: this.recoveryDirectory(input.session.id),
      now: () => this.now(),
      recordAttempt: input.recordAttempt,
      attemptRecorded: () => {
        this.blocked.add(input.session.id);
        this.compensation.attemptRecorded(input.session.id);
      },
      recordResult: input.recordResult,
    });
    this.compensation.resultRecorded(result);
    await this.acceptResult(result);
    return result;
  }

  private async requireManifest(
    session: WorkspaceProcessSession,
  ): Promise<WorkspaceProcessRecoveryManifest> {
    if (!this.available(session)) {
      throw new Error("Workspace Process rollback is unavailable");
    }
    const manifest = this.manifests.get(session.id)!;
    if (!this.manifestMatchesSession(manifest, session)) {
      throw new Error("Workspace Process recovery binding is invalid");
    }
    const observed = await this.readManifest(session.id).catch(() => undefined);
    if (
      !observed ||
      observed.contentSha256 !== manifest.contentSha256 ||
      !this.manifestMatchesSession(observed, session)
    ) {
      this.blocked.add(session.id);
      throw new Error("Workspace Process recovery snapshot drifted");
    }
    return observed;
  }

  private manifestMatchesSession(
    manifest: WorkspaceProcessRecoveryManifest,
    session: WorkspaceProcessSession,
  ): boolean {
    const binding = workspaceProcessRecoveryBinding(manifest);
    return (
      session.workspaceAccess === "scoped_write" &&
      session.schemaVersion >= 6 &&
      session.status !== "running" &&
      session.workspaceDeltaStatus === "changed" &&
      session.workspaceAfterTruncated !== true &&
      Boolean(session.workspaceAfterSha256) &&
      manifest.processId === session.id &&
      manifest.threadId === session.threadId &&
      manifest.runId === session.runId &&
      manifest.writePreviewSha256 === session.writePreviewSha256 &&
      manifest.writeScopeSetSha256 === session.writeScopeSetSha256 &&
      manifest.workspaceBeforeSha256 === session.workspaceBeforeSha256 &&
      binding.recoverySnapshotSha256 === session.recoverySnapshotSha256 &&
      binding.recoveryScopeCount === session.recoveryScopeCount &&
      binding.recoveryFileCount === session.recoveryFileCount &&
      binding.recoveryDirectoryCount === session.recoveryDirectoryCount &&
      binding.recoveryBytes === session.recoveryBytes
    );
  }

  private async requireCurrentWorkspace(session: WorkspaceProcessSession) {
    if (
      !session.workspaceAfterSha256 ||
      session.workspaceAfterTruncated === true
    ) {
      throw new Error(
        "Workspace Process rollback requires a complete settled workspace snapshot",
      );
    }
    const current = await createWorkspaceProcessWriteSnapshot(
      this.options.workspaceRoot,
    );
    if (current.truncated || current.sha256 !== session.workspaceAfterSha256) {
      throw new Error(
        "Workspace Process rollback is stale because the workspace changed",
      );
    }
    return current;
  }

  private async readManifest(
    processId: string,
  ): Promise<WorkspaceProcessRecoveryManifest> {
    const recoveryDirectory = this.recoveryDirectory(processId);
    const directory = await lstat(recoveryDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error("Workspace Process recovery directory is invalid");
    }
    const text = await readFile(
      path.join(recoveryDirectory, "manifest.json"),
      "utf8",
    );
    const parsed = parseWorkspaceProcessRecoveryManifest(
      JSON.parse(text) as unknown,
    );
    if (!parsed || parsed.processId !== processId) {
      throw new Error("Workspace Process recovery manifest is invalid");
    }
    await verifyWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      scopes: parsed.scopes,
    });
    return parsed;
  }

  private recoveryDirectory(processId: string): string {
    return path.join(this.recoveryRoot, processId);
  }

  private now(): Date {
    const current = this.options.now?.() ?? new Date();
    if (!Number.isFinite(current.getTime())) {
      throw new Error("Workspace Process recovery time is invalid");
    }
    return current;
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error(
        "WorkspaceProcessRecoveryManager.initialize() must be called first",
      );
    }
  }

  private async acceptResult(
    result: WorkspaceProcessRollbackResult,
  ): Promise<void> {
    if (result.status === "restored") {
      this.manifests.delete(result.processId);
      this.blocked.delete(result.processId);
      await removeWorkspaceProcessRecovery(
        this.recoveryDirectory(result.processId),
      ).catch(() => undefined);
    } else if (result.status === "indeterminate") {
      this.blocked.add(result.processId);
    } else {
      this.blocked.delete(result.processId);
    }
  }
}
