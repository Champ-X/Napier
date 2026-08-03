import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { normalizeGitBranchName } from "./git-branch-model.js";
import {
  assertGitBranchCheckoutDirectory,
  readGitBranchCheckoutPrivateFile,
} from "./git-branch-switch-checkout-files.js";
import {
  assertGitBranchCheckoutPlan,
  MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES,
  type GitBranchCheckoutPlan,
} from "./git-branch-switch-checkout-model.js";
import type {
  GitBranchCheckoutTransaction,
  GitBranchCheckoutTransactionManifest,
} from "./git-branch-switch-checkout-transaction.js";
import type { GitBoundFile, GitRepository } from "./git-repository.js";

const DIGEST = /^[a-f0-9]{64}$/u;

export async function inspectGitBranchCheckoutTransaction(
  repository: GitRepository,
  directory: string,
): Promise<GitBranchCheckoutTransaction> {
  await assertGitBranchCheckoutDirectory(directory);
  const backupDirectory = path.join(directory, "backup");
  const stagedDirectory = path.join(directory, "staged");
  await assertExactDirectories(directory, ["backup", "staged"]);
  await assertGitBranchCheckoutDirectory(backupDirectory);
  await assertGitBranchCheckoutDirectory(stagedDirectory);
  const sourceIndexPath = path.join(directory, "source-index");
  const targetIndexPath = path.join(directory, "target-index");
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = await readGitBranchCheckoutManifest(manifestPath);
  await assertExactRootFiles(directory, [
    "manifest.json",
    "source-index",
    "target-index",
  ]);
  const sourceIndex = await readGitBranchCheckoutPrivateFile(
    sourceIndexPath,
    64 * 1024 * 1024,
  );
  const targetIndex = await readGitBranchCheckoutPrivateFile(
    targetIndexPath,
    64 * 1024 * 1024,
  );
  const [sourceIndexInfo, targetIndexInfo] = await Promise.all([
    lstat(sourceIndexPath),
    lstat(targetIndexPath),
  ]);
  if (
    sha256(sourceIndex) !== manifest.plan.sourceIndexSha256 ||
    sha256(targetIndex) !== manifest.plan.targetIndexSha256 ||
    (sourceIndexInfo.mode & 0o777) !== manifest.indexMode ||
    (targetIndexInfo.mode & 0o777) !== manifest.indexMode
  ) {
    throw new Error("recovery index backup changed");
  }
  await assertTransactionFiles(backupDirectory, stagedDirectory, manifest.plan);
  return {
    repository,
    directory,
    backupDirectory,
    stagedDirectory,
    sourceIndexPath,
    targetIndexPath,
    manifestPath,
    manifest,
  };
}

export async function readGitBranchCheckoutManifest(
  manifestPath: string,
): Promise<GitBranchCheckoutTransactionManifest> {
  const content = await readGitBranchCheckoutPrivateFile(
    manifestPath,
    128 * 1024,
  );
  const parsed = JSON.parse(
    content.toString("utf8"),
  ) as GitBranchCheckoutTransactionManifest;
  if (
    `${canonicalJson(parsed)}\n` !== content.toString("utf8") ||
    parsed.schemaVersion !== 1 ||
    !validTargetRef(parsed.targetRef) ||
    !Number.isSafeInteger(parsed.indexMode) ||
    parsed.indexMode < 0 ||
    parsed.indexMode > 0o777 ||
    !DIGEST.test(parsed.beforeRepositoryStateSha256) ||
    !DIGEST.test(parsed.beforeHeadStateSha256) ||
    !DIGEST.test(parsed.beforeStaticStateSha256) ||
    !validBoundFile(parsed.headReflogState) ||
    !DIGEST.test(parsed.manifestSha256)
  ) {
    throw new Error("recovery manifest is invalid");
  }
  assertGitBranchCheckoutPlan(parsed.plan);
  const { manifestSha256, ...manifestContent } = parsed;
  if (sha256(canonicalJson(manifestContent)) !== manifestSha256) {
    throw new Error("recovery manifest hash mismatch");
  }
  return parsed;
}

async function assertTransactionFiles(
  backupDirectory: string,
  stagedDirectory: string,
  plan: GitBranchCheckoutPlan,
): Promise<void> {
  const backupNames = plan.files
    .map((file, index) => (file.beforeSha256 ? fileName(index) : undefined))
    .filter((value): value is string => value !== undefined);
  const stagedAllowed = new Map(
    plan.files
      .map((file, index) =>
        file.expectedSha256 ? ([fileName(index), file] as const) : undefined,
      )
      .filter(
        (
          value,
        ): value is readonly [string, GitBranchCheckoutPlan["files"][number]] =>
          value !== undefined,
      ),
  );
  const backups = await exactFileNames(backupDirectory);
  if (backups.join("\n") !== backupNames.sort().join("\n")) {
    throw new Error("recovery backup set is invalid");
  }
  for (const name of backups) {
    const index = Number(name);
    const file = plan.files[index]!;
    await assertPrivateState(
      path.join(backupDirectory, name),
      file.beforeSha256!,
      file.beforeMode!,
    );
  }
  for (const name of await exactFileNames(stagedDirectory)) {
    const file = stagedAllowed.get(name);
    if (!file) throw new Error("recovery staged set is invalid");
    await assertPrivateState(
      path.join(stagedDirectory, name),
      file.expectedSha256!,
      file.expectedMode!,
    );
  }
}

async function assertPrivateState(
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
    throw new Error("recovery private file changed");
  }
}

async function assertExactDirectories(
  directory: string,
  expected: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    entries.some(
      (entry) =>
        !entry.isDirectory() &&
        !["manifest.json", "source-index", "target-index"].includes(entry.name),
    ) ||
    directories.join("\n") !== [...expected].sort().join("\n")
  ) {
    throw new Error("recovery directory shape is invalid");
  }
}

async function assertExactRootFiles(
  directory: string,
  expected: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (files.join("\n") !== [...expected].sort().join("\n")) {
    throw new Error("recovery root file set is invalid");
  }
}

async function exactFileNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some((entry) => !entry.isFile() || !/^\d{2}$/u.test(entry.name))
  ) {
    throw new Error("recovery file set is invalid");
  }
  return entries.map((entry) => entry.name).sort();
}

function validBoundFile(value: GitBoundFile): boolean {
  return (
    value.present === true &&
    DIGEST.test(value.sha256) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    Number.isSafeInteger(value.mode) &&
    value.mode >= 0 &&
    value.mode <= 0o777
  );
}

function validTargetRef(value: string): boolean {
  if (!value.startsWith("refs/heads/")) return false;
  const branchName = value.slice("refs/heads/".length);
  try {
    return normalizeGitBranchName(branchName) === branchName;
  } catch {
    return false;
  }
}

function fileName(index: number): string {
  return index.toString().padStart(2, "0");
}
