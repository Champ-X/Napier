import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  gitErrorCode,
  gitPathExists,
  type GitBoundFile,
  type GitRepository,
} from "./git-repository.js";
import { sha256 } from "./ed25519.js";
import { syncDirectory } from "./workspace-file-scope.js";

export const ZERO_GIT_OBJECT_ID = "0".repeat(40);
const MAX_GIT_REFLOG_BYTES = 8 * 1024 * 1024;

export async function gitBranchRefWritePaths(
  repository: GitRepository,
  branchRef: string,
): Promise<string[]> {
  const relativeRef = branchRelativePath(branchRef);
  await assertStandaloneRefStorage(repository);
  const candidates = [
    path.join(repository.gitDirectory, "refs/heads"),
    path.join(repository.gitDirectory, "logs"),
  ];
  for (const candidate of candidates) {
    const info = await lstat(candidate);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(candidate)) !== candidate
    ) {
      throw new Error("Git branch ref storage is unsupported");
    }
  }
  await Promise.all([
    assertCanonicalRefAncestors(candidates[0]!, relativeRef),
    assertCanonicalRefAncestors(
      path.join(repository.gitDirectory, "logs/refs/heads"),
      relativeRef,
    ),
    assertCanonicalOptionalRefFile(
      path.join(repository.gitDirectory, "refs/heads", relativeRef),
    ),
    assertCanonicalOptionalRefFile(
      path.join(repository.gitDirectory, "logs/refs/heads", relativeRef),
    ),
  ]);
  return candidates;
}

export async function gitHeadSwitchWritePaths(
  repository: GitRepository,
): Promise<string[]> {
  await assertStandaloneRefStorage(repository);
  const logsDirectory = path.join(repository.gitDirectory, "logs");
  for (const directory of [repository.gitDirectory, logsDirectory]) {
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    ) {
      throw new Error("Git HEAD ref storage is unsupported");
    }
  }
  await Promise.all([
    assertCanonicalFile(path.join(repository.gitDirectory, "HEAD")),
    snapshotGitHeadReflog(repository),
  ]);
  return [repository.gitDirectory];
}

export async function snapshotGitHeadReflog(
  repository: GitRepository,
): Promise<GitBoundFile> {
  return snapshotGitReflog(
    path.join(repository.gitDirectory, "logs/HEAD"),
    "Git HEAD reflog",
  );
}

export async function snapshotGitBranchReflog(
  repository: GitRepository,
  branchRef: string,
): Promise<GitBoundFile> {
  return snapshotGitReflog(
    path.join(
      repository.gitDirectory,
      "logs/refs/heads",
      branchRelativePath(branchRef),
    ),
    "Git branch reflog",
  );
}

async function snapshotGitReflog(
  filePath: string,
  label: string,
): Promise<GitBoundFile> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_GIT_REFLOG_BYTES) {
      throw new Error(`${label} is invalid`);
    }
    const content = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < info.size) {
      const result = await handle.read(
        content,
        offset,
        info.size - offset,
        offset,
      );
      if (result.bytesRead === 0) {
        throw new Error(`${label} changed while it was read`);
      }
      offset += result.bytesRead;
    }
    const probe = Buffer.alloc(1);
    if ((await handle.read(probe, 0, 1, info.size)).bytesRead > 0) {
      throw new Error(`${label} changed while it was read`);
    }
    return {
      present: true,
      sha256: sha256(content),
      bytes: content.length,
      mode: info.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

export async function syncGitBranchRefTransition(input: {
  repository: GitRepository;
  branchRef: string;
  oldObjectId: string;
  newObjectId: string;
  includeHeadReflog: boolean;
  beforeBranchReflog?: GitBoundFile;
  message?: string;
}): Promise<boolean> {
  const relativeRef = branchRelativePath(input.branchRef);
  const refFile = path.join(
    input.repository.gitDirectory,
    "refs/heads",
    relativeRef,
  );
  const branchReflog = path.join(
    input.repository.gitDirectory,
    "logs/refs/heads",
    relativeRef,
  );
  const reflogs = [
    ...(input.includeHeadReflog
      ? [path.join(input.repository.gitDirectory, "logs/HEAD")]
      : []),
    branchReflog,
  ];
  const files = [refFile, ...reflogs];
  try {
    for (const file of files) await syncExactFile(file);
    if (input.beforeBranchReflog) {
      await verifyGitBranchReflogTransition({
        repository: input.repository,
        branchRef: input.branchRef,
        beforeBranchReflog: input.beforeBranchReflog,
        oldCommitSha1: input.oldObjectId,
        newCommitSha1: input.newObjectId,
        ...(input.message ? { message: input.message } : {}),
      });
    } else {
      await Promise.all(
        reflogs.map((file) =>
          verifyReflogTail(
            file,
            input.oldObjectId,
            input.newObjectId,
            input.message,
          ),
        ),
      );
    }
    await syncParentDirectories(input.repository, files);
    return true;
  } catch {
    return false;
  }
}

export async function verifyGitBranchReflogTransition(input: {
  repository: GitRepository;
  branchRef: string;
  beforeBranchReflog: GitBoundFile;
  oldCommitSha1: string;
  newCommitSha1: string;
  message?: string;
}): Promise<GitBoundFile> {
  const filePath = path.join(
    input.repository.gitDirectory,
    "logs/refs/heads",
    branchRelativePath(input.branchRef),
  );
  return verifyExactReflogAppend({
    filePath,
    before: input.beforeBranchReflog,
    oldObjectId: input.oldCommitSha1,
    newObjectId: input.newCommitSha1,
    ...(input.message ? { message: input.message } : {}),
    label: "Git branch reflog",
  });
}

export async function syncGitHeadSwitch(input: {
  repository: GitRepository;
  oldCommitSha1: string;
  newCommitSha1: string;
  message: string;
  beforeHeadReflog: GitBoundFile;
}): Promise<boolean> {
  const files = [
    path.join(input.repository.gitDirectory, "HEAD"),
    path.join(input.repository.gitDirectory, "logs/HEAD"),
  ];
  try {
    for (const file of files) await syncExactFile(file);
    await verifyGitHeadSwitchReflog(input);
    await syncParentDirectories(input.repository, files);
    return true;
  } catch {
    return false;
  }
}

export async function verifyGitHeadSwitchReflog(input: {
  repository: GitRepository;
  beforeHeadReflog: GitBoundFile;
  oldCommitSha1: string;
  newCommitSha1: string;
  message: string;
}): Promise<GitBoundFile> {
  return verifyExactReflogAppend({
    filePath: path.join(input.repository.gitDirectory, "logs/HEAD"),
    before: input.beforeHeadReflog,
    oldObjectId: input.oldCommitSha1,
    newObjectId: input.newCommitSha1,
    message: input.message,
    label: "Git HEAD reflog",
  });
}

async function verifyExactReflogAppend(input: {
  filePath: string;
  before: GitBoundFile;
  oldObjectId: string;
  newObjectId: string;
  message?: string;
  label: string;
}): Promise<GitBoundFile> {
  const handle = await open(
    input.filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    const suffixBytes = info.size - input.before.bytes;
    if (
      !input.before.present ||
      !info.isFile() ||
      info.size > MAX_GIT_REFLOG_BYTES ||
      (info.mode & 0o777) !== input.before.mode ||
      suffixBytes < 1 ||
      suffixBytes > 4 * 1024
    ) {
      throw new Error(`${input.label} append is invalid`);
    }
    const prefix = Buffer.alloc(input.before.bytes);
    await readExact(handle, prefix, 0);
    if (sha256(prefix) !== input.before.sha256) {
      throw new Error(`${input.label} prefix changed`);
    }
    const suffix = Buffer.alloc(suffixBytes);
    await readExact(handle, suffix, input.before.bytes);
    const probe = Buffer.alloc(1);
    if ((await handle.read(probe, 0, 1, info.size)).bytesRead > 0) {
      throw new Error(`${input.label} changed while it was read`);
    }
    const text = suffix.toString("utf8");
    if (
      !text.endsWith("\n") ||
      text.slice(0, -1).includes("\n") ||
      !text.startsWith(`${input.oldObjectId} ${input.newObjectId} `) ||
      (input.message !== undefined && !text.endsWith(`\t${input.message}\n`))
    ) {
      throw new Error(`${input.label} transition is invalid`);
    }
    return {
      present: true,
      sha256: sha256(Buffer.concat([prefix, suffix])),
      bytes: info.size,
      mode: info.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (result.bytesRead === 0) {
      throw new Error("Git reflog changed while it was read");
    }
    offset += result.bytesRead;
  }
}

function branchRelativePath(branchRef: string): string {
  const prefix = "refs/heads/";
  const relative = branchRef.startsWith(prefix)
    ? branchRef.slice(prefix.length)
    : "";
  if (!relative || path.posix.normalize(relative) !== relative) {
    throw new Error("Git branch ref is invalid");
  }
  return relative;
}

async function assertCanonicalOptionalRefFile(filePath: string): Promise<void> {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") return;
    throw new Error("Git branch ref file is unavailable");
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await realpath(filePath)) !== filePath
  ) {
    throw new Error("Git branch ref file is not canonical");
  }
}

async function verifyReflogTail(
  filePath: string,
  oldObjectId: string,
  newObjectId: string,
  message?: string,
): Promise<void> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1) {
      throw new Error("Git branch reflog is invalid");
    }
    const size = Math.min(info.size, 8 * 1024);
    const content = Buffer.alloc(size);
    const result = await handle.read(content, 0, size, info.size - size);
    const last = content
      .subarray(0, result.bytesRead)
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .at(-1);
    if (
      !last?.startsWith(`${oldObjectId} ${newObjectId} `) ||
      (message !== undefined && !last.endsWith(`\t${message}`))
    ) {
      throw new Error("Git branch reflog does not bind the ref update");
    }
  } finally {
    await handle.close();
  }
}

async function assertStandaloneRefStorage(
  repository: GitRepository,
): Promise<void> {
  if (await gitPathExists(path.join(repository.gitDirectory, "worktrees"))) {
    throw new Error("Git linked worktrees are unsupported");
  }
  if (
    await gitPathExists(
      path.join(repository.gitDirectory, "objects/info/alternates"),
    )
  ) {
    throw new Error("Git object alternates are unsupported");
  }
}

async function assertCanonicalFile(filePath: string): Promise<void> {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await realpath(filePath)) !== filePath
  ) {
    throw new Error("Git ref file is not canonical");
  }
}

async function syncExactFile(filePath: string): Promise<void> {
  if ((await realpath(filePath)) !== filePath) {
    throw new Error("Git branch ref path is not canonical");
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertCanonicalRefAncestors(
  root: string,
  relativeRef: string,
): Promise<void> {
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") return;
    throw new Error("Git branch ref root is unavailable");
  }
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (await realpath(root)) !== root
  ) {
    throw new Error("Git branch ref root is not canonical");
  }
  let current = root;
  for (const segment of relativeRef.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (gitErrorCode(error) === "ENOENT") return;
      throw new Error("Git branch ref ancestor is unavailable");
    }
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== current
    ) {
      throw new Error("Git branch ref ancestor is not canonical");
    }
  }
}

async function syncParentDirectories(
  repository: GitRepository,
  files: string[],
): Promise<void> {
  const directories = new Set<string>();
  for (const file of files) {
    let current = path.dirname(file);
    while (current.startsWith(`${repository.gitDirectory}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  directories.add(repository.gitDirectory);
  for (const directory of [...directories].sort(
    (left, right) => right.split(path.sep).length - left.split(path.sep).length,
  )) {
    await syncDirectory(directory);
  }
}
