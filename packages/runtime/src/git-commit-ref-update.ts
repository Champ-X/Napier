import { canonicalJson, sha256 } from "./ed25519.js";
import { createGitCommitDetails } from "./git-commit-details.js";
import {
  finalizeGitMergeOperationState,
  isolateGitMergeOperationState,
  rollbackGitMergeOperationState,
  type GitCommitOperationState,
} from "./git-commit-operation.js";
import type { PreparedGitCommit } from "./git-commit-private.js";
import {
  settleGitCommit,
  type GitCommitSettlement,
} from "./git-commit-settlement.js";
import type {
  GitCommitApplyResult,
  GitCommitDetails,
} from "./git-commit-model.js";
import { gitUpdateBranchArguments } from "./git-inspect-arguments.js";
import {
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import type { GitRepository, GitRepositoryState } from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  syncGitBranchRefTransition,
} from "./git-ref-files.js";

export async function applyGitCommitRefUpdate(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: {
    message: string;
    branchRef: string;
    timestampSeconds: number;
    contextLines: number;
    repositoryState: GitRepositoryState;
    operationState: GitCommitOperationState;
    details: GitCommitDetails;
  };
  prepared: PreparedGitCommit;
  deadline: number;
  signal?: AbortSignal;
}): Promise<GitCommitApplyResult> {
  const update = await executeRefUpdate(input);
  const updateStatus = update.result?.status ?? "unknown";
  const updateClean =
    update.result?.status === "succeeded" &&
    update.result.stdout.length === 0 &&
    update.result.stderr.length === 0;
  const initialSettlement = await settleGitCommit({
    options: input.options,
    repository: input.repository,
    preview: input.preview,
    prepared: input.prepared,
    operationCleared: false,
    deadline: input.deadline,
  });
  const committed =
    initialSettlement.branchCommitSha1 === input.prepared.commitSha1;
  const durable =
    committed && initialSettlement.verified
      ? await syncGitBranchRefTransition({
          repository: input.repository,
          branchRef: input.preview.branchRef,
          oldObjectId: input.prepared.parentCommitSha1,
          newObjectId: input.prepared.commitSha1,
          includeHeadReflog: true,
        })
      : false;
  const completion = await completeCommitOperation({
    input,
    updateClean,
    committed,
    initialVerified: initialSettlement.verified,
    durable,
  });
  const { operationClean, finalSettlement } = completion;
  const verified = commitOutcomeVerified({
    committed,
    initialVerified: initialSettlement.verified,
    finalVerified: finalSettlement?.verified === true,
    updateClean,
    durable,
    operationClean,
  });
  const observedSettlement = finalSettlement ?? initialSettlement;
  const details = createGitCommitDetails({
    action: "apply",
    status: verified ? "applied" : "indeterminate",
    postcondition: verified ? "verified" : "indeterminate",
    message: input.preview.message,
    branchRef: input.preview.branchRef,
    timestampSeconds: input.preview.timestampSeconds,
    contextLines: input.preview.contextLines,
    repository: input.repository,
    repositoryState: input.preview.repositoryState,
    prepared: input.prepared,
    ...(observedSettlement.afterState
      ? {
          afterHeadStateSha256: observedSettlement.afterState.headStateSha256,
        }
      : {}),
    sourcePreviewResultSha256: input.preview.details.resultSha256,
    refUpdateStatus: updateStatus,
    ...(update.error
      ? { errorSha256: sha256(errorText(update.error)) }
      : !updateClean && update.result
        ? { errorSha256: sha256(canonicalJson(update.result)) }
        : {}),
    durationMs:
      input.prepared.durationMs +
      (update.result?.durationMs ?? 0) +
      initialSettlement.durationMs +
      (finalSettlement?.durationMs ?? 0),
    environmentSha256: sha256(
      canonicalJson([
        input.prepared.environmentSha256,
        update.result?.environmentSha256 ?? null,
        ...initialSettlement.environmentSha256,
        ...(finalSettlement?.environmentSha256 ?? []),
      ]),
    ),
    resourceLimitsSha256: sha256(
      canonicalJson([
        input.prepared.resourceLimitsSha256,
        update.result?.resourceLimitsSha256 ?? null,
        ...initialSettlement.resourceLimitsSha256,
        ...(finalSettlement?.resourceLimitsSha256 ?? []),
      ]),
    ),
    durable: verified,
    cancellationObserved: input.signal?.aborted === true,
  });
  return {
    branchRef: input.preview.branchRef,
    message: input.preview.message,
    stagedPatch: input.prepared.stagedPatch,
    details,
  };
}

async function completeCommitOperation(input: {
  input: Parameters<typeof applyGitCommitRefUpdate>[0];
  updateClean: boolean;
  committed: boolean;
  initialVerified: boolean;
  durable: boolean;
}): Promise<{
  operationClean: boolean;
  finalSettlement?: GitCommitSettlement;
}> {
  if (!input.committed || !input.initialVerified || !input.durable) {
    return { operationClean: false };
  }
  if (input.input.preview.operationState.kind === "ordinary") {
    return {
      operationClean: true,
      finalSettlement: await finalCommitSettlement(input.input),
    };
  }
  if (!input.updateClean) return { operationClean: false };
  const transaction = await isolateGitMergeOperationState({
    repository: input.input.repository,
    expected: input.input.preview.operationState,
  });
  if (!transaction) return { operationClean: false };
  const finalSettlement = await finalCommitSettlement(input.input);
  if (
    finalSettlement.verified &&
    (await finalizeGitMergeOperationState(transaction))
  ) {
    return { operationClean: true, finalSettlement };
  }
  await rollbackGitMergeOperationState(transaction);
  return { operationClean: false };
}

function finalCommitSettlement(
  input: Parameters<typeof applyGitCommitRefUpdate>[0],
): Promise<GitCommitSettlement> {
  return settleGitCommit({
    options: input.options,
    repository: input.repository,
    preview: input.preview,
    prepared: input.prepared,
    operationCleared: true,
    deadline: input.deadline,
  });
}

function commitOutcomeVerified(input: {
  committed: boolean;
  initialVerified: boolean;
  finalVerified: boolean;
  updateClean: boolean;
  durable: boolean;
  operationClean: boolean;
}): boolean {
  return Object.values(input).every(Boolean);
}

async function executeRefUpdate(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: {
    branchRef: string;
    timestampSeconds: number;
  };
  prepared: PreparedGitCommit;
  deadline: number;
  signal?: AbortSignal;
}): Promise<{ result?: GitInspectProcessResult; error?: unknown }> {
  try {
    const result = await runGitProcess(
      input.options,
      gitUpdateBranchArguments(
        input.repository,
        input.preview.branchRef,
        input.prepared.commitSha1,
        input.prepared.parentCommitSha1,
      ),
      remainingTime(input.deadline),
      input.signal,
      {
        operation: "commit",
        workspaceWritePaths: await gitBranchRefWritePaths(
          input.repository,
          input.preview.branchRef,
        ),
        commitTimestampSeconds: input.preview.timestampSeconds,
      },
    );
    return { result };
  } catch (error) {
    return { error };
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git commit operation timed out");
  return remaining;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
