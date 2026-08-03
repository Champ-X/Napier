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
  type GitStageApplyResult,
  type GitStageDetails,
  type GitStagePreview,
  MAX_GIT_STAGE_PREVIEWS,
} from "./git-stage-model.js";
import {
  assertGitStageTargetsState,
  snapshotGitStageTargets,
  type GitStageTarget,
  verifyGitStageTargetsApplied,
} from "./git-stage-targets.js";
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
  path?: string;
  paths?: string[];
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
  targets: GitStageTarget[];
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
    const targets = await snapshotGitStageTargets(repository, validated.paths);
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
      targetPaths: validated.paths,
      contextLines: request.contextLines ?? 3,
      ...(validated.hunkIndexes ? { hunkIndexes: validated.hunkIndexes } : {}),
      deadline,
      configProcess: config,
      ...(signal ? { signal } : {}),
    });
    let stored: StoredGitStagePreview;
    try {
      validatePreparedStage(prepared);
      await assertGitStageTargetsState(repository, repositoryState, targets);
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
        targets,
        contextLines: request.contextLines ?? 3,
        prepared,
        durable: false,
        cancellationObserved: signal?.aborted === true,
      });
      stored = {
        id: previewId,
        threadId,
        scopeId,
        targets,
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
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [
        path.join(repository.gitDirectory, "index"),
        ...preview.targets.map((target) => target.absolutePath),
      ],
      "Git stage apply",
      () => this.applyUnderLock(repository, preview, timeoutMs, signal),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitStagePreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitStageApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await assertGitStageTargetsState(
      repository,
      preview.repositoryState,
      preview.targets,
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
      targetPaths: preview.targets.map((target) => target.path),
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
      await assertGitStageTargetsState(
        repository,
        preview.repositoryState,
        preview.targets,
      );
      await promotePreparedGitObjects(prepared, repository);
      abortGitStage(signal);
      durable = await installPreparedGitIndex({
        prepared,
        repository,
        indexMode: preview.repositoryState.index.mode,
        verifyCurrentState: () =>
          assertGitStageTargetsState(
            repository,
            preview.repositoryState,
            preview.targets,
            true,
          ),
        ...(signal ? { signal } : {}),
      });
      committed = true;
      const verified = await verifyGitStageTargetsApplied({
        repository,
        expectedRepository: preview.repositoryState,
        expectedTargets: preview.targets,
        expectedIndexSha256: prepared.indexSha256,
      });
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
        targets: preview.targets,
        contextLines: preview.contextLines,
        prepared,
        ...(verified ? { afterIndexSha256: prepared.indexSha256 } : {}),
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: committedDurably,
        cancellationObserved: signal?.aborted === true,
      });
      return {
        path: preview.targets[0]!.path,
        paths: preview.targets.map((target) => target.path),
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
        targets: preview.targets,
        contextLines: preview.contextLines,
        prepared,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: false,
        cancellationObserved: signal?.aborted === true,
      });
      return {
        path: preview.targets[0]!.path,
        paths: preview.targets.map((target) => target.path),
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
  if (prepared.counts.fileCount !== prepared.targetCount) {
    throw new Error("Git stage preview must contain every target file");
  }
}

function publicPreview(stored: StoredGitStagePreview): GitStagePreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    path: stored.targets[0]!.path,
    paths: stored.targets.map((target) => target.path),
    patch: stored.patch,
    selectionMode: stored.hunkIndexes ? "hunks" : "path",
    selectedHunkCount: stored.hunkIndexes?.length ?? 0,
    details: structuredClone(stored.details),
  };
}
