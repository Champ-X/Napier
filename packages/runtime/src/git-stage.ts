import path from "node:path";

import { sha256 } from "./ed25519.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import type { GitInspectProcessOptions } from "./git-inspect-process.js";
import {
  normalizeGitPath,
  readGitIndexBytes,
  resolveGitRepository,
  snapshotGitRepository,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  cleanupPreparedGitStage,
  installPreparedGitIndex,
  preparePrivateGitStage,
  promotePreparedGitObjects,
  type PreparedGitStage,
} from "./git-stage-private-index.js";
import { createGitStageDetails } from "./git-stage-details.js";
import {
  DEFAULT_GIT_STAGE_TIMEOUT_MS,
  GIT_STAGE_PREVIEW_TTL_MS,
  assertGitStagePathAncestors,
  type GitStageApplyResult,
  type GitStageDetails,
  type GitStagePathState,
  type GitStagePreview,
  MAX_GIT_STAGE_PREVIEWS,
  MAX_GIT_STAGE_TIMEOUT_MS,
  snapshotGitAttributeState,
  snapshotGitStagePath,
} from "./git-stage-model.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitStageMutationManagerOptions
  extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitStagePreviewRequest {
  path: string;
  contextLines?: number;
  timeoutMs?: number;
}

const gitStageManagers = new WeakMap<
  object,
  WeakMap<object, GitStageMutationManager>
>();

export function gitStageMutationManagerFor(
  store: { workspaceRoot: string; dataRoot: string },
  sandbox: GitInspectProcessOptions["sandbox"],
): GitStageMutationManager {
  let bySandbox = gitStageManagers.get(store);
  if (!bySandbox) {
    bySandbox = new WeakMap();
    gitStageManagers.set(store, bySandbox);
  }
  const existing = bySandbox.get(sandbox);
  if (existing) return existing;
  const created = new GitStageMutationManager({
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    sandbox,
  });
  bySandbox.set(sandbox, created);
  return created;
}

interface StoredGitStagePreview {
  id: string;
  threadId: string;
  scopeId: string;
  path: string;
  pathState: GitStagePathState;
  attributesStateSha256: string;
  repositoryState: GitRepositoryState;
  contextLines: number;
  patch: string;
  details: GitStageDetails;
  expiresAt: string;
  createdAtMs: number;
}

export class GitStageMutationManager {
  private readonly previews = new Map<string, StoredGitStagePreview>();
  private readonly currentTime: () => Date;

  constructor(private readonly options: GitStageMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
  }

  async preview(
    threadId: string,
    scopeId: string,
    request: GitStagePreviewRequest,
    signal?: AbortSignal,
  ): Promise<GitStagePreview> {
    const normalized = validateRequest(request);
    this.prune();
    const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_STAGE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const repositoryState = await snapshotGitRepository(repository);
    requireIndex(repositoryState);
    const absolutePath = path.join(repository.root, normalized);
    await assertGitStagePathAncestors(repository, normalized);
    const [pathState, attributesStateSha256] = await Promise.all([
      snapshotGitStagePath(absolutePath),
      snapshotGitAttributeState(repository, normalized),
    ]);
    abort(signal);
    const config = await assertGitConfigPolicy(
      this.options,
      repository,
      remainingTime(deadline),
      signal,
      "stage",
    );
    const initialIndexBytes = await boundIndexBytes(repository, repositoryState);
    const prepared = await preparePrivateGitStage({
      processOptions: this.options,
      repository,
      initialIndexBytes,
      targetPath: normalized,
      contextLines: request.contextLines ?? 3,
      deadline,
      configProcess: config,
      ...(signal ? { signal } : {}),
    });
    let stored: StoredGitStagePreview;
    try {
      validatePreparedStage(prepared);
      await assertPreviewState(
        repository,
        repositoryState,
        absolutePath,
        pathState,
        attributesStateSha256,
      );
      const now = this.validNow();
      const previewId = createId("gitstagepreview");
      const expiresAt = new Date(
        now.getTime() + GIT_STAGE_PREVIEW_TTL_MS,
      ).toISOString();
      const details = createGitStageDetails({
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId,
        expiresAt,
        repository,
        repositoryState,
        path: normalized,
        pathState,
        attributesStateSha256,
        contextLines: request.contextLines ?? 3,
        prepared,
        durable: false,
        cancellationObserved: signal?.aborted === true,
      });
      stored = {
        id: previewId,
        threadId,
        scopeId,
        path: normalized,
        pathState,
        attributesStateSha256,
        repositoryState,
        contextLines: request.contextLines ?? 3,
        patch: prepared.patch,
        details,
        expiresAt,
        createdAtMs: now.getTime(),
      };
    } finally {
      await cleanupPreparedGitStage(prepared);
    }
    this.previews.set(stored.id, stored);
    this.prune();
    return publicPreview(stored);
  }

  async apply(
    threadId: string,
    scopeId: string,
    previewId: string,
    timeoutMs = DEFAULT_GIT_STAGE_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<GitStageApplyResult> {
    validateApply(previewId, timeoutMs);
    this.prune();
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.threadId !== threadId ||
      preview.scopeId !== scopeId
    ) {
      throw new Error("Git stage preview not found");
    }
    this.previews.delete(previewId);
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      throw new Error("Git stage preview expired");
    }
    abort(signal);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const absolutePath = path.join(repository.root, preview.path);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [path.join(repository.gitDirectory, "index"), absolutePath],
      "Git stage apply",
      () =>
        this.applyUnderLock(
          repository,
          absolutePath,
          preview,
          timeoutMs,
          signal,
        ),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    absolutePath: string,
    preview: StoredGitStagePreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitStageApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await assertPreviewState(
      repository,
      preview.repositoryState,
      absolutePath,
      preview.pathState,
      preview.attributesStateSha256,
    );
    const config = await assertGitConfigPolicy(
      this.options,
      repository,
      remainingTime(deadline),
      signal,
      "stage",
    );
    const initialIndexBytes = await boundIndexBytes(
      repository,
      preview.repositoryState,
    );
    const prepared = await preparePrivateGitStage({
      processOptions: this.options,
      repository,
      initialIndexBytes,
      targetPath: preview.path,
      contextLines: preview.contextLines,
      deadline,
      configProcess: config,
      ...(signal ? { signal } : {}),
    });
    let committed = false;
    let durable = false;
    try {
      validatePreparedStage(prepared);
      if (
        prepared.indexSha256 !== preview.details.proposedIndexSha256 ||
        sha256(prepared.patch) !== preview.details.patchSha256
      ) {
        throw new Error(
          "Git stage preview is stale; preview the target again",
        );
      }
      await assertPreviewState(
        repository,
        preview.repositoryState,
        absolutePath,
        preview.pathState,
        preview.attributesStateSha256,
      );
      await promotePreparedGitObjects(prepared, repository);
      abort(signal);
      durable = await installPreparedGitIndex({
        prepared,
        repository,
        indexMode: preview.repositoryState.index.mode,
        verifyCurrentState: () =>
          assertPreviewState(
            repository,
            preview.repositoryState,
            absolutePath,
            preview.pathState,
            preview.attributesStateSha256,
            true,
          ),
        ...(signal ? { signal } : {}),
      });
      committed = true;
      const verified = await verifyAppliedState(
        repository,
        preview,
        absolutePath,
        prepared,
      );
      const cleanupComplete = await cleanupPreparedGitStage(prepared)
        .then(() => true)
        .catch(() => false);
      const committedDurably = durable && cleanupComplete;
      const status =
        verified && committedDurably ? "applied" : "indeterminate";
      const details = createGitStageDetails({
        action: "apply",
        status,
        postcondition: status === "applied" ? "verified" : "indeterminate",
        repository,
        repositoryState: preview.repositoryState,
        path: preview.path,
        pathState: preview.pathState,
        attributesStateSha256: preview.attributesStateSha256,
        contextLines: preview.contextLines,
        prepared,
        ...(verified ? { afterIndexSha256: prepared.indexSha256 } : {}),
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: committedDurably,
        cancellationObserved: signal?.aborted === true,
      });
      return { path: preview.path, patch: prepared.patch, details };
    } catch (error) {
      if (!committed) {
        await cleanupPreparedGitStage(prepared);
        throw error;
      }
      await cleanupPreparedGitStage(prepared).catch(() => undefined);
      const details = createGitStageDetails({
        action: "apply",
        status: "indeterminate",
        postcondition: "indeterminate",
        repository,
        repositoryState: preview.repositoryState,
        path: preview.path,
        pathState: preview.pathState,
        attributesStateSha256: preview.attributesStateSha256,
        contextLines: preview.contextLines,
        prepared,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: false,
        cancellationObserved: signal?.aborted === true,
      });
      return { path: preview.path, patch: prepared.patch, details };
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
    while (ordered.length > MAX_GIT_STAGE_PREVIEWS) {
      this.previews.delete(ordered.shift()!.id);
    }
  }

  private validNow(): Date {
    const now = this.currentTime();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Git stage clock is invalid");
    }
    return now;
  }
}

async function assertPreviewState(
  repository: GitRepository,
  expectedRepository: GitRepositoryState,
  absolutePath: string,
  expectedPath: GitStagePathState,
  expectedAttributesStateSha256: string,
  allowIndexLock = false,
): Promise<void> {
  const targetPath = path
    .relative(repository.root, absolutePath)
    .split(path.sep)
    .join("/");
  await assertGitStagePathAncestors(repository, targetPath);
  const [currentRepository, currentPath, currentAttributesStateSha256] =
    await Promise.all([
      snapshotGitRepository(repository, { allowIndexLock }),
      snapshotGitStagePath(absolutePath),
      snapshotGitAttributeState(repository, targetPath),
    ]);
  if (
    currentRepository.stateSha256 !== expectedRepository.stateSha256 ||
    currentPath.stateSha256 !== expectedPath.stateSha256 ||
    currentAttributesStateSha256 !== expectedAttributesStateSha256
  ) {
    throw new Error("Git stage preview is stale; preview the target again");
  }
}

async function verifyAppliedState(
  repository: GitRepository,
  preview: StoredGitStagePreview,
  absolutePath: string,
  prepared: PreparedGitStage,
): Promise<boolean> {
  await assertGitStagePathAncestors(repository, preview.path);
  const [currentRepository, currentPath, currentAttributesStateSha256] =
    await Promise.all([
      snapshotGitRepository(repository),
      snapshotGitStagePath(absolutePath),
      snapshotGitAttributeState(repository, preview.path),
    ]);
  return (
    currentRepository.nonIndexStateSha256 ===
      preview.repositoryState.nonIndexStateSha256 &&
    currentRepository.index.sha256 === prepared.indexSha256 &&
    currentPath.stateSha256 === preview.pathState.stateSha256 &&
    currentAttributesStateSha256 === preview.attributesStateSha256
  );
}

async function boundIndexBytes(
  repository: GitRepository,
  expected: GitRepositoryState,
): Promise<Buffer> {
  const value = await readGitIndexBytes(repository);
  if (!value || sha256(value) !== expected.index.sha256) {
    throw new Error("Git index changed while it was inspected");
  }
  return value;
}

function validatePreparedStage(prepared: PreparedGitStage): void {
  if (prepared.counts.fileCount !== 1) {
    throw new Error("Git stage preview must contain exactly one file");
  }
}

function validateRequest(request: GitStagePreviewRequest): string {
  if (
    request.contextLines !== undefined &&
    (!Number.isSafeInteger(request.contextLines) ||
      request.contextLines < 0 ||
      request.contextLines > 10)
  ) {
    throw new Error("Git stage context is invalid");
  }
  if (request.timeoutMs !== undefined) validateTimeout(request.timeoutMs);
  return normalizeGitPath(request.path);
}

function validateApply(previewId: string, timeoutMs: number): void {
  if (!/^gitstagepreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git stage preview ID is invalid");
  }
  validateTimeout(timeoutMs);
}

function validateTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_STAGE_TIMEOUT_MS
  ) {
    throw new Error("Git stage timeout is invalid");
  }
}

function requireIndex(state: GitRepositoryState): void {
  if (!state.index.present) {
    throw new Error("Git stage requires an existing repository index");
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git stage operation timed out");
  return remaining;
}

function publicPreview(stored: StoredGitStagePreview): GitStagePreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    path: stored.path,
    patch: stored.patch,
    details: structuredClone(stored.details),
  };
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git stage operation was aborted");
}
