import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  gitHeadCommitArguments,
  gitRefCommitArguments,
} from "./git-inspect-arguments.js";
import {
  assertGitBranchCheckoutDirectory,
  syncGitBranchCheckoutPaths,
} from "./git-branch-switch-checkout-files.js";
import {
  inspectGitBranchCheckoutTransaction,
  readGitBranchCheckoutManifest,
} from "./git-branch-switch-checkout-recovery-files.js";
import {
  assertGitBranchCheckoutWorktree,
  finalizeGitBranchCheckoutTransaction,
  rollbackGitBranchCheckoutTransaction,
  type GitBranchCheckoutTransaction,
} from "./git-branch-switch-checkout-transaction.js";
import {
  runGitInspectProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  gitErrorCode,
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
} from "./git-repository.js";
import {
  gitBranchRefWritePaths,
  gitHeadSwitchWritePaths,
  snapshotGitHeadReflog,
  syncGitHeadSwitch,
} from "./git-ref-files.js";
import { syncDirectory } from "./workspace-file-scope.js";

const ACTIVE = /^checkout-[A-Za-z0-9]{6}$/u;
const COMPLETE = /^checkout-[A-Za-z0-9]{6}\.complete$/u;
const PREVIEW = /^preview-[A-Za-z0-9]{6}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;

export const GIT_BRANCH_CHECKOUT_RECOVERY_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    activeTransactionLimit: 1,
    sourceOutcome: "restore_worktree_then_index",
    targetOutcome: "verify_ref_reflog_index_worktree_then_complete",
    unknownOutcome: "fail_closed_preserve_backup",
    completionBoundary: "complete_rename_and_parent_fsync",
  }),
);

export interface GitBranchCheckoutRecoveryResult {
  action: "none" | "rolled_back" | "completed";
  processes: GitInspectProcessResult[];
}

export async function gitBranchCheckoutRecoveryLockPaths(
  repository: GitRepository,
): Promise<string[]> {
  const base = recoveryBasePaths(repository);
  const root = path.join(repository.gitDirectory, "napier-switch");
  try {
    await assertGitBranchCheckoutDirectory(root);
    const entries = await readdir(root, { withFileTypes: true });
    const active = entries.filter(
      (entry) => entry.isDirectory() && ACTIVE.test(entry.name),
    );
    if (active.length !== 1) return base;
    const manifest = await readGitBranchCheckoutManifest(
      path.join(root, active[0]!.name, "manifest.json"),
    );
    return [
      ...base,
      path.join(repository.gitDirectory, manifest.targetRef),
      ...manifest.plan.files.map((file) =>
        path.join(repository.root, file.path),
      ),
    ];
  } catch {
    return base;
  }
}

export async function recoverGitBranchCheckoutTransactions(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  deadline: number;
  lockedPaths: readonly string[];
}): Promise<GitBranchCheckoutRecoveryResult> {
  const root = path.join(input.repository.gitDirectory, "napier-switch");
  let entries;
  try {
    await assertGitBranchCheckoutDirectory(root);
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") {
      return { action: "none", processes: [] };
    }
    throw new Error("Git branch checkout recovery failed");
  }
  try {
    const related = entries.filter(
      (entry) =>
        entry.name.startsWith("checkout-") || entry.name.startsWith("preview-"),
    );
    if (
      related.some(
        (entry) =>
          !entry.isDirectory() ||
          (!ACTIVE.test(entry.name) &&
            !COMPLETE.test(entry.name) &&
            !PREVIEW.test(entry.name)),
      )
    ) {
      throw new Error("invalid recovery entry");
    }
    const active = related.filter((entry) => ACTIVE.test(entry.name));
    if (active.length > 1) throw new Error("multiple active transactions");
    const recovery = active[0]
      ? await recoverActive(input, path.join(root, active[0].name))
      : { action: "none" as const, processes: [] };
    for (const entry of related.filter((candidate) =>
      COMPLETE.test(candidate.name),
    )) {
      await garbageCollectCompleted(
        input.repository,
        root,
        path.join(root, entry.name),
      );
    }
    return recovery;
  } catch {
    throw new Error("Git branch checkout recovery failed");
  }
}

async function recoverActive(
  input: {
    options: GitInspectProcessOptions;
    repository: GitRepository;
    deadline: number;
    lockedPaths: readonly string[];
  },
  directory: string,
): Promise<GitBranchCheckoutRecoveryResult> {
  const transaction = await inspectGitBranchCheckoutTransaction(
    input.repository,
    directory,
  );
  const lockedPaths = new Set(input.lockedPaths);
  if (
    !lockedPaths.has(
      path.join(input.repository.gitDirectory, transaction.manifest.targetRef),
    ) ||
    transaction.manifest.plan.files.some(
      (file) => !lockedPaths.has(path.join(input.repository.root, file.path)),
    )
  ) {
    throw new Error("recovery worktree paths are not locked");
  }
  const [head, target, state, headReflog] = await Promise.all([
    runGitInspectProcess(
      input.options,
      gitHeadCommitArguments(input.repository),
      remainingTime(input.deadline),
    ),
    runGitInspectProcess(
      input.options,
      gitRefCommitArguments(input.repository, transaction.manifest.targetRef),
      remainingTime(input.deadline),
    ),
    snapshotGitRepository(input.repository),
    snapshotGitHeadReflog(input.repository),
  ]);
  const headCommitSha1 = requireCommit(head);
  const targetCommitSha1 = requireCommit(target);
  const plan = transaction.manifest.plan;
  if (
    targetCommitSha1 !== plan.targetCommitSha1 ||
    state.staticStateSha256 !== transaction.manifest.beforeStaticStateSha256
  ) {
    throw new Error("recovery repository state changed");
  }
  if (headCommitSha1 === plan.sourceCommitSha1) {
    if (
      state.headStateSha256 !== transaction.manifest.beforeHeadStateSha256 ||
      boundFileStateSha256(headReflog) !==
        boundFileStateSha256(transaction.manifest.headReflogState) ||
      !(await rollbackGitBranchCheckoutTransaction({
        transaction,
        verifySourceHead: () =>
          verifyRecoverySourceState(input.repository, transaction),
      }))
    ) {
      throw new Error("recovery rollback failed");
    }
    return { action: "rolled_back", processes: [head, target] };
  }
  if (
    headCommitSha1 !== plan.targetCommitSha1 ||
    state.currentRef !== transaction.manifest.targetRef ||
    state.index.sha256 !== plan.targetIndexSha256
  ) {
    throw new Error("recovery HEAD state is unknown");
  }
  await assertGitBranchCheckoutWorktree(transaction, "target");
  await Promise.all([
    gitBranchRefWritePaths(input.repository, transaction.manifest.targetRef),
    gitHeadSwitchWritePaths(input.repository),
  ]);
  if (
    !(await syncGitHeadSwitch({
      repository: input.repository,
      oldCommitSha1: plan.sourceCommitSha1,
      newCommitSha1: plan.targetCommitSha1,
      message: "napier switch branch",
      beforeHeadReflog: transaction.manifest.headReflogState,
    })) ||
    !(await syncGitBranchCheckoutPaths(
      input.repository,
      plan.files.map((file) => file.path),
    ))
  ) {
    throw new Error("recovery durability failed");
  }
  await syncDirectory(input.repository.gitDirectory);
  const [finalHead, finalTarget, finalState] = await Promise.all([
    runGitInspectProcess(
      input.options,
      gitHeadCommitArguments(input.repository),
      remainingTime(input.deadline),
    ),
    runGitInspectProcess(
      input.options,
      gitRefCommitArguments(input.repository, transaction.manifest.targetRef),
      remainingTime(input.deadline),
    ),
    snapshotGitRepository(input.repository),
  ]);
  await assertGitBranchCheckoutWorktree(transaction, "target");
  if (
    requireCommit(finalHead) !== plan.targetCommitSha1 ||
    requireCommit(finalTarget) !== plan.targetCommitSha1 ||
    finalState.currentRef !== transaction.manifest.targetRef ||
    finalState.index.sha256 !== plan.targetIndexSha256 ||
    finalState.staticStateSha256 !==
      transaction.manifest.beforeStaticStateSha256
  ) {
    throw new Error("recovery final settlement failed");
  }
  if (!(await finalizeGitBranchCheckoutTransaction(transaction))) {
    throw new Error("recovery completion failed");
  }
  return {
    action: "completed",
    processes: [head, target, finalHead, finalTarget],
  };
}

async function verifyRecoverySourceState(
  repository: GitRepository,
  transaction: GitBranchCheckoutTransaction,
): Promise<void> {
  const state = await snapshotGitRepository(repository, {
    allowIndexLock: true,
  });
  if (
    state.headStateSha256 !== transaction.manifest.beforeHeadStateSha256 ||
    state.staticStateSha256 !== transaction.manifest.beforeStaticStateSha256
  ) {
    throw new Error("recovery source state changed");
  }
}

async function garbageCollectCompleted(
  repository: GitRepository,
  root: string,
  directory: string,
): Promise<void> {
  try {
    await inspectGitBranchCheckoutTransaction(repository, directory);
    await rm(directory, { recursive: true });
    await syncDirectory(root);
  } catch {
    // Completed private garbage can remain without changing Git state.
  }
}

function recoveryBasePaths(repository: GitRepository): string[] {
  return [
    path.join(repository.gitDirectory, "napier-switch"),
    path.join(repository.gitDirectory, "index"),
    path.join(repository.gitDirectory, "HEAD"),
    path.join(repository.gitDirectory, "logs/HEAD"),
  ];
}

function requireCommit(result: GitInspectProcessResult): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !SHA1.test(value)
  ) {
    throw new Error("Git branch checkout recovery commit is unavailable");
  }
  return value;
}

function boundFileStateSha256(value: GitBoundFile): string {
  return sha256(
    canonicalJson({
      present: value.present,
      sha256: value.sha256,
      bytes: value.bytes,
      mode: value.mode,
    }),
  );
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch switch timed out");
  return remaining;
}
