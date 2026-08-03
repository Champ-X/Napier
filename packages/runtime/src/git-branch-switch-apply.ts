import { canonicalJson, sha256 } from "./ed25519.js";
import {
  GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
  gitBranchSwitchTransactionInput,
  gitSwitchBranchArguments,
} from "./git-branch-switch-arguments.js";
import {
  applyGitBranchCheckoutWorktree,
  assertGitBranchCheckoutWorktree,
  createGitBranchCheckoutTransaction,
  finalizeGitBranchCheckoutTransaction,
  installGitBranchCheckoutTargetIndex,
  rollbackGitBranchCheckoutTransaction,
  type GitBranchCheckoutTransaction,
} from "./git-branch-switch-checkout-transaction.js";
import { cleanupGitBranchCheckoutDirectory } from "./git-branch-switch-checkout-files.js";
import type {
  GitBranchCheckoutPlan,
  PreparedGitBranchCheckout,
} from "./git-branch-switch-checkout-model.js";
import { createGitBranchSwitchDetails } from "./git-branch-switch-details.js";
import type {
  GitBranchSwitchApplyResult,
  GitBranchSwitchDetails,
} from "./git-branch-switch-model.js";
import {
  gitBranchSwitchProcessEvidence,
  type PreparedGitBranchSwitch,
} from "./git-branch-switch-validation.js";
import {
  settleGitBranchSwitch,
  type GitBranchSwitchSettlement,
} from "./git-branch-switch-settlement.js";
import {
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  gitHeadSwitchWritePaths,
  syncGitHeadSwitch,
} from "./git-ref-files.js";

interface GitBranchSwitchApplyPreview {
  targetBranchName: string;
  targetRef: string;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  checkoutPlan?: GitBranchCheckoutPlan;
  details: GitBranchSwitchDetails;
  patch: string;
}

interface CheckoutCompletion {
  transaction: GitBranchCheckoutTransaction;
  indexDurable: boolean;
  baseProcesses: GitInspectProcessResult[];
}

export async function applyPreparedGitBranchSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview;
  prepared: PreparedGitBranchSwitch;
  recoveryAction: GitBranchSwitchDetails["recoveryAction"];
  preparedCheckout?: PreparedGitBranchCheckout;
  checkoutProcesses?: GitInspectProcessResult[];
  deadline: number;
  signal?: AbortSignal;
}): Promise<GitBranchSwitchApplyResult> {
  const checkoutPlan = input.preview.checkoutPlan;
  if (checkoutPlan) {
    if (!input.preparedCheckout) {
      throw new Error("Git branch checkout preparation is unavailable");
    }
    return applyDivergentSwitch({
      ...input,
      preview: { ...input.preview, checkoutPlan },
      preparedCheckout: input.preparedCheckout,
    });
  }
  return applyRefSwitch(input);
}

async function applyDivergentSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview & {
    checkoutPlan: GitBranchCheckoutPlan;
  };
  prepared: PreparedGitBranchSwitch;
  preparedCheckout: PreparedGitBranchCheckout;
  recoveryAction: GitBranchSwitchDetails["recoveryAction"];
  checkoutProcesses?: GitInspectProcessResult[];
  deadline: number;
  signal?: AbortSignal;
}): Promise<GitBranchSwitchApplyResult> {
  const transaction = await createGitBranchCheckoutTransaction({
    repository: input.repository,
    targetRef: input.preview.targetRef,
    headReflogState: input.preview.headReflogState,
    repositoryState: input.preview.repositoryState,
    prepared: input.preparedCheckout,
  });
  await cleanupGitBranchCheckoutDirectory(
    input.preparedCheckout.temporaryDirectory,
  );
  const baseProcesses = [
    ...input.prepared.processes,
    ...(input.checkoutProcesses ?? []),
  ];
  if (!(await applyGitBranchCheckoutWorktree(transaction))) {
    await rollbackCheckout(input, transaction);
    return uncertainCheckoutResult(
      input,
      baseProcesses,
      "Git branch checkout worktree commit failed",
    );
  }
  let indexDurable = false;
  try {
    indexDurable = await installGitBranchCheckoutTargetIndex({
      transaction,
      verifyCurrentState: async () => {
        await assertGitBranchSwitchSourceState(input);
        await assertGitBranchCheckoutWorktree(transaction, "target");
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    await rollbackCheckout(input, transaction);
    return uncertainCheckoutResult(input, baseProcesses, error);
  }
  if (!indexDurable || input.signal?.aborted) {
    await rollbackCheckout(input, transaction);
    return uncertainCheckoutResult(
      input,
      baseProcesses,
      indexDurable
        ? "Git branch checkout was cancelled before HEAD switch"
        : "Git branch checkout index durability is uncertain",
    );
  }
  return applyRefSwitch(input, {
    transaction,
    indexDurable,
    baseProcesses,
  });
}

async function applyRefSwitch(
  input: {
    options: GitInspectProcessOptions;
    repository: GitRepository;
    preview: GitBranchSwitchApplyPreview;
    prepared: PreparedGitBranchSwitch;
    recoveryAction: GitBranchSwitchDetails["recoveryAction"];
    preparedCheckout?: PreparedGitBranchCheckout;
    checkoutProcesses?: GitInspectProcessResult[];
    deadline: number;
    signal?: AbortSignal;
  },
  checkout?: CheckoutCompletion,
): Promise<GitBranchSwitchApplyResult> {
  const executed = await executeHeadSwitch(input);
  const switchClean =
    executed.result?.status === "succeeded" &&
    executed.result.stdout === "start: ok\nprepare: ok\ncommit: ok\n" &&
    executed.result.stderr.length === 0;
  const initial = await settlement(input);
  const headSwitched =
    initial.afterState?.currentRef === input.preview.targetRef &&
    initial.headCommitSha1 === input.preview.targetCommitSha1;
  const headDurable = headSwitched
    ? await syncGitHeadSwitch({
        repository: input.repository,
        oldCommitSha1: input.preview.sourceCommitSha1,
        newCommitSha1: input.preview.targetCommitSha1,
        message: GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
        beforeHeadReflog: input.preview.headReflogState,
      })
    : false;
  const final = headSwitched ? await settlement(input) : undefined;
  const checkoutVerified = checkout
    ? await assertGitBranchCheckoutWorktree(checkout.transaction, "target")
        .then(() => true)
        .catch(() => false)
    : true;
  const transactionComplete = await completeCheckoutTransaction({
    input,
    ...(checkout ? { checkout } : {}),
    switchClean,
    initialVerified: initial.verified,
    finalVerified: final?.verified === true,
    headSwitched,
    headDurable,
    checkoutVerified,
  });
  const verified = branchSwitchVerified({
    switchClean,
    initialVerified: initial.verified,
    finalVerified: final?.verified === true,
    headDurable,
    checkoutVerified,
    indexDurable: checkout?.indexDurable ?? true,
    transactionComplete,
  });
  const processes = [
    ...(checkout?.baseProcesses ?? [
      ...input.prepared.processes,
      ...(input.checkoutProcesses ?? []),
    ]),
    ...(executed.result ? [executed.result] : []),
    ...initial.processes,
    ...(final?.processes ?? []),
  ];
  const executionError = switchExecutionError(executed, switchClean);
  return resultFromSettlement({
    input,
    processes,
    initial,
    ...(final ? { final } : {}),
    switchStatus: executed.result?.status ?? "unknown",
    verified,
    ...(executionError ? { error: executionError } : {}),
  });
}

async function completeCheckoutTransaction(input: {
  input: Parameters<typeof applyRefSwitch>[0];
  checkout?: CheckoutCompletion;
  switchClean: boolean;
  initialVerified: boolean;
  finalVerified: boolean;
  headSwitched: boolean;
  headDurable: boolean;
  checkoutVerified: boolean;
}): Promise<boolean> {
  if (!input.checkout) return true;
  if (
    input.switchClean &&
    input.initialVerified &&
    input.finalVerified &&
    input.headDurable &&
    input.checkout.indexDurable &&
    input.checkoutVerified
  ) {
    return finalizeGitBranchCheckoutTransaction(input.checkout.transaction);
  }
  if (!input.headSwitched) {
    await rollbackCheckout(input.input, input.checkout.transaction);
  }
  return false;
}

function branchSwitchVerified(input: {
  switchClean: boolean;
  initialVerified: boolean;
  finalVerified: boolean;
  headDurable: boolean;
  checkoutVerified: boolean;
  indexDurable: boolean;
  transactionComplete: boolean;
}): boolean {
  return Object.values(input).every(Boolean);
}

function switchExecutionError(
  executed: { result?: GitInspectProcessResult; error?: unknown },
  switchClean: boolean,
): unknown {
  if (executed.error) return executed.error;
  return !switchClean && executed.result
    ? canonicalJson(executed.result)
    : undefined;
}

async function executeHeadSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview;
  deadline: number;
  signal?: AbortSignal;
}): Promise<{ result?: GitInspectProcessResult; error?: unknown }> {
  try {
    const result = await runGitProcess(
      input.options,
      gitSwitchBranchArguments(input.repository),
      remainingTime(input.deadline),
      input.signal,
      {
        operation: "switch",
        workspaceWritePaths: await validateSwitchStorage(
          input.repository,
          input.preview.targetRef,
        ),
        stdin: gitBranchSwitchTransactionInput(
          input.preview.targetRef,
          input.preview.sourceCommitSha1,
          input.preview.targetCommitSha1,
        ),
      },
    );
    return { result };
  } catch (error) {
    return { error };
  }
}

function settlement(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview;
  deadline: number;
}): Promise<GitBranchSwitchSettlement> {
  return settleGitBranchSwitch({
    options: input.options,
    repository: input.repository,
    targetRef: input.preview.targetRef,
    sourceCommitSha1: input.preview.sourceCommitSha1,
    targetCommitSha1: input.preview.targetCommitSha1,
    expectedIndexSha256:
      input.preview.checkoutPlan?.targetIndexSha256 ??
      input.preview.repositoryState.index.sha256,
    repositoryState: input.preview.repositoryState,
    headReflogState: input.preview.headReflogState,
    deadline: input.deadline,
  });
}

async function rollbackCheckout(
  input: {
    repository: GitRepository;
    preview: GitBranchSwitchApplyPreview;
  },
  transaction: GitBranchCheckoutTransaction,
): Promise<boolean> {
  return rollbackGitBranchCheckoutTransaction({
    transaction,
    verifySourceHead: () => assertGitBranchSwitchSourceHead(input),
  });
}

async function assertGitBranchSwitchSourceState(input: {
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview;
}): Promise<void> {
  const current = await snapshotGitRepository(input.repository, {
    allowIndexLock: true,
  });
  if (current.stateSha256 !== input.preview.repositoryState.stateSha256) {
    throw new Error("Git branch switch preview is stale");
  }
}

async function assertGitBranchSwitchSourceHead(input: {
  repository: GitRepository;
  preview: GitBranchSwitchApplyPreview;
}): Promise<void> {
  const current = await snapshotGitRepository(input.repository, {
    allowIndexLock: true,
  });
  if (
    current.headStateSha256 !== input.preview.repositoryState.headStateSha256 ||
    current.staticStateSha256 !==
      input.preview.repositoryState.staticStateSha256
  ) {
    throw new Error("Git branch checkout source HEAD changed");
  }
}

function uncertainCheckoutResult(
  input: {
    repository: GitRepository;
    preview: GitBranchSwitchApplyPreview;
    prepared: PreparedGitBranchSwitch;
    recoveryAction: GitBranchSwitchDetails["recoveryAction"];
    signal?: AbortSignal;
  },
  processes: GitInspectProcessResult[],
  error: unknown,
): GitBranchSwitchApplyResult {
  const evidence = gitBranchSwitchProcessEvidence(
    input.preview.sourceCommitSha1,
    input.preview.targetCommitSha1,
    processes,
  );
  const details = createGitBranchSwitchDetails({
    action: "apply",
    status: "indeterminate",
    postcondition: "indeterminate",
    targetRef: input.preview.targetRef,
    targetBranchName: input.preview.targetBranchName,
    repository: input.repository,
    repositoryState: input.preview.repositoryState,
    headReflogState: input.preview.headReflogState,
    evidence,
    ...(input.preview.checkoutPlan
      ? { checkout: input.preview.checkoutPlan }
      : {}),
    recoveryAction: input.recoveryAction,
    sourcePreviewResultSha256: input.preview.details.resultSha256,
    switchStatus: "unknown",
    errorSha256: sha256(errorText(error)),
    durable: false,
    cancellationObserved: input.signal?.aborted === true,
  });
  return {
    targetBranchName: input.preview.targetBranchName,
    patch: input.preview.patch,
    details,
  };
}

function resultFromSettlement(input: {
  input: {
    repository: GitRepository;
    preview: GitBranchSwitchApplyPreview;
    recoveryAction: GitBranchSwitchDetails["recoveryAction"];
    signal?: AbortSignal;
  };
  processes: GitInspectProcessResult[];
  initial: GitBranchSwitchSettlement;
  final?: GitBranchSwitchSettlement;
  switchStatus: GitBranchSwitchDetails["switchStatus"];
  verified: boolean;
  error?: unknown;
}): GitBranchSwitchApplyResult {
  const observed = input.final ?? input.initial;
  const evidence = gitBranchSwitchProcessEvidence(
    input.input.preview.sourceCommitSha1,
    input.input.preview.targetCommitSha1,
    input.processes,
  );
  const details = createGitBranchSwitchDetails({
    action: "apply",
    status: input.verified ? "applied" : "indeterminate",
    postcondition: input.verified ? "verified" : "indeterminate",
    targetRef: input.input.preview.targetRef,
    targetBranchName: input.input.preview.targetBranchName,
    repository: input.input.repository,
    repositoryState: input.input.preview.repositoryState,
    headReflogState: input.input.preview.headReflogState,
    evidence,
    ...(input.input.preview.checkoutPlan
      ? { checkout: input.input.preview.checkoutPlan }
      : {}),
    recoveryAction: input.input.recoveryAction,
    ...(observed.afterState
      ? { afterRepositoryStateSha256: observed.afterState.stateSha256 }
      : {}),
    ...(observed.afterHeadReflog
      ? { afterHeadReflogState: observed.afterHeadReflog }
      : {}),
    sourcePreviewResultSha256: input.input.preview.details.resultSha256,
    switchStatus: input.switchStatus,
    ...(input.error ? { errorSha256: sha256(errorText(input.error)) } : {}),
    durable: input.verified,
    cancellationObserved: input.input.signal?.aborted === true,
  });
  return {
    targetBranchName: input.input.preview.targetBranchName,
    patch: input.input.preview.patch,
    details,
  };
}

async function validateSwitchStorage(
  repository: GitRepository,
  targetRef: string,
): Promise<string[]> {
  await gitBranchRefWritePaths(repository, targetRef);
  return gitHeadSwitchWritePaths(repository);
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch switch timed out");
  return remaining;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
