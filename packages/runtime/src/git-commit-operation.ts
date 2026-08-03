import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  gitErrorCode,
  type GitBoundFile,
  type GitRepository,
} from "./git-repository.js";
import { syncDirectory } from "./workspace-file-scope.js";

const SHA1 = /^[a-f0-9]{40}$/u;
export const GIT_MERGE_OPERATION_FILES = [
  "MERGE_HEAD",
  "MERGE_MSG",
  "MERGE_MODE",
  "AUTO_MERGE",
  "MERGE_RR",
] as const;
const MERGE_FILES = GIT_MERGE_OPERATION_FILES;
const MERGE_ISOLATION_ORDER: MergeFileName[] = [
  "MERGE_MODE",
  "AUTO_MERGE",
  "MERGE_RR",
  "MERGE_MSG",
  "MERGE_HEAD",
];
const MERGE_RESTORE_ORDER: MergeFileName[] = [
  "MERGE_HEAD",
  "MERGE_MSG",
  "MERGE_MODE",
  "AUTO_MERGE",
  "MERGE_RR",
];
const UNSUPPORTED_MARKERS = [
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "BISECT_LOG",
  "MERGE_AUTOSTASH",
  "SQUASH_MSG",
  "rebase-apply",
  "rebase-merge",
  "sequencer",
] as const;
const MAX_OPERATION_FILE_BYTES = 64 * 1024;

export type GitMergeOperationFileName = (typeof MERGE_FILES)[number];
type MergeFileName = GitMergeOperationFileName;

export interface GitCommitOperationState {
  kind: "ordinary" | "merge";
  mergeParentCommitSha1?: string;
  files: Record<MergeFileName, GitBoundFile>;
  stateSha256: string;
}

export interface GitMergeOperationCleanup {
  backupDirectory: string;
  directory: string;
  expected: GitCommitOperationState;
  isolatedDirectory: string;
  repository: GitRepository;
  moved: MergeFileName[];
}

export interface GitMergeCompletionFileOperations {
  rename(source: string, destination: string): Promise<void>;
  rm(target: string, options: { recursive: true }): Promise<void>;
  syncDirectory(directory: string): Promise<void>;
}

const MERGE_COMPLETION_FILE_OPERATIONS: GitMergeCompletionFileOperations = {
  rename,
  rm,
  syncDirectory,
};

export async function snapshotGitCommitOperationState(
  repository: GitRepository,
): Promise<GitCommitOperationState> {
  await assertUnsupportedMarkersAbsent(repository);
  const payloads = await Promise.all(
    MERGE_FILES.map((name) =>
      readOptionalOperationFile(
        path.join(repository.gitDirectory, name),
        name === "MERGE_MSG" ? MAX_OPERATION_FILE_BYTES : 4 * 1024,
      ),
    ),
  );
  const files = Object.fromEntries(
    MERGE_FILES.map((name, index) => [name, payloads[index]!.bound]),
  ) as Record<MergeFileName, GitBoundFile>;
  const mergeHead = payloads[0]!;
  const present = MERGE_FILES.filter((name) => files[name].present);
  if (!mergeHead.bound.present) {
    if (present.length > 0) {
      throw new Error("Git commit operation state is unsupported");
    }
    return operationState("ordinary", files);
  }
  if (!files.MERGE_MSG.present) {
    throw new Error("Git merge commit message state is unavailable");
  }
  const mergeParentCommitSha1 = parseMergeParent(mergeHead.content);
  return operationState("merge", files, mergeParentCommitSha1);
}

export async function assertGitCommitOperationState(
  repository: GitRepository,
  expected: GitCommitOperationState,
): Promise<void> {
  const current = await snapshotGitCommitOperationState(repository);
  if (current.stateSha256 !== expected.stateSha256) {
    throw new Error(
      "Git commit operation state changed; preview the commit again",
    );
  }
}

export async function snapshotGitMergeOperationBackup(
  backupDirectory: string,
): Promise<GitCommitOperationState> {
  const payloads = await Promise.all(
    MERGE_FILES.map((name) =>
      readOptionalOperationFile(
        path.join(backupDirectory, name),
        operationFileLimit(name),
      ),
    ),
  );
  const files = Object.fromEntries(
    MERGE_FILES.map((name, index) => [name, payloads[index]!.bound]),
  ) as Record<MergeFileName, GitBoundFile>;
  if (!files.MERGE_HEAD.present || !files.MERGE_MSG.present) {
    throw new Error("Git merge cleanup backup is incomplete");
  }
  return operationState("merge", files, parseMergeParent(payloads[0]!.content));
}

export async function matchGitMergeOperationFile(
  directory: string,
  name: GitMergeOperationFileName,
  expected: GitBoundFile,
): Promise<boolean> {
  const current = await readOptionalOperationFile(
    path.join(directory, name),
    operationFileLimit(name),
  );
  if (!current.bound.present) return false;
  if (
    sha256(canonicalJson(current.bound)) !== sha256(canonicalJson(expected))
  ) {
    throw new Error("Git merge cleanup file is invalid");
  }
  return true;
}

export async function isolateGitMergeOperationState(input: {
  repository: GitRepository;
  expected: GitCommitOperationState;
}): Promise<GitMergeOperationCleanup | undefined> {
  if (input.expected.kind !== "merge") return undefined;
  let transaction: GitMergeOperationCleanup | undefined;
  try {
    await assertGitCommitOperationState(input.repository, input.expected);
    const root = path.join(input.repository.gitDirectory, "napier-stage");
    await assertGitMergeCleanupDirectory(root);
    const directory = await mkdtemp(path.join(root, "merge-cleanup-"));
    await chmod(directory, 0o700);
    await assertGitMergeCleanupDirectory(directory);
    const backupDirectory = path.join(directory, "backup");
    const isolatedDirectory = path.join(directory, "isolated");
    await mkdir(backupDirectory, { mode: 0o700 });
    await mkdir(isolatedDirectory, { mode: 0o700 });
    await chmod(backupDirectory, 0o700);
    await chmod(isolatedDirectory, 0o700);
    await assertGitMergeCleanupDirectory(backupDirectory);
    await assertGitMergeCleanupDirectory(isolatedDirectory);
    transaction = {
      backupDirectory,
      directory,
      expected: input.expected,
      isolatedDirectory,
      repository: input.repository,
      moved: [],
    };
    for (const name of MERGE_FILES) {
      const expected = input.expected.files[name];
      if (!expected.present) continue;
      await assertGitMergeCleanupDirectory(backupDirectory);
      const current = await readOptionalOperationFile(
        path.join(input.repository.gitDirectory, name),
        operationFileLimit(name),
      );
      if (
        sha256(canonicalJson(current.bound)) !== sha256(canonicalJson(expected))
      ) {
        throw new Error("Git merge operation changed during cleanup");
      }
      await writeOperationFile(
        path.join(backupDirectory, name),
        current.content,
        expected.mode,
      );
    }
    await syncDirectory(backupDirectory);
    await syncDirectory(directory);
    await syncDirectory(root);
    for (const name of MERGE_ISOLATION_ORDER) {
      if (!input.expected.files[name].present) continue;
      await assertGitMergeCleanupDirectory(root);
      await assertGitMergeCleanupDirectory(directory);
      await assertGitMergeCleanupDirectory(isolatedDirectory);
      await rename(
        path.join(input.repository.gitDirectory, name),
        path.join(isolatedDirectory, name),
      );
      transaction.moved.push(name);
    }
    for (const name of transaction.moved) {
      const isolated = await readOptionalOperationFile(
        path.join(isolatedDirectory, name),
        operationFileLimit(name),
      );
      if (
        sha256(canonicalJson(isolated.bound)) !==
        sha256(canonicalJson(input.expected.files[name]))
      ) {
        throw new Error("Git merge operation changed during cleanup");
      }
    }
    await syncDirectory(isolatedDirectory);
    await syncDirectory(directory);
    await syncDirectory(input.repository.gitDirectory);
    return transaction;
  } catch {
    if (transaction) {
      await rollbackGitMergeOperationState(transaction);
    }
    return undefined;
  }
}

export async function assertGitMergeCleanupDirectory(
  directory: string,
): Promise<void> {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid()) ||
    (await realpath(directory)) !== directory
  ) {
    throw new Error("Git merge cleanup directory is invalid");
  }
}

export async function finalizeGitMergeOperationState(
  transaction: GitMergeOperationCleanup,
  operations: GitMergeCompletionFileOperations = MERGE_COMPLETION_FILE_OPERATIONS,
): Promise<boolean> {
  const completed = `${transaction.directory}.complete`;
  try {
    await operations.rename(transaction.directory, completed);
  } catch {
    return false;
  }
  transaction.directory = completed;
  transaction.backupDirectory = path.join(completed, "backup");
  transaction.isolatedDirectory = path.join(completed, "isolated");
  try {
    await operations.syncDirectory(path.dirname(completed));
  } catch {
    return false;
  }
  await operations
    .rm(completed, { recursive: true })
    .then(() => operations.syncDirectory(path.dirname(completed)))
    .catch(() => undefined);
  return true;
}

export async function rollbackGitMergeOperationState(
  transaction: GitMergeOperationCleanup,
): Promise<boolean> {
  let complete = true;
  for (const name of MERGE_RESTORE_ORDER) {
    const expected = transaction.expected.files[name];
    if (!expected.present) continue;
    const target = path.join(transaction.repository.gitDirectory, name);
    try {
      const current = await readOptionalOperationFile(
        target,
        operationFileLimit(name),
      );
      if (current.bound.present) {
        complete =
          complete &&
          sha256(canonicalJson(current.bound)) ===
            sha256(canonicalJson(expected));
        continue;
      }
      const backup = await readOptionalOperationFile(
        path.join(transaction.backupDirectory, name),
        operationFileLimit(name),
      );
      if (
        !backup.bound.present ||
        sha256(canonicalJson(backup.bound)) !== sha256(canonicalJson(expected))
      ) {
        complete = false;
        continue;
      }
      await writeOperationFile(target, backup.content, expected.mode);
    } catch {
      complete = false;
    }
  }
  try {
    await syncDirectory(transaction.repository.gitDirectory);
  } catch {
    complete = false;
  }
  const restored = await snapshotGitCommitOperationState(transaction.repository)
    .then((state) => state.stateSha256 === transaction.expected.stateSha256)
    .catch(() => false);
  const removed = restored
    ? await rm(transaction.directory, { recursive: true })
        .then(() => syncDirectory(path.dirname(transaction.directory)))
        .then(() => true)
        .catch(() => false)
    : false;
  return complete && restored && removed;
}

async function writeOperationFile(
  filePath: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  const handle = await open(filePath, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function operationFileLimit(name: MergeFileName): number {
  return name === "MERGE_MSG" ? MAX_OPERATION_FILE_BYTES : 4 * 1024;
}

function operationState(
  kind: GitCommitOperationState["kind"],
  files: GitCommitOperationState["files"],
  mergeParentCommitSha1?: string,
): GitCommitOperationState {
  const content = {
    kind,
    ...(mergeParentCommitSha1 ? { mergeParentCommitSha1 } : {}),
    files,
  };
  return {
    ...content,
    stateSha256: sha256(canonicalJson(content)),
  };
}

async function assertUnsupportedMarkersAbsent(
  repository: GitRepository,
): Promise<void> {
  for (const marker of UNSUPPORTED_MARKERS) {
    try {
      await lstat(path.join(repository.gitDirectory, marker));
      throw new Error("Git commit cannot run during another Git operation");
    } catch (error) {
      if (gitErrorCode(error) === "ENOENT") continue;
      if (
        error instanceof Error &&
        error.message === "Git commit cannot run during another Git operation"
      ) {
        throw error;
      }
      throw new Error("Git commit operation state is unavailable");
    }
  }
}

async function readOptionalOperationFile(
  filePath: string,
  maximumBytes: number,
): Promise<{ bound: GitBoundFile; content: Buffer }> {
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) {
      throw new Error("Git commit operation file is invalid");
    }
    const content = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < content.length) {
      const result = await handle.read(
        content,
        offset,
        content.length - offset,
        offset,
      );
      if (result.bytesRead === 0) {
        throw new Error("Git commit operation file changed while read");
      }
      offset += result.bytesRead;
    }
    const probe = Buffer.alloc(1);
    if ((await handle.read(probe, 0, 1, info.size)).bytesRead > 0) {
      throw new Error("Git commit operation file changed while read");
    }
    return {
      bound: {
        present: true,
        sha256: sha256(content),
        bytes: content.length,
        mode: info.mode & 0o777,
      },
      content,
    };
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") {
      return {
        bound: {
          present: false,
          sha256: sha256(""),
          bytes: 0,
          mode: 0,
        },
        content: Buffer.alloc(0),
      };
    }
    if (
      error instanceof Error &&
      error.message.startsWith("Git commit operation ")
    ) {
      throw error;
    }
    throw new Error("Git commit operation file is unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseMergeParent(content: Buffer): string {
  const value = content.toString("utf8");
  if (
    Buffer.from(value, "utf8").compare(content) !== 0 ||
    !/^[a-f0-9]{40}\n?$/u.test(value)
  ) {
    throw new Error("Git merge parent is invalid");
  }
  const parent = value.trim();
  if (!SHA1.test(parent)) {
    throw new Error("Git merge parent is invalid");
  }
  return parent;
}
