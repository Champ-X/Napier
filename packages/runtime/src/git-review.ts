import path from "node:path";

import { normalizeGitBranchName } from "./git-branch-model.js";
import { applyGitReviewPromotion } from "./git-review-apply.js";
import { gitReviewPromoteArguments } from "./git-review-arguments.js";
import { createGitReviewDetails } from "./git-review-details.js";
import {
  DEFAULT_GIT_REVIEW_TIMEOUT_MS,
  GIT_REVIEW_PREVIEW_TTL_MS,
  type GitReviewApplyResult,
  type GitReviewDetails,
  type GitReviewPreview,
  MAX_GIT_REVIEW_PREVIEWS,
  MAX_GIT_REVIEW_TIMEOUT_MS,
} from "./git-review-model.js";
import {
  prepareGitReview,
  type PreparedGitReview,
} from "./git-review-prepare.js";
import {
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  resolveGitRepository,
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  snapshotGitBranchReflog,
  snapshotGitHeadReflog,
} from "./git-ref-files.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitReviewMutationManagerOptions extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitReviewPreviewRequest {
  targetBranchName: string;
  timeoutMs?: number;
}

export interface StoredGitReviewPreview {
  id: string;
  threadId: string;
  scopeId: string;
  sourceBranchName: string;
  sourceBranchRef: string;
  targetBranchName: string;
  targetBranchRef: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  targetReflogState: GitBoundFile;
  prepared: PreparedGitReview;
  details: GitReviewDetails;
  expiresAt: string;
  createdAtMs: number;
}

const reviewManagers = new WeakMap<
  object,
  WeakMap<object, GitReviewMutationManager>
>();

export function gitReviewMutationManagerFor(
  store: { workspaceRoot: string; dataRoot: string },
  sandbox: GitInspectProcessOptions["sandbox"],
): GitReviewMutationManager {
  let bySandbox = reviewManagers.get(store);
  if (!bySandbox) {
    bySandbox = new WeakMap();
    reviewManagers.set(store, bySandbox);
  }
  const existing = bySandbox.get(sandbox);
  if (existing) return existing;
  const created = new GitReviewMutationManager({
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    sandbox,
  });
  bySandbox.set(sandbox, created);
  return created;
}

export class GitReviewMutationManager {
  private readonly previews = new Map<string, StoredGitReviewPreview>();
  private readonly currentTime: () => Date;

  constructor(private readonly options: GitReviewMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
  }

  async preview(
    threadId: string,
    scopeId: string,
    request: GitReviewPreviewRequest,
    signal?: AbortSignal,
  ): Promise<GitReviewPreview> {
    const validated = validatePreviewRequest(request);
    this.prune();
    const now = this.validNow();
    const deadline = Date.now() + validated.timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const repositoryState = await snapshotGitRepository(repository);
    const sourceBranch = requireAttachedSourceBranch(repositoryState);
    if (sourceBranch.name === validated.targetBranchName) {
      throw new Error("Git review target must differ from the source branch");
    }
    const targetBranchRef = `refs/heads/${validated.targetBranchName}`;
    await gitBranchRefWritePaths(repository, targetBranchRef);
    const [headReflogState, targetReflogState] = await snapshotReviewReflogs(
      repository,
      targetBranchRef,
    );
    const prepared = await prepareGitReview({
      options: this.options,
      repository,
      sourceBranchRef: sourceBranch.ref,
      targetBranchRef,
      headReflogState,
      targetReflogState,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertGitReviewState(
      repository,
      repositoryState,
      headReflogState,
      targetBranchRef,
      targetReflogState,
    );
    const id = createId("gitreviewpreview");
    const expiresAt = new Date(
      now.getTime() + GIT_REVIEW_PREVIEW_TTL_MS,
    ).toISOString();
    const details = createGitReviewDetails({
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      previewId: id,
      expiresAt,
      sourceBranchName: sourceBranch.name,
      targetBranchName: validated.targetBranchName,
      repository,
      repositoryState,
      plan: prepared.plan,
      evidence: prepared.evidence,
      durable: false,
      cancellationObserved: signal?.aborted === true,
    });
    const stored: StoredGitReviewPreview = {
      id,
      threadId,
      scopeId,
      sourceBranchName: sourceBranch.name,
      sourceBranchRef: sourceBranch.ref,
      targetBranchName: validated.targetBranchName,
      targetBranchRef,
      repositoryState,
      headReflogState,
      targetReflogState,
      prepared,
      details,
      expiresAt,
      createdAtMs: now.getTime(),
    };
    this.previews.set(id, stored);
    this.prune();
    return publicPreview(stored);
  }

  async apply(
    threadId: string,
    scopeId: string,
    previewId: string,
    timeoutMs = DEFAULT_GIT_REVIEW_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<GitReviewApplyResult> {
    validateApply(previewId, timeoutMs);
    this.prune();
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.threadId !== threadId ||
      preview.scopeId !== scopeId
    ) {
      throw new Error("Git review preview not found");
    }
    this.previews.delete(previewId);
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      throw new Error("Git review preview expired");
    }
    abort(signal);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      reviewLockPaths(repository, preview),
      "Git review promotion apply",
      () => this.applyUnderLock(repository, preview, timeoutMs, signal),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitReviewPreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitReviewApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await assertStoredPreviewState(repository, preview);
    const prepared = await prepareGitReview({
      options: this.options,
      repository,
      sourceBranchRef: preview.sourceBranchRef,
      targetBranchRef: preview.targetBranchRef,
      expectedSourceCommitSha1: preview.prepared.plan.sourceCommitSha1,
      expectedTargetCommitSha1: preview.prepared.plan.targetCommitSha1,
      expectedPlanSha256: preview.prepared.plan.planSha256,
      headReflogState: preview.headReflogState,
      targetReflogState: preview.targetReflogState,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertStoredPreviewState(repository, preview);
    abort(signal);
    return this.promote(repository, preview, prepared, deadline, signal);
  }

  private async promote(
    repository: GitRepository,
    preview: StoredGitReviewPreview,
    prepared: PreparedGitReview,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<GitReviewApplyResult> {
    let update: GitInspectProcessResult | undefined;
    let updateError: unknown;
    try {
      update = await runGitProcess(
        this.options,
        gitReviewPromoteArguments(
          repository,
          preview.targetBranchRef,
          prepared.plan.sourceCommitSha1,
          prepared.plan.targetCommitSha1,
        ),
        remainingTime(deadline),
        signal,
        {
          operation: "review",
          workspaceWritePaths: await gitBranchRefWritePaths(
            repository,
            preview.targetBranchRef,
          ),
        },
      );
    } catch (error) {
      updateError = error;
    }
    return applyGitReviewPromotion({
      options: this.options,
      repository,
      preview,
      prepared,
      deadline,
      ...(signal ? { signal } : {}),
      ...(update ? { update } : {}),
      ...(updateError ? { updateError } : {}),
    });
  }

  private prune(): void {
    const now = this.validNow().getTime();
    for (const [id, preview] of this.previews) {
      if (Date.parse(preview.expiresAt) <= now) this.previews.delete(id);
    }
    const ordered = [...this.previews.values()].sort(
      (left, right) => left.createdAtMs - right.createdAtMs,
    );
    while (ordered.length > MAX_GIT_REVIEW_PREVIEWS) {
      this.previews.delete(ordered.shift()!.id);
    }
  }

  private validNow(): Date {
    const now = this.currentTime();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Git review clock is invalid");
    }
    return now;
  }
}

async function assertStoredPreviewState(
  repository: GitRepository,
  preview: StoredGitReviewPreview,
): Promise<void> {
  await assertGitReviewState(
    repository,
    preview.repositoryState,
    preview.headReflogState,
    preview.targetBranchRef,
    preview.targetReflogState,
  );
}

async function assertGitReviewState(
  repository: GitRepository,
  repositoryState: GitRepositoryState,
  headReflogState: GitBoundFile,
  targetBranchRef: string,
  targetReflogState: GitBoundFile,
): Promise<void> {
  const [current, headReflog, targetReflog] = await Promise.all([
    snapshotGitRepository(repository),
    snapshotGitHeadReflog(repository),
    snapshotGitBranchReflog(repository, targetBranchRef),
  ]);
  if (
    current.stateSha256 !== repositoryState.stateSha256 ||
    !sameBoundFile(headReflog, headReflogState) ||
    !sameBoundFile(targetReflog, targetReflogState)
  ) {
    throw new Error("Git review preview is stale; preview the review again");
  }
}

async function snapshotReviewReflogs(
  repository: GitRepository,
  targetBranchRef: string,
): Promise<[GitBoundFile, GitBoundFile]> {
  try {
    return await Promise.all([
      snapshotGitHeadReflog(repository),
      snapshotGitBranchReflog(repository, targetBranchRef),
    ]);
  } catch {
    throw new Error("Git review requires canonical HEAD and target reflogs");
  }
}

function requireAttachedSourceBranch(state: GitRepositoryState): {
  name: string;
  ref: string;
} {
  const prefix = "refs/heads/";
  if (!state.currentRef?.startsWith(prefix)) {
    throw new Error("Git review requires an attached local source branch");
  }
  const name = normalizeGitBranchName(state.currentRef.slice(prefix.length));
  return { name, ref: state.currentRef };
}

function validatePreviewRequest(request: GitReviewPreviewRequest): {
  targetBranchName: string;
  timeoutMs: number;
} {
  const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_REVIEW_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  return {
    targetBranchName: normalizeGitBranchName(request.targetBranchName),
    timeoutMs,
  };
}

function validateApply(previewId: string, timeoutMs: number): void {
  if (!/^gitreviewpreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git review preview ID is invalid");
  }
  validateTimeout(timeoutMs);
}

function validateTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_REVIEW_TIMEOUT_MS
  ) {
    throw new Error("Git review timeout is invalid");
  }
}

function reviewLockPaths(
  repository: GitRepository,
  preview: StoredGitReviewPreview,
): string[] {
  return [
    path.join(repository.gitDirectory, "HEAD"),
    path.join(repository.gitDirectory, preview.sourceBranchRef),
    path.join(repository.gitDirectory, preview.targetBranchRef),
  ];
}

function publicPreview(preview: StoredGitReviewPreview): GitReviewPreview {
  return {
    id: preview.id,
    expiresAt: preview.expiresAt,
    sourceBranchName: preview.sourceBranchName,
    targetBranchName: preview.targetBranchName,
    patch: preview.prepared.patch,
    details: structuredClone(preview.details),
  };
}

function sameBoundFile(left: GitBoundFile, right: GitBoundFile): boolean {
  return (
    left.present === right.present &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.mode === right.mode
  );
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git review operation timed out");
  return remaining;
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git review operation was aborted");
}
