import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_GIT_BRANCH_TIMEOUT_MS,
  GIT_BRANCH_PREVIEW_TTL_MS,
  MAX_GIT_BRANCH_PREVIEWS,
  MAX_GIT_BRANCH_TIMEOUT_MS,
  normalizeGitBranchName,
} from "./git-branch-model.js";
import { createGitBranchSwitchDetails } from "./git-branch-switch-details.js";
import {
  type GitBranchSwitchApplyResult,
  type GitBranchSwitchDetails,
  type GitBranchSwitchPreview,
} from "./git-branch-switch-model.js";
import { settleGitBranchSwitch } from "./git-branch-switch-settlement.js";
import {
  assertGitBranchSwitchState,
  gitBranchSwitchProcessEvidence,
  prepareGitBranchSwitch,
  type PreparedGitBranchSwitch,
} from "./git-branch-switch-validation.js";
import {
  GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
  gitBranchSwitchTransactionInput,
  gitSwitchBranchArguments,
} from "./git-inspect-arguments.js";
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
  gitHeadSwitchWritePaths,
  snapshotGitHeadReflog,
  syncGitHeadSwitch,
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
  commitSha1: string;
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
    const [repositoryState, headReflogState] = await Promise.all([
      snapshotGitRepository(repository),
      snapshotGitHeadReflog(repository),
    ]);
    const targetRef = `refs/heads/${validated.targetBranchName}`;
    if (repositoryState.currentRef === targetRef) {
      throw new Error("Git branch switch target is already current");
    }
    await validateSwitchStorage(repository, targetRef);
    const prepared = await prepareGitBranchSwitch({
      options: this.options,
      repository,
      targetRef,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertGitBranchSwitchState(
      repository,
      repositoryState,
      headReflogState,
    );
    const id = createId("gitswitchpreview");
    const expiresAt = new Date(
      now.getTime() + GIT_BRANCH_PREVIEW_TTL_MS,
    ).toISOString();
    const details = createGitBranchSwitchDetails({
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      previewId: id,
      expiresAt,
      targetRef,
      targetBranchName: validated.targetBranchName,
      repository,
      repositoryState,
      headReflogState,
      evidence: prepared.evidence,
      durable: false,
      cancellationObserved: signal?.aborted === true,
    });
    const stored: StoredGitBranchSwitchPreview = {
      id,
      threadId,
      scopeId,
      targetBranchName: validated.targetBranchName,
      targetRef,
      commitSha1: prepared.evidence.commitSha1,
      repositoryState,
      headReflogState,
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
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [
        path.join(repository.gitDirectory, "HEAD"),
        path.join(repository.gitDirectory, "logs/HEAD"),
        path.join(repository.gitDirectory, preview.targetRef),
      ],
      "Git branch switch apply",
      () => this.applyUnderLock(repository, preview, timeoutMs, signal),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitBranchSwitchPreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitBranchSwitchApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await assertGitBranchSwitchState(
      repository,
      preview.repositoryState,
      preview.headReflogState,
    );
    const prepared = await prepareGitBranchSwitch({
      options: this.options,
      repository,
      targetRef: preview.targetRef,
      expectedCommitSha1: preview.commitSha1,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertGitBranchSwitchState(
      repository,
      preview.repositoryState,
      preview.headReflogState,
    );
    abort(signal);
    return this.switchHead(repository, preview, prepared, deadline, signal);
  }

  private async switchHead(
    repository: GitRepository,
    preview: StoredGitBranchSwitchPreview,
    prepared: PreparedGitBranchSwitch,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<GitBranchSwitchApplyResult> {
    let switched: GitInspectProcessResult | undefined;
    let switchError: unknown;
    try {
      switched = await runGitProcess(
        this.options,
        gitSwitchBranchArguments(repository),
        remainingTime(deadline),
        signal,
        {
          operation: "switch",
          workspaceWritePaths: await validateSwitchStorage(
            repository,
            preview.targetRef,
          ),
          stdin: gitBranchSwitchTransactionInput(
            preview.targetRef,
            preview.commitSha1,
          ),
        },
      );
    } catch (error) {
      switchError = error;
    }
    const switchClean =
      switched?.status === "succeeded" &&
      switched.stdout === "start: ok\nprepare: ok\ncommit: ok\n" &&
      switched.stderr.length === 0;
    const initial = await settleGitBranchSwitch({
      options: this.options,
      repository,
      targetRef: preview.targetRef,
      commitSha1: preview.commitSha1,
      repositoryState: preview.repositoryState,
      headReflogState: preview.headReflogState,
      deadline,
    });
    const headSwitched =
      initial.afterState?.currentRef === preview.targetRef &&
      initial.headCommitSha1 === preview.commitSha1;
    const durable = headSwitched
      ? await syncGitHeadSwitch({
          repository,
          commitSha1: preview.commitSha1,
          message: GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
          beforeHeadReflog: preview.headReflogState,
        })
      : false;
    const final = headSwitched
      ? await settleGitBranchSwitch({
          options: this.options,
          repository,
          targetRef: preview.targetRef,
          commitSha1: preview.commitSha1,
          repositoryState: preview.repositoryState,
          headReflogState: preview.headReflogState,
          deadline,
        })
      : undefined;
    const verified =
      headSwitched &&
      initial.verified &&
      final?.verified === true &&
      switchClean &&
      durable;
    const observed = final ?? initial;
    const processes = [
      ...prepared.processes,
      ...(switched ? [switched] : []),
      ...initial.processes,
      ...(final?.processes ?? []),
    ];
    const details = createGitBranchSwitchDetails({
      action: "apply",
      status: verified ? "applied" : "indeterminate",
      postcondition: verified ? "verified" : "indeterminate",
      targetRef: preview.targetRef,
      targetBranchName: preview.targetBranchName,
      repository,
      repositoryState: preview.repositoryState,
      headReflogState: preview.headReflogState,
      evidence: gitBranchSwitchProcessEvidence(preview.commitSha1, processes),
      ...(observed.afterState
        ? {
            afterRepositoryStateSha256: observed.afterState.stateSha256,
          }
        : {}),
      ...(observed.afterHeadReflog
        ? { afterHeadReflogState: observed.afterHeadReflog }
        : {}),
      sourcePreviewResultSha256: preview.details.resultSha256,
      switchStatus: switched?.status ?? "unknown",
      ...(switchError
        ? { errorSha256: sha256(errorText(switchError)) }
        : !switchClean && switched
          ? { errorSha256: sha256(canonicalJson(switched)) }
          : {}),
      durable: verified,
      cancellationObserved: signal?.aborted === true,
    });
    return {
      targetBranchName: preview.targetBranchName,
      details,
    };
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
    details: structuredClone(stored.details),
  };
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch switch timed out");
  return remaining;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Git branch switch was aborted");
  }
}
