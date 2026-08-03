import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertGitMergeCleanupDirectory,
  GIT_MERGE_OPERATION_FILES,
  matchGitMergeOperationFile,
  rollbackGitMergeOperationState,
  snapshotGitMergeOperationBackup,
  type GitMergeOperationCleanup,
  type GitMergeOperationFileName,
} from "./git-commit-operation.js";
import { gitErrorCode, type GitRepository } from "./git-repository.js";
import { syncDirectory } from "./workspace-file-scope.js";

const ACTIVE_TRANSACTION = /^merge-cleanup-[A-Za-z0-9]{6}$/u;
const COMPLETE_TRANSACTION = /^merge-cleanup-[A-Za-z0-9]{6}\.complete$/u;
const TRANSACTION_PREFIX = "merge-cleanup-";

export async function recoverGitMergeOperationTransactions(
  repository: GitRepository,
): Promise<void> {
  const root = path.join(repository.gitDirectory, "napier-stage");
  try {
    await assertGitMergeCleanupDirectory(root);
    const entries = await readdir(root, { withFileTypes: true });
    const related = entries.filter((entry) =>
      entry.name.startsWith(TRANSACTION_PREFIX),
    );
    if (
      related.some(
        (entry) =>
          !entry.isDirectory() ||
          (!ACTIVE_TRANSACTION.test(entry.name) &&
            !COMPLETE_TRANSACTION.test(entry.name)),
      )
    ) {
      throw new Error("invalid transaction entry");
    }
    const active = related.filter((entry) =>
      ACTIVE_TRANSACTION.test(entry.name),
    );
    if (active.length > 1) throw new Error("multiple active transactions");
    if (active[0]) {
      await recoverActiveTransaction(
        repository,
        path.join(root, active[0].name),
      );
    }
    for (const completed of related.filter((entry) =>
      COMPLETE_TRANSACTION.test(entry.name),
    )) {
      await garbageCollectCompleted(root, path.join(root, completed.name));
    }
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") return;
    throw new Error("Git merge cleanup recovery failed");
  }
}

async function recoverActiveTransaction(
  repository: GitRepository,
  directory: string,
): Promise<void> {
  const inspected = await inspectTransactionDirectory(directory);
  const { backupDirectory, expected, isolatedDirectory, isolatedNames } =
    inspected;
  for (const name of GIT_MERGE_OPERATION_FILES) {
    const rootPresent = await matchGitMergeOperationFile(
      repository.gitDirectory,
      name,
      expected.files[name],
    );
    const isolatedPresent = await matchGitMergeOperationFile(
      isolatedDirectory,
      name,
      expected.files[name],
    );
    if (expected.files[name].present !== (rootPresent !== isolatedPresent)) {
      throw new Error("invalid transaction placement");
    }
  }
  const transaction: GitMergeOperationCleanup = {
    backupDirectory,
    directory,
    expected,
    isolatedDirectory,
    repository,
    moved: isolatedNames,
  };
  if (!(await rollbackGitMergeOperationState(transaction))) {
    throw new Error("transaction rollback failed");
  }
}

async function inspectTransactionDirectory(directory: string): Promise<{
  backupDirectory: string;
  expected: Awaited<ReturnType<typeof snapshotGitMergeOperationBackup>>;
  isolatedDirectory: string;
  isolatedNames: GitMergeOperationFileName[];
}> {
  await assertGitMergeCleanupDirectory(directory);
  const backupDirectory = path.join(directory, "backup");
  const isolatedDirectory = path.join(directory, "isolated");
  await assertExactDirectories(directory, ["backup", "isolated"]);
  await assertGitMergeCleanupDirectory(backupDirectory);
  await assertGitMergeCleanupDirectory(isolatedDirectory);
  const expected = await snapshotGitMergeOperationBackup(backupDirectory);
  const expectedNames = GIT_MERGE_OPERATION_FILES.filter(
    (name) => expected.files[name].present,
  );
  await assertExactFiles(backupDirectory, expectedNames);
  return {
    backupDirectory,
    expected,
    isolatedDirectory,
    isolatedNames: await operationFileNames(isolatedDirectory),
  };
}

async function assertExactDirectories(
  directory: string,
  expected: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some((entry) => !entry.isDirectory()) ||
    entries
      .map((entry) => entry.name)
      .sort()
      .join("\n") !== [...expected].sort().join("\n")
  ) {
    throw new Error("Git merge cleanup transaction is invalid");
  }
}

async function assertExactFiles(
  directory: string,
  expected: readonly GitMergeOperationFileName[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some((entry) => !entry.isFile()) ||
    entries
      .map((entry) => entry.name)
      .sort()
      .join("\n") !== [...expected].sort().join("\n")
  ) {
    throw new Error("Git merge cleanup files are invalid");
  }
}

async function operationFileNames(
  directory: string,
): Promise<GitMergeOperationFileName[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some(
      (entry) =>
        !entry.isFile() ||
        !GIT_MERGE_OPERATION_FILES.includes(
          entry.name as GitMergeOperationFileName,
        ),
    )
  ) {
    throw new Error("Git merge cleanup isolated files are invalid");
  }
  return entries.map((entry) => entry.name as GitMergeOperationFileName);
}

async function garbageCollectCompleted(
  root: string,
  directory: string,
): Promise<void> {
  try {
    const inspected = await inspectTransactionDirectory(directory);
    await assertExactFiles(
      inspected.isolatedDirectory,
      GIT_MERGE_OPERATION_FILES.filter(
        (name) => inspected.expected.files[name].present,
      ),
    );
    await rm(directory, { recursive: true });
    await syncDirectory(root);
  } catch {
    // The completion boundary is already durable; private garbage can remain.
  }
}
