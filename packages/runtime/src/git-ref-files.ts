import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  gitErrorCode,
  gitPathExists,
  type GitRepository,
} from "./git-repository.js";
import { syncDirectory } from "./workspace-file-scope.js";

export const ZERO_GIT_OBJECT_ID = "0".repeat(40);

export async function gitBranchRefWritePaths(
  repository: GitRepository,
  branchRef: string,
): Promise<string[]> {
  const relativeRef = branchRelativePath(branchRef);
  if (
    await gitPathExists(
      path.join(repository.gitDirectory, "objects/info/alternates"),
    )
  ) {
    throw new Error("Git object alternates are unsupported");
  }
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
  ]);
  return candidates;
}

export async function syncGitBranchRefTransition(input: {
  repository: GitRepository;
  branchRef: string;
  oldObjectId: string;
  newObjectId: string;
  includeHeadReflog: boolean;
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
    await Promise.all(
      reflogs.map((file) =>
        verifyReflogTail(file, input.oldObjectId, input.newObjectId),
      ),
    );
    await syncParentDirectories(input.repository, files);
    return true;
  } catch {
    return false;
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

async function verifyReflogTail(
  filePath: string,
  oldObjectId: string,
  newObjectId: string,
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
    if (!last?.startsWith(`${oldObjectId} ${newObjectId} `)) {
      throw new Error("Git branch reflog does not bind the ref update");
    }
  } finally {
    await handle.close();
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
