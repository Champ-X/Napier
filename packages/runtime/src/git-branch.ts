import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createGitBranchDetails } from "./git-branch-details.js";
import {
  DEFAULT_GIT_BRANCH_TIMEOUT_MS,
  GIT_BRANCH_PREVIEW_TTL_MS,
  type GitBranchApplyResult,
  type GitBranchDetails,
  type GitBranchPreview,
  type GitBranchProcessEvidence,
  MAX_GIT_BRANCH_PREVIEWS,
  MAX_GIT_BRANCH_TIMEOUT_MS,
  normalizeGitBranchName,
} from "./git-branch-model.js";
import { settleGitBranchCreate } from "./git-branch-settlement.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  gitCreateBranchArguments,
  gitHeadCommitArguments,
  gitRefExistsArguments,
} from "./git-inspect-arguments.js";
import {
  runGitInspectProcess,
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  resolveGitRepository,
  snapshotGitRepository,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  syncGitBranchRefTransition,
  ZERO_GIT_OBJECT_ID,
} from "./git-ref-files.js";
import { createId } from "./ids.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface GitBranchMutationManagerOptions extends GitInspectProcessOptions {
  dataRoot: string;
  now?: () => Date;
}

export interface GitBranchPreviewRequest {
  branchName: string;
  timeoutMs?: number;
}

interface StoredGitBranchPreview {
  id: string;
  threadId: string;
  scopeId: string;
  branchName: string;
  branchRef: string;
  targetCommitSha1: string;
  repositoryState: GitRepositoryState;
  details: GitBranchDetails;
  expiresAt: string;
  createdAtMs: number;
}

interface PreparedGitBranch {
  evidence: GitBranchProcessEvidence;
  processes: GitInspectProcessResult[];
}

const branchManagers = new WeakMap<
  object,
  WeakMap<object, GitBranchMutationManager>
>();

export function gitBranchMutationManagerFor(
  store: { workspaceRoot: string; dataRoot: string },
  sandbox: GitInspectProcessOptions["sandbox"],
): GitBranchMutationManager {
  let bySandbox = branchManagers.get(store);
  if (!bySandbox) {
    bySandbox = new WeakMap();
    branchManagers.set(store, bySandbox);
  }
  const existing = bySandbox.get(sandbox);
  if (existing) return existing;
  const created = new GitBranchMutationManager({
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    sandbox,
  });
  bySandbox.set(sandbox, created);
  return created;
}

export class GitBranchMutationManager {
  private readonly previews = new Map<string, StoredGitBranchPreview>();
  private readonly currentTime: () => Date;

  constructor(private readonly options: GitBranchMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
  }

  async preview(
    threadId: string,
    scopeId: string,
    request: GitBranchPreviewRequest,
    signal?: AbortSignal,
  ): Promise<GitBranchPreview> {
    const validated = validatePreviewRequest(request);
    this.prune();
    const now = this.validNow();
    const deadline = Date.now() + validated.timeoutMs;
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const repositoryState = await snapshotGitRepository(repository);
    const branchRef = `refs/heads/${validated.branchName}`;
    await gitBranchRefWritePaths(repository, branchRef);
    const prepared = await prepareGitBranch({
      options: this.options,
      repository,
      branchRef,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertGitBranchState(repository, repositoryState);
    const id = createId("gitbranchpreview");
    const expiresAt = new Date(
      now.getTime() + GIT_BRANCH_PREVIEW_TTL_MS,
    ).toISOString();
    const details = createGitBranchDetails({
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      previewId: id,
      expiresAt,
      branchName: validated.branchName,
      repository,
      repositoryState,
      evidence: prepared.evidence,
      durable: false,
      cancellationObserved: signal?.aborted === true,
    });
    const stored: StoredGitBranchPreview = {
      id,
      threadId,
      scopeId,
      branchName: validated.branchName,
      branchRef,
      targetCommitSha1: prepared.evidence.targetCommitSha1,
      repositoryState,
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
  ): Promise<GitBranchApplyResult> {
    validateApply(previewId, timeoutMs);
    this.prune();
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.threadId !== threadId ||
      preview.scopeId !== scopeId
    ) {
      throw new Error("Git branch preview not found");
    }
    this.previews.delete(previewId);
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      throw new Error("Git branch preview expired");
    }
    abort(signal);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    return withWorkspacePathLocks(
      this.options.dataRoot,
      [path.join(repository.gitDirectory, preview.branchRef)],
      "Git branch create apply",
      () => this.applyUnderLock(repository, preview, timeoutMs, signal),
    );
  }

  private async applyUnderLock(
    repository: GitRepository,
    preview: StoredGitBranchPreview,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GitBranchApplyResult> {
    const deadline = Date.now() + timeoutMs;
    await assertGitBranchState(repository, preview.repositoryState);
    const prepared = await prepareGitBranch({
      options: this.options,
      repository,
      branchRef: preview.branchRef,
      expectedTargetCommitSha1: preview.targetCommitSha1,
      deadline,
      ...(signal ? { signal } : {}),
    });
    await assertGitBranchState(repository, preview.repositoryState);
    abort(signal);
    return this.createRef(repository, preview, prepared, deadline, signal);
  }

  private async createRef(
    repository: GitRepository,
    preview: StoredGitBranchPreview,
    prepared: PreparedGitBranch,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<GitBranchApplyResult> {
    let update: GitInspectProcessResult | undefined;
    let updateError: unknown;
    try {
      update = await runGitProcess(
        this.options,
        gitCreateBranchArguments(
          repository,
          preview.branchRef,
          preview.targetCommitSha1,
        ),
        remainingTime(deadline),
        signal,
        {
          operation: "branch",
          workspaceWritePaths: await gitBranchRefWritePaths(
            repository,
            preview.branchRef,
          ),
        },
      );
    } catch (error) {
      updateError = error;
    }
    const updateClean =
      update?.status === "succeeded" &&
      update.stdout.length === 0 &&
      update.stderr.length === 0;
    const initial = await settleGitBranchCreate({
      options: this.options,
      repository,
      branchRef: preview.branchRef,
      targetCommitSha1: preview.targetCommitSha1,
      repositoryState: preview.repositoryState,
      deadline,
    });
    const created = initial.branchCommitSha1 === preview.targetCommitSha1;
    const durable = created
      ? await syncGitBranchRefTransition({
          repository,
          branchRef: preview.branchRef,
          oldObjectId: ZERO_GIT_OBJECT_ID,
          newObjectId: preview.targetCommitSha1,
          includeHeadReflog: false,
        })
      : false;
    const final = created
      ? await settleGitBranchCreate({
          options: this.options,
          repository,
          branchRef: preview.branchRef,
          targetCommitSha1: preview.targetCommitSha1,
          repositoryState: preview.repositoryState,
          deadline,
        })
      : undefined;
    const verified =
      created &&
      initial.verified &&
      final?.verified === true &&
      updateClean &&
      durable;
    const observed = final ?? initial;
    const processes = [
      ...prepared.processes,
      ...(update ? [update] : []),
      ...initial.processes,
      ...(final?.processes ?? []),
    ];
    const details = createGitBranchDetails({
      action: "apply",
      status: verified ? "applied" : "indeterminate",
      postcondition: verified ? "verified" : "indeterminate",
      branchName: preview.branchName,
      repository,
      repositoryState: preview.repositoryState,
      evidence: processEvidence(preview.targetCommitSha1, processes),
      ...(observed.afterState
        ? {
            afterRepositoryStateSha256: observed.afterState.stateSha256,
          }
        : {}),
      sourcePreviewResultSha256: preview.details.resultSha256,
      refUpdateStatus: update?.status ?? "unknown",
      ...(updateError
        ? { errorSha256: sha256(errorText(updateError)) }
        : !updateClean && update
          ? { errorSha256: sha256(canonicalJson(update)) }
          : {}),
      durable: verified,
      cancellationObserved: signal?.aborted === true,
    });
    return { branchName: preview.branchName, details };
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
      throw new Error("Git branch clock is invalid");
    }
    return now;
  }
}

async function prepareGitBranch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  branchRef: string;
  expectedTargetCommitSha1?: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PreparedGitBranch> {
  const config = await assertGitConfigPolicy(
    input.options,
    input.repository,
    remainingTime(input.deadline),
    input.signal,
    "branch",
  );
  const head = await runGitInspectProcess(
    input.options,
    gitHeadCommitArguments(input.repository),
    remainingTime(input.deadline),
    input.signal,
  );
  const targetCommitSha1 = requireCommit(head);
  if (
    input.expectedTargetCommitSha1 &&
    targetCommitSha1 !== input.expectedTargetCommitSha1
  ) {
    throw new Error("Git branch preview is stale; preview the branch again");
  }
  const exists = await runGitInspectProcess(
    input.options,
    gitRefExistsArguments(input.repository, input.branchRef),
    remainingTime(input.deadline),
    input.signal,
  );
  assertBranchAbsent(exists);
  const processes = [config, head, exists];
  return {
    evidence: processEvidence(targetCommitSha1, processes),
    processes,
  };
}

async function assertGitBranchState(
  repository: GitRepository,
  expected: GitRepositoryState,
): Promise<void> {
  if (
    (await snapshotGitRepository(repository)).stateSha256 !==
    expected.stateSha256
  ) {
    throw new Error("Git branch preview is stale; preview the branch again");
  }
}

function assertBranchAbsent(result: GitInspectProcessResult): void {
  if (
    result.status === "failed" &&
    result.exitCode === 1 &&
    result.stdout.length === 0 &&
    result.stderr.length === 0
  ) {
    return;
  }
  if (result.status === "succeeded") {
    throw new Error("Git branch already exists");
  }
  throw new Error("Git branch existence could not be verified");
}

function requireCommit(result: GitInspectProcessResult): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !/^[a-f0-9]{40}$/u.test(value)
  ) {
    throw new Error("Git branch target commit is unavailable");
  }
  return value;
}

function processEvidence(
  targetCommitSha1: string,
  processes: GitInspectProcessResult[],
): GitBranchProcessEvidence {
  return {
    targetCommitSha1,
    sandboxSha256: sha256(
      canonicalJson(processes.map((item) => item.sandboxSha256)),
    ),
    executableSha256: sha256(
      canonicalJson(processes.map((item) => item.executableSha256)),
    ),
    environmentSha256: sha256(
      canonicalJson(processes.map((item) => item.environmentSha256)),
    ),
    resourceLimitsSha256: sha256(
      canonicalJson(processes.map((item) => item.resourceLimitsSha256)),
    ),
    durationMs: processes.reduce((total, item) => total + item.durationMs, 0),
  };
}

function validatePreviewRequest(request: GitBranchPreviewRequest): {
  branchName: string;
  timeoutMs: number;
} {
  const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_BRANCH_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  return {
    branchName: normalizeGitBranchName(request.branchName),
    timeoutMs,
  };
}

function validateApply(previewId: string, timeoutMs: number): void {
  if (!/^gitbranchpreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git branch preview ID is invalid");
  }
  validateTimeout(timeoutMs);
}

function validateTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_BRANCH_TIMEOUT_MS
  ) {
    throw new Error("Git branch timeout is invalid");
  }
}

function publicPreview(stored: StoredGitBranchPreview): GitBranchPreview {
  return {
    id: stored.id,
    expiresAt: stored.expiresAt,
    branchName: stored.branchName,
    details: structuredClone(stored.details),
  };
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch operation timed out");
  return remaining;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git branch operation was aborted");
}
