import path from "node:path";

import {
  DEFAULT_GIT_BRANCH_TIMEOUT_MS,
  GIT_BRANCH_PREVIEW_TTL_MS,
  MAX_GIT_BRANCH_PREVIEWS,
  MAX_GIT_BRANCH_TIMEOUT_MS,
  normalizeGitBranchName,
} from "./git-branch-model.js";
import { applyPreparedGitBranchSwitch } from "./git-branch-switch-apply.js";
import { cleanupGitBranchCheckoutDirectory } from "./git-branch-switch-checkout-files.js";
import type { GitBranchCheckoutPlan } from "./git-branch-switch-checkout-model.js";
import { prepareGitBranchCheckout } from "./git-branch-switch-checkout-prepare.js";
import {
  gitBranchCheckoutRecoveryLockPaths,
  recoverGitBranchCheckoutTransactions,
} from "./git-branch-switch-checkout-recovery.js";
import { createGitBranchSwitchDetails } from "./git-branch-switch-details.js";
import {
  type GitBranchSwitchApplyResult,
  type GitBranchSwitchDetails,
  type GitBranchSwitchPreview,
} from "./git-branch-switch-model.js";
import {
  assertGitBranchSwitchState,
  gitBranchSwitchProcessEvidence,
  prepareGitBranchSwitch,
} from "./git-branch-switch-validation.js";
import type { GitInspectProcessOptions } from "./git-inspect-process.js";
import {
  resolveGitRepository,
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  gitHeadSwitchWritePaths,
  snapshotGitHeadReflog,
} from "./git-ref-files.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitBranchSwitchMutationManagerOptions extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitBranchSwitchPreviewRequest {
  targetBranchName: string;
  timeoutMs?: number;
}

interface StoredGitBranchSwitchPreview {
  id: string;
  threadId: string;
  scopeId: string;
  targetBranchName: string;
  targetRef: string;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  checkoutPlan?: GitBranchCheckoutPlan;
  patch: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  details: GitBranchSwitchDetails;
  expiresAt: string;
  createdAtMs: number;
}

const switchManagers = new WeakMap<
  object,
  WeakMap<object, GitBranchSwitchMutationManager>
>();

export function gitBranchSwitchMutationManagerFor(
  store: { workspaceRoot: string; dataRoot: string },
  sandbox: GitInspectProcessOptions["sandbox"],
): GitBranchSwitchMutationManager {
  let bySandbox = switchManagers.get(store);
  if (!bySandbox) {
    bySandbox = new WeakMap();
    switchManagers.set(store, bySandbox);
  }
  const existing = bySandbox.get(sandbox);
  if (existing) return existing;
  const created = new GitBranchSwitchMutationManager({
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    sandbox,
  });
  bySandbox.set(sandbox, created);
  return created;
}

export class GitBranchSwitchMutationManager {
  private readonly previews = new Map<string, StoredGitBranchSwitchPreview>();
  private readonly currentTime: () => Date;

  constructor(private readonly options: GitBranchSwitchMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
  }

  async preview(
    threadId: string,
    scopeId: string,
    request: GitBranchSwitchPreviewRequest,
    signal?: AbortSignal,
  ): Promise<GitBranchSwitchPreview> {
    const validated = validatePreviewRequest(request);
    this.prune();
    const now = this.validNow();
    const deadline = Date.now() + validated.timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const targetRef = `refs/heads/${validated.targetBranchName}`;
    const recoveryLocks = await gitBranchCheckoutRecoveryLockPaths(repository);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [...recoveryLocks, path.join(repository.gitDirectory, targetRef)],
      "Git branch switch preview",
      () =>
        this.previewUnderLock({
          threadId,
          scopeId,
          targetBranchName: validated.targetBranchName,
          targetRef,
          now,
          deadline,
          repository,
          recoveryLocks,
          ...(signal ? { signal } : {}),
        }),
    );
  }

  private async previewUnderLock(input: {
    threadId: string;
    scopeId: string;
    targetBranchName: string;
    targetRef: string;
    now: Date;
    deadline: number;
    repository: GitRepository;
    recoveryLocks: string[];
    signal?: AbortSignal;
  }): Promise<GitBranchSwitchPreview> {
    const recovery = await recoverGitBranchCheckoutTransactions({
      options: this.options,
      repository: input.repository,
      deadline: input.deadline,
      lockedPaths: input.recoveryLocks,
    });
    const [repositoryState, headReflogState] = await Promise.all([
      snapshotGitRepository(input.repository),
      snapshotGitHeadReflog(input.repository),
    ]);
    if (repositoryState.currentRef === input.targetRef) {
      throw new Error("Git branch switch target is already current");
    }
    await validateSwitchStorage(input.repository, input.targetRef);
    const prepared = await prepareGitBranchSwitch({
      options: this.options,
      repository: input.repository,
      targetRef: input.targetRef,
      deadline: input.deadline,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const checkoutPreparation =
      prepared.sourceCommitSha1 !== prepared.targetCommitSha1
        ? await prepareGitBranchCheckout({
            options: this.options,
            repository: input.repository,
            repositoryState,
            configOutput: prepared.configProcess.stdout,
            sourceCommitSha1: prepared.sourceCommitSha1,
            targetCommitSha1: prepared.targetCommitSha1,
            deadline: input.deadline,
            ...(input.signal ? { signal: input.signal } : {}),
          })
        : undefined;
    const checkout = checkoutPreparation?.checkout;
    try {
      await assertGitBranchSwitchState(
        input.repository,
        repositoryState,
        headReflogState,
      );
      const id = createId("gitswitchpreview");
      const expiresAt = new Date(
        input.now.getTime() + GIT_BRANCH_PREVIEW_TTL_MS,
      ).toISOString();
      const evidence =
        checkoutPreparation || recovery.processes.length > 0
          ? gitBranchSwitchProcessEvidence(
              prepared.sourceCommitSha1,
              prepared.targetCommitSha1,
              [
                ...recovery.processes,
                ...prepared.processes,
                ...(checkoutPreparation?.processes ?? []),
              ],
            )
          : prepared.evidence;
      const details = createGitBranchSwitchDetails({
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId: id,
        expiresAt,
        targetRef: input.targetRef,
        targetBranchName: input.targetBranchName,
        repository: input.repository,
        repositoryState,
        headReflogState,
        evidence,
        ...(checkout ? { checkout: checkout.plan } : {}),
        recoveryAction: recovery.action,
        durable: false,
        cancellationObserved: input.signal?.aborted === true,
      });
      const stored: StoredGitBranchSwitchPreview = {
        id,
        threadId: input.threadId,
        scopeId: input.scopeId,
        targetBranchName: input.targetBranchName,
        targetRef: input.targetRef,
        sourceCommitSha1: prepared.sourceCommitSha1,
        targetCommitSha1: prepared.targetCommitSha1,
        ...(checkout ? { checkoutPlan: checkout.plan } : {}),
        patch: checkout?.patch ?? "",
        repositoryState,
        headReflogState,
        details,
        expiresAt,
        createdAtMs: input.now.getTime(),
      };
      this.previews.set(id, stored);
      this.prune();
      return publicPreview(stored);
    } finally {
      if (checkout) {
        await cleanupGitBranchCheckoutDirectory(checkout.temporaryDirectory);
      }
    }
  }

  async apply(
    threadId: string,
    scopeId: string,
    previewId: string,
    timeoutMs = DEFAULT_GIT_BRANCH_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<GitBranchSwitchApplyResult> {
    validateApply(previewId, timeoutMs);
    this.prune();
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.threadId !== threadId ||
      preview.scopeId !== scopeId
    ) {
      throw new Error("Git branch switch preview not found");
    }
    this.previews.delete(previewId);
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      throw new Error("Git branch switch preview expired");
    }
    abort(signal);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const recoveryLocks = await gitBranchCheckoutRecoveryLockPaths(repository);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [
        ...recoveryLocks,
        path.join(repository.gitDirectory, preview.targetRef),
        ...(preview.checkoutPlan?.files.map((file) =>
          path.join(repository.root, file.path),
        ) ?? []),
      ],
      "Git branch switch apply",
      () =>
        this.applyUnderLock(
          repository,
          preview,
          recoveryLocks,
          timeoutMs,
          signal,
        ),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitBranchSwitchPreview,
    recoveryLocks: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitBranchSwitchApplyResult> {
    const deadline = Date.now() + timeoutMs;
    const recovery = await recoverGitBranchCheckoutTransactions({
      options: this.options,
      repository,
      deadline,
      lockedPaths: recoveryLocks,
    });
    await assertGitBranchSwitchState(
      repository,
      preview.repositoryState,
      preview.headReflogState,
    );
    const prepared = await prepareGitBranchSwitch({
      options: this.options,
      repository,
      targetRef: preview.targetRef,
      expectedSourceCommitSha1: preview.sourceCommitSha1,
      expectedTargetCommitSha1: preview.targetCommitSha1,
      deadline,
      ...(signal ? { signal } : {}),
    });
    const checkoutPreparation =
      preview.sourceCommitSha1 !== preview.targetCommitSha1
        ? await prepareGitBranchCheckout({
            options: this.options,
            repository,
            repositoryState: preview.repositoryState,
            configOutput: prepared.configProcess.stdout,
            sourceCommitSha1: preview.sourceCommitSha1,
            targetCommitSha1: preview.targetCommitSha1,
            ...(preview.checkoutPlan
              ? { expectedPlanSha256: preview.checkoutPlan.planSha256 }
              : {}),
            deadline,
            ...(signal ? { signal } : {}),
          })
        : undefined;
    const checkout = checkoutPreparation?.checkout;
    try {
      await assertGitBranchSwitchState(
        repository,
        preview.repositoryState,
        preview.headReflogState,
      );
      abort(signal);
      return await applyPreparedGitBranchSwitch({
        options: this.options,
        repository,
        preview,
        prepared,
        recoveryAction: recovery.action,
        ...(checkout
          ? {
              preparedCheckout: checkout,
            }
          : {}),
        ...(checkoutPreparation || recovery.processes.length > 0
          ? {
              checkoutProcesses: [
                ...recovery.processes,
                ...(checkoutPreparation?.processes ?? []),
              ],
            }
          : {}),
        deadline,
        ...(signal ? { signal } : {}),
      });
    } finally {
      if (checkout) {
        await cleanupGitBranchCheckoutDirectory(checkout.temporaryDirectory);
      }
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
    while (ordered.length > MAX_GIT_BRANCH_PREVIEWS) {
      this.previews.delete(ordered.shift()!.id);
    }
  }

  private validNow(): Date {
    const now = this.currentTime();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Git branch switch clock is invalid");
    }
    return now;
  }
}

async function validateSwitchStorage(
  repository: GitRepository,
  targetRef: string,
): Promise<string[]> {
  await gitBranchRefWritePaths(repository, targetRef);
  return gitHeadSwitchWritePaths(repository);
}

function validatePreviewRequest(request: GitBranchSwitchPreviewRequest): {
  targetBranchName: string;
  timeoutMs: number;
} {
  const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_BRANCH_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  return {
    targetBranchName: normalizeGitBranchName(request.targetBranchName),
    timeoutMs,
  };
}

function validateApply(previewId: string, timeoutMs: number): void {
  if (!/^gitswitchpreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git branch switch preview ID is invalid");
  }
  validateTimeout(timeoutMs);
}

function validateTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_BRANCH_TIMEOUT_MS
  ) {
    throw new Error("Git branch switch timeout is invalid");
  }
}

function publicPreview(
  stored: StoredGitBranchSwitchPreview,
): GitBranchSwitchPreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    targetBranchName: stored.targetBranchName,
    patch: stored.patch,
    details: structuredClone(stored.details),
  };
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Git branch switch was aborted");
  }
}
