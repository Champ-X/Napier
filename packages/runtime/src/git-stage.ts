import path from "node:path";

import { sha256 } from "./ed25519.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import type { GitInspectProcessOptions } from "./git-inspect-process.js";
import {
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
  snapshotGitAttributeState,
  snapshotGitStagePath,
} from "./git-stage-model.js";
import {
  abortGitStage,
  remainingGitStageTime,
  requireGitStageIndex,
  validateGitStageApply,
  validateGitStageRequest,
} from "./git-stage-validation.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitStageMutationManagerOptions extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitStagePreviewRequest {
  path: string;
  contextLines?: number;
  hunkIndexes?: number[];
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
  hunkIndexes?: number[];
  hunkSelectionSha256: string;
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
    const validated = validateGitStageRequest(request);
    this.prune();
    const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_STAGE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const repositoryState = await snapshotGitRepository(repository);
    requireGitStageIndex(repositoryState);
    const absolutePath = path.join(repository.root, validated.path);
    await assertGitStagePathAncestors(repository, validated.path);
    const [pathState, attributesStateSha256] = await Promise.all([
      snapshotGitStagePath(absolutePath),
      snapshotGitAttributeState(repository, validated.path),
    ]);
    abortGitStage(signal);
    const config = await assertGitConfigPolicy(
      this.options,
      repository,
      remainingGitStageTime(deadline),
      signal,
      "stage",
    );
    const initialIndexBytes = await boundIndexBytes(
      repository,
      repositoryState,
    );
    const prepared = await preparePrivateGitStage({
      processOptions: this.options,
      repository,
      initialIndexBytes,
      targetPath: validated.path,
      contextLines: request.contextLines ?? 3,
      ...(validated.hunkIndexes ? { hunkIndexes: validated.hunkIndexes } : {}),
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
        path: validated.path,
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
        path: validated.path,
        pathState,
        attributesStateSha256,
        repositoryState,
        contextLines: request.contextLines ?? 3,
        ...(validated.hunkIndexes
          ? { hunkIndexes: validated.hunkIndexes }
          : {}),
        hunkSelectionSha256: prepared.hunkSelectionSha256,
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
    validateGitStageApply(previewId, timeoutMs);
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
    abortGitStage(signal);
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
      remainingGitStageTime(deadline),
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
      ...(preview.hunkIndexes ? { hunkIndexes: preview.hunkIndexes } : {}),
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
        sha256(prepared.patch) !== preview.details.patchSha256 ||
        prepared.hunkSelectionSha256 !== preview.hunkSelectionSha256
      ) {
        throw new Error("Git stage preview is stale; preview the target again");
      }
      await assertPreviewState(
        repository,
        preview.repositoryState,
        absolutePath,
        preview.pathState,
        preview.attributesStateSha256,
      );
      await promotePreparedGitObjects(prepared, repository);
      abortGitStage(signal);
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
      const status = verified && committedDurably ? "applied" : "indeterminate";
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
      return {
        path: preview.path,
        patch: prepared.patch,
        selectionMode: prepared.selectionMode,
        selectedHunkCount: prepared.selectedHunkCount,
        details,
      };
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
      return {
        path: preview.path,
        patch: prepared.patch,
        selectionMode: prepared.selectionMode,
        selectedHunkCount: prepared.selectedHunkCount,
        details,
      };
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

function publicPreview(stored: StoredGitStagePreview): GitStagePreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    path: stored.path,
    patch: stored.patch,
    selectionMode: stored.hunkIndexes ? "hunks" : "path",
    selectedHunkCount: stored.hunkIndexes?.length ?? 0,
    details: structuredClone(stored.details),
  };
}
