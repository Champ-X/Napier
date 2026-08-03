import { lstat, mkdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertGitBranchCheckoutDirectory,
  cleanupGitBranchCheckoutDirectory,
  createGitBranchCheckoutPrivateDirectory,
  readGitBranchCheckoutPrivateFile,
  snapshotGitBranchCheckoutPath,
  syncGitBranchCheckoutPaths,
  writeGitBranchCheckoutFile,
} from "./git-branch-switch-checkout-files.js";
import {
  MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES,
  type GitBranchCheckoutFile,
  type GitBranchCheckoutPlan,
  type PreparedGitBranchCheckout,
} from "./git-branch-switch-checkout-model.js";
import {
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import { installPreparedGitIndex } from "./git-stage-private-index.js";
import { syncDirectory } from "./workspace-file-scope.js";

export interface GitBranchCheckoutTransactionManifest {
  schemaVersion: 1;
  targetRef: string;
  indexMode: number;
  beforeRepositoryStateSha256: string;
  beforeHeadStateSha256: string;
  beforeStaticStateSha256: string;
  headReflogState: GitBoundFile;
  plan: GitBranchCheckoutPlan;
  manifestSha256: string;
}

export interface GitBranchCheckoutTransaction {
  repository: GitRepository;
  directory: string;
  backupDirectory: string;
  stagedDirectory: string;
  sourceIndexPath: string;
  targetIndexPath: string;
  manifestPath: string;
  manifest: GitBranchCheckoutTransactionManifest;
}

export async function createGitBranchCheckoutTransaction(input: {
  repository: GitRepository;
  targetRef: string;
  headReflogState: GitBoundFile;
  repositoryState: GitRepositoryState;
  prepared: PreparedGitBranchCheckout;
}): Promise<GitBranchCheckoutTransaction> {
  if (
    !input.targetRef.startsWith("refs/heads/") ||
    !input.headReflogState.present
  ) {
    throw new Error("Git branch checkout transaction input is invalid");
  }
  const directory = await createGitBranchCheckoutPrivateDirectory(
    input.repository,
    "checkout-",
  );
  const backupDirectory = path.join(directory, "backup");
  const stagedDirectory = path.join(directory, "staged");
  const sourceIndexPath = path.join(directory, "source-index");
  const targetIndexPath = path.join(directory, "target-index");
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await mkdir(backupDirectory, { mode: 0o700 });
    await mkdir(stagedDirectory, { mode: 0o700 });
    await assertGitBranchCheckoutDirectory(backupDirectory);
    await assertGitBranchCheckoutDirectory(stagedDirectory);
    await writeGitBranchCheckoutFile(
      sourceIndexPath,
      input.prepared.sourceIndexBytes,
      input.repositoryState.index.mode,
    );
    await writeGitBranchCheckoutFile(
      targetIndexPath,
      input.prepared.targetIndexBytes,
      input.repositoryState.index.mode,
    );
    for (const [index, file] of input.prepared.files.entries()) {
      const state = await assertCheckoutFileState(
        input.repository,
        file,
        "source",
      );
      const name = transactionFileName(index);
      if (state.present) {
        const backupPath = path.join(backupDirectory, name);
        await writeGitBranchCheckoutFile(
          backupPath,
          state.content!,
          file.beforeMode!,
        );
        await assertPrivateFile(
          backupPath,
          file.beforeSha256!,
          file.beforeMode!,
        );
      }
      if (file.targetContent) {
        const stagedPath = path.join(stagedDirectory, name);
        await writeGitBranchCheckoutFile(
          stagedPath,
          file.targetContent,
          file.expectedMode!,
        );
        await assertPrivateFile(
          stagedPath,
          file.expectedSha256!,
          file.expectedMode!,
        );
      }
    }
    const manifestContent = {
      schemaVersion: 1 as const,
      targetRef: input.targetRef,
      indexMode: input.repositoryState.index.mode,
      beforeRepositoryStateSha256: input.repositoryState.stateSha256,
      beforeHeadStateSha256: input.repositoryState.headStateSha256,
      beforeStaticStateSha256: input.repositoryState.staticStateSha256,
      headReflogState: input.headReflogState,
      plan: input.prepared.plan,
    };
    const manifest = {
      ...manifestContent,
      manifestSha256: sha256(canonicalJson(manifestContent)),
    };
    await writeGitBranchCheckoutFile(
      manifestPath,
      Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"),
      0o600,
    );
    await syncDirectory(backupDirectory);
    await syncDirectory(stagedDirectory);
    await syncDirectory(directory);
    await syncDirectory(path.dirname(directory));
    return {
      repository: input.repository,
      directory,
      backupDirectory,
      stagedDirectory,
      sourceIndexPath,
      targetIndexPath,
      manifestPath,
      manifest,
    };
  } catch (error) {
    await cleanupGitBranchCheckoutDirectory(directory);
    throw error;
  }
}

export async function applyGitBranchCheckoutWorktree(
  transaction: GitBranchCheckoutTransaction,
): Promise<boolean> {
  try {
    await assertGitBranchCheckoutWorktree(transaction, "source");
    for (const [index, file] of transaction.manifest.plan.files.entries()) {
      await assertCheckoutFileState(transaction.repository, file, "source");
      const target = path.join(transaction.repository.root, file.path);
      if (file.expectedSha256 === null) {
        await unlink(target);
      } else {
        await rename(
          path.join(transaction.stagedDirectory, transactionFileName(index)),
          target,
        );
      }
      await assertCheckoutFileState(transaction.repository, file, "target");
    }
    return await syncGitBranchCheckoutPaths(
      transaction.repository,
      transaction.manifest.plan.files.map((file) => file.path),
    );
  } catch {
    return false;
  }
}

export async function installGitBranchCheckoutTargetIndex(input: {
  transaction: GitBranchCheckoutTransaction;
  verifyCurrentState: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<boolean> {
  const indexBytes = await readGitBranchCheckoutPrivateFile(
    input.transaction.targetIndexPath,
    64 * 1024 * 1024,
  );
  if (
    sha256(indexBytes) !== input.transaction.manifest.plan.targetIndexSha256
  ) {
    throw new Error("Git branch checkout target index changed");
  }
  return installPreparedGitIndex({
    prepared: { indexBytes },
    repository: input.transaction.repository,
    indexMode: input.transaction.manifest.indexMode,
    verifyCurrentState: input.verifyCurrentState,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function rollbackGitBranchCheckoutTransaction(input: {
  transaction: GitBranchCheckoutTransaction;
  verifySourceHead: () => Promise<void>;
}): Promise<boolean> {
  const { transaction } = input;
  let complete = true;
  for (const [index, file] of [
    ...transaction.manifest.plan.files.entries(),
  ].reverse()) {
    try {
      const current = await snapshotGitBranchCheckoutPath(
        transaction.repository,
        file.path,
      );
      if (matchesFileState(current, file, "source")) continue;
      if (!matchesFileState(current, file, "target")) {
        complete = false;
        continue;
      }
      const target = path.join(transaction.repository.root, file.path);
      if (file.beforeSha256 === null) {
        await unlink(target);
      } else {
        await rename(
          path.join(transaction.backupDirectory, transactionFileName(index)),
          target,
        );
      }
    } catch {
      complete = false;
    }
  }
  complete =
    (await syncGitBranchCheckoutPaths(
      transaction.repository,
      transaction.manifest.plan.files.map((file) => file.path),
    )) && complete;
  try {
    const state = await snapshotGitRepository(transaction.repository, {
      allowIndexLock: true,
    });
    if (state.index.sha256 === transaction.manifest.plan.targetIndexSha256) {
      const sourceIndex = await readGitBranchCheckoutPrivateFile(
        transaction.sourceIndexPath,
        64 * 1024 * 1024,
      );
      if (
        sha256(sourceIndex) !== transaction.manifest.plan.sourceIndexSha256 ||
        !(await installPreparedGitIndex({
          prepared: { indexBytes: sourceIndex },
          repository: transaction.repository,
          indexMode: transaction.manifest.indexMode,
          verifyCurrentState: input.verifySourceHead,
        }))
      ) {
        complete = false;
      }
    } else if (
      state.index.sha256 !== transaction.manifest.plan.sourceIndexSha256
    ) {
      complete = false;
    }
  } catch {
    complete = false;
  }
  const restored =
    complete &&
    (await assertGitBranchCheckoutWorktree(transaction, "source")
      .then(() => true)
      .catch(() => false)) &&
    (await snapshotGitRepository(transaction.repository)
      .then(
        (state) =>
          state.index.sha256 === transaction.manifest.plan.sourceIndexSha256,
      )
      .catch(() => false));
  if (!restored) return false;
  return cleanupTransaction(transaction);
}

export async function assertGitBranchCheckoutWorktree(
  transaction: GitBranchCheckoutTransaction,
  expected: "source" | "target",
): Promise<void> {
  for (const file of transaction.manifest.plan.files) {
    await assertCheckoutFileState(transaction.repository, file, expected);
  }
}

export async function finalizeGitBranchCheckoutTransaction(
  transaction: GitBranchCheckoutTransaction,
): Promise<boolean> {
  const completed = `${transaction.directory}.complete`;
  try {
    await rename(transaction.directory, completed);
    transaction.directory = completed;
    transaction.backupDirectory = path.join(completed, "backup");
    transaction.stagedDirectory = path.join(completed, "staged");
    transaction.sourceIndexPath = path.join(completed, "source-index");
    transaction.targetIndexPath = path.join(completed, "target-index");
    transaction.manifestPath = path.join(completed, "manifest.json");
    await syncDirectory(path.dirname(completed));
  } catch {
    return false;
  }
  await cleanupTransaction(transaction).catch(() => false);
  return true;
}

async function cleanupTransaction(
  transaction: GitBranchCheckoutTransaction,
): Promise<boolean> {
  try {
    await rm(transaction.directory, { recursive: true });
    await syncDirectory(path.dirname(transaction.directory));
    return true;
  } catch {
    return false;
  }
}

async function assertCheckoutFileState(
  repository: GitRepository,
  file: GitBranchCheckoutFile,
  expected: "source" | "target",
): Promise<Awaited<ReturnType<typeof snapshotGitBranchCheckoutPath>>> {
  const state = await snapshotGitBranchCheckoutPath(repository, file.path);
  if (!matchesFileState(state, file, expected)) {
    throw new Error(`Git branch checkout ${expected} file state changed`);
  }
  return state;
}

function matchesFileState(
  state: Awaited<ReturnType<typeof snapshotGitBranchCheckoutPath>>,
  file: GitBranchCheckoutFile,
  expected: "source" | "target",
): boolean {
  const fileSha256 =
    expected === "source" ? file.beforeSha256 : file.expectedSha256;
  const mode = expected === "source" ? file.beforeMode : file.expectedMode;
  return fileSha256 === null
    ? !state.present
    : state.present && state.sha256 === fileSha256 && state.mode === mode;
}

async function assertPrivateFile(
  filePath: string,
  expectedSha256: string,
  expectedMode: number,
): Promise<void> {
  const info = await lstat(filePath);
  const content = await readGitBranchCheckoutPrivateFile(
    filePath,
    MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES,
  );
  if (
    sha256(content) !== expectedSha256 ||
    (info.mode & 0o777) !== expectedMode
  ) {
    throw new Error("Git branch checkout private file is invalid");
  }
}

function transactionFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 100) {
    throw new Error("Git branch checkout transaction file index is invalid");
  }
  return index.toString().padStart(2, "0");
}
