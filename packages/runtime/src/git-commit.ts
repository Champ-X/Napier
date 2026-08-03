import path from "node:path";

import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  assertGitCommitOperationState,
  snapshotGitCommitOperationState,
  type GitCommitOperationState,
} from "./git-commit-operation.js";
import { recoverGitMergeOperationTransactions } from "./git-commit-recovery.js";
import { createGitCommitDetails } from "./git-commit-details.js";
import { applyGitCommitRefUpdate } from "./git-commit-ref-update.js";
import {
  assertGitCommitPreviewState,
  assertPreparedGitCommitMatches,
  boundGitCommitIndexBytes,
  requireGitCurrentBranch,
} from "./git-commit-validation.js";
import {
  cleanupGitCommitDirectory,
  preparePrivateGitCommit,
} from "./git-commit-private.js";
import {
  DEFAULT_GIT_COMMIT_TIMEOUT_MS,
  GIT_COMMIT_PREVIEW_TTL_MS,
  type GitCommitApplyResult,
  type GitCommitDetails,
  type GitCommitPreview,
  MAX_GIT_COMMIT_PREVIEWS,
  MAX_GIT_COMMIT_TIMEOUT_MS,
  normalizeGitCommitMessage,
} from "./git-commit-model.js";
import type { GitInspectProcessOptions } from "./git-inspect-process.js";
import {
  resolveGitRepository,
  snapshotGitRepository,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import { promotePreparedGitObjects } from "./git-stage-private-index.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitCommitMutationManagerOptions extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitCommitPreviewRequest {
  message: string;
  contextLines?: number;
  timeoutMs?: number;
}

interface StoredGitCommitPreview {
  id: string;
  threadId: string;
  scopeId: string;
  message: string;
  branchRef: string;
  timestampSeconds: number;
  contextLines: number;
  repositoryState: GitRepositoryState;
  operationState: GitCommitOperationState;
  stagedPatch: string;
  details: GitCommitDetails;
  expiresAt: string;
  createdAtMs: number;
}

const commitManagers = new WeakMap<
  object,
  WeakMap<object, GitCommitMutationManager>
>();

export function gitCommitMutationManagerFor(
  store: { workspaceRoot: string; dataRoot: string },
  sandbox: GitInspectProcessOptions["sandbox"],
): GitCommitMutationManager {
  let bySandbox = commitManagers.get(store);
  if (!bySandbox) {
    bySandbox = new WeakMap();
    commitManagers.set(store, bySandbox);
  }
  const existing = bySandbox.get(sandbox);
  if (existing) return existing;
  const created = new GitCommitMutationManager({
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    sandbox,
  });
  bySandbox.set(sandbox, created);
  return created;
}

export class GitCommitMutationManager {
  private readonly previews = new Map<string, StoredGitCommitPreview>();
  private readonly currentTime: () => Date;

  constructor(private readonly options: GitCommitMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
  }

  async preview(
    threadId: string,
    scopeId: string,
    request: GitCommitPreviewRequest,
    signal?: AbortSignal,
  ): Promise<GitCommitPreview> {
    const validated = validatePreviewRequest(request);
    this.prune();
    const now = this.validNow();
    const timestampSeconds = Math.floor(now.getTime() / 1_000);
    const deadline = Date.now() + validated.timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [path.join(repository.gitDirectory, "napier-stage")],
      "Git commit preview",
      async () => {
        await recoverGitMergeOperationTransactions(repository);
        const repositoryState = await snapshotGitRepository(repository);
        const operationState =
          await snapshotGitCommitOperationState(repository);
        const branchRef = requireGitCurrentBranch(repositoryState);
        const indexBytes = await boundGitCommitIndexBytes(
          repository,
          repositoryState,
        );
        const config = await assertGitConfigPolicy(
          this.options,
          repository,
          remainingTime(deadline),
          signal,
          "commit",
        );
        const prepared = await preparePrivateGitCommit({
          processOptions: this.options,
          repository,
          indexBytes,
          message: validated.message,
          timestampSeconds,
          contextLines: validated.contextLines,
          deadline,
          configProcess: config,
          operationState,
          ...(signal ? { signal } : {}),
        });
        let stored: StoredGitCommitPreview;
        try {
          await assertGitCommitPreviewState(
            repository,
            repositoryState,
            branchRef,
            operationState,
          );
          const id = createId("gitcommitpreview");
          const expiresAt = new Date(
            now.getTime() + GIT_COMMIT_PREVIEW_TTL_MS,
          ).toISOString();
          const details = createGitCommitDetails({
            action: "preview",
            status: "ready",
            postcondition: "not_applied",
            previewId: id,
            expiresAt,
            message: validated.message,
            branchRef,
            timestampSeconds,
            contextLines: validated.contextLines,
            repository,
            repositoryState,
            prepared,
            durable: false,
            cancellationObserved: signal?.aborted === true,
          });
          stored = {
            id,
            threadId,
            scopeId,
            message: validated.message,
            branchRef,
            timestampSeconds,
            contextLines: validated.contextLines,
            repositoryState,
            operationState,
            stagedPatch: prepared.stagedPatch,
            details,
            expiresAt,
            createdAtMs: now.getTime(),
          };
        } finally {
          await cleanupGitCommitDirectory(prepared.temporaryDirectory);
        }
        this.previews.set(stored.id, stored);
        this.prune();
        return publicPreview(stored);
      },
    );
  }

  async apply(
    threadId: string,
    scopeId: string,
    previewId: string,
    timeoutMs = DEFAULT_GIT_COMMIT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<GitCommitApplyResult> {
    validateApply(previewId, timeoutMs);
    this.prune();
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.threadId !== threadId ||
      preview.scopeId !== scopeId
    ) {
      throw new Error("Git commit preview not found");
    }
    this.previews.delete(previewId);
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      throw new Error("Git commit preview expired");
    }
    abort(signal);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [
        path.join(repository.gitDirectory, "napier-stage"),
        path.join(repository.gitDirectory, "index"),
        path.join(repository.gitDirectory, preview.branchRef),
        ...Object.entries(preview.operationState.files)
          .filter(([, file]) => file.present)
          .map(([name]) => path.join(repository.gitDirectory, name)),
      ],
      "Git commit apply",
      () => this.applyUnderLock(repository, preview, timeoutMs, signal),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitCommitPreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitCommitApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await recoverGitMergeOperationTransactions(repository);
    await assertGitCommitPreviewState(
      repository,
      preview.repositoryState,
      preview.branchRef,
      preview.operationState,
    );
    const config = await assertGitConfigPolicy(
      this.options,
      repository,
      remainingTime(deadline),
      signal,
      "commit",
    );
    const indexBytes = await boundGitCommitIndexBytes(
      repository,
      preview.repositoryState,
    );
    const prepared = await preparePrivateGitCommit({
      processOptions: this.options,
      repository,
      indexBytes,
      message: preview.message,
      timestampSeconds: preview.timestampSeconds,
      contextLines: preview.contextLines,
      deadline,
      configProcess: config,
      operationState: preview.operationState,
      ...(signal ? { signal } : {}),
    });
    try {
      assertPreparedGitCommitMatches(prepared, preview);
      await assertGitCommitPreviewState(
        repository,
        preview.repositoryState,
        preview.branchRef,
        preview.operationState,
      );
      await promotePreparedGitObjects(prepared, repository);
      await assertGitCommitPreviewState(
        repository,
        preview.repositoryState,
        preview.branchRef,
        preview.operationState,
      );
      await assertGitCommitOperationState(repository, preview.operationState);
      await cleanupGitCommitDirectory(prepared.temporaryDirectory);
      abort(signal);
      return await applyGitCommitRefUpdate({
        options: this.options,
        repository,
        prepared,
        deadline,
        preview,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      await cleanupGitCommitDirectory(prepared.temporaryDirectory);
      throw error;
    }
  }

  private prune(): void {
    const now = this.validNow().getTime();
    for (const [id, preview] of this.previews) {
      if (Date.parse(preview.expiresAt) <= now) this.previews.delete(id);
    }
    const ordered = [...this.previews.values()].sort(
      (left, right) => left.createdAtMs - right.createdAtMs,
    );
    while (ordered.length > MAX_GIT_COMMIT_PREVIEWS) {
      this.previews.delete(ordered.shift()!.id);
    }
  }

  private validNow(): Date {
    const now = this.currentTime();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Git commit clock is invalid");
    }
    return now;
  }
}

function validatePreviewRequest(request: GitCommitPreviewRequest): {
  message: string;
  contextLines: number;
  timeoutMs: number;
} {
  const contextLines = request.contextLines ?? 3;
  const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_COMMIT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(contextLines) ||
    contextLines < 0 ||
    contextLines > 10
  ) {
    throw new Error("Git commit diff context is invalid");
  }
  validateTimeout(timeoutMs);
  return {
    message: normalizeGitCommitMessage(request.message),
    contextLines,
    timeoutMs,
  };
}

function validateApply(previewId: string, timeoutMs: number): void {
  if (!/^gitcommitpreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git commit preview ID is invalid");
  }
  validateTimeout(timeoutMs);
}

function validateTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_COMMIT_TIMEOUT_MS
  ) {
    throw new Error("Git commit timeout is invalid");
  }
}

function publicPreview(stored: StoredGitCommitPreview): GitCommitPreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    branchRef: stored.branchRef,
    message: stored.message,
    stagedPatch: stored.stagedPatch,
    details: structuredClone(stored.details),
  };
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git commit operation timed out");
  return remaining;
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git commit operation was aborted");
}
