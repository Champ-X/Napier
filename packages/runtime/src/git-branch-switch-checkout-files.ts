import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES } from "./git-branch-switch-checkout-model.js";
import {
  gitErrorCode,
  MAX_GIT_INDEX_BYTES,
  type GitRepository,
} from "./git-repository.js";
import { assertGitStagePathAncestors } from "./git-stage-model.js";
import { syncDirectory } from "./workspace-file-scope.js";

export interface GitBranchCheckoutPathState {
  present: boolean;
  sha256: string | null;
  bytes: number;
  mode: number | null;
  device?: number;
  inode?: number;
}

export async function ensureGitBranchCheckoutRoot(
  repository: GitRepository,
): Promise<string> {
  const root = path.join(repository.gitDirectory, "napier-switch");
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (gitErrorCode(error) !== "EEXIST") throw error;
  }
  await assertGitBranchCheckoutDirectory(root);
  return root;
}

export async function assertNoGitBranchCheckoutAttributes(
  repository: GitRepository,
  relativePaths: readonly string[],
): Promise<void> {
  if (
    relativePaths.some(
      (relativePath) => path.posix.basename(relativePath) === ".gitattributes",
    )
  ) {
    throw new Error("Git branch checkout attributes are unsupported");
  }
  const candidates = new Set<string>([
    path.join(repository.root, ".gitattributes"),
    path.join(repository.gitDirectory, "info/attributes"),
  ]);
  for (const relativePath of relativePaths) {
    let current = repository.root;
    for (const segment of relativePath.split("/").slice(0, -1)) {
      current = path.join(current, segment);
      candidates.add(path.join(current, ".gitattributes"));
    }
  }
  for (const candidate of candidates) {
    try {
      await lstat(candidate);
      throw new Error("Git branch checkout attributes are unsupported");
    } catch (error) {
      if (gitErrorCode(error) === "ENOENT") continue;
      if (
        error instanceof Error &&
        error.message === "Git branch checkout attributes are unsupported"
      ) {
        throw error;
      }
      throw new Error("Git branch checkout attribute state is unavailable");
    }
  }
}

export async function createGitBranchCheckoutPrivateDirectory(
  repository: GitRepository,
  prefix: "preview-" | "checkout-",
): Promise<string> {
  const root = await ensureGitBranchCheckoutRoot(repository);
  const directory = await mkdtemp(path.join(root, prefix));
  await chmod(directory, 0o700);
  await assertGitBranchCheckoutDirectory(directory);
  return directory;
}

export async function assertGitBranchCheckoutDirectory(
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
    throw new Error("Git branch checkout private directory is invalid");
  }
}

export async function snapshotGitBranchCheckoutPath(
  repository: GitRepository,
  relativePath: string,
): Promise<GitBranchCheckoutPathState & { content?: Buffer }> {
  await assertGitStagePathAncestors(repository, relativePath);
  const target = path.join(repository.root, relativePath);
  let handle;
  try {
    handle = await open(
      target,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES) {
      throw new Error("Git branch checkout path is unsupported");
    }
    const content = await readExact(
      handle,
      opened.size,
      "Git branch checkout path",
    );
    assertCheckoutText(content);
    const current = await lstat(target);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      (await realpath(target)) !== target
    ) {
      throw new Error("Git branch checkout path changed during capture");
    }
    return {
      present: true,
      sha256: sha256(content),
      bytes: content.length,
      mode: opened.mode & 0o777,
      device: opened.dev,
      inode: opened.ino,
      content,
    };
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") {
      const parent = path.dirname(target);
      if (
        (await realpath(parent)) !== parent ||
        !(await stat(parent)).isDirectory()
      ) {
        throw new Error("Git branch checkout parent is unavailable");
      }
      return {
        present: false,
        sha256: null,
        bytes: 0,
        mode: null,
      };
    }
    if (
      error instanceof Error &&
      error.message.startsWith("Git branch checkout ")
    ) {
      throw error;
    }
    throw new Error("Git branch checkout path is unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function assertGitBranchCheckoutBlob(
  content: Buffer,
  expectedBlobSha1: string,
): void {
  assertCheckoutText(content);
  if (
    content.length > MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES ||
    gitBlobSha1(content) !== expectedBlobSha1
  ) {
    throw new Error("Git branch checkout blob is invalid");
  }
}

export function gitBlobSha1(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\u0000`)
    .update(content)
    .digest("hex");
}

export async function writeGitBranchCheckoutFile(
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

export async function readGitBranchCheckoutIndex(
  filePath: string,
): Promise<Buffer> {
  return readGitBranchCheckoutPrivateFile(filePath, MAX_GIT_INDEX_BYTES);
}

export async function readGitBranchCheckoutPrivateFile(
  filePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) {
      throw new Error("Git branch checkout private file is invalid");
    }
    const content = await readExact(
      handle,
      info.size,
      "Git branch checkout private file",
    );
    const current = await lstat(filePath);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      (await realpath(filePath)) !== filePath
    ) {
      throw new Error("Git branch checkout private file changed during read");
    }
    return content;
  } finally {
    await handle.close();
  }
}

export async function syncGitBranchCheckoutPaths(
  repository: GitRepository,
  relativePaths: readonly string[],
): Promise<boolean> {
  try {
    const directories = new Set(
      relativePaths.map((value) =>
        path.dirname(path.join(repository.root, value)),
      ),
    );
    for (const directory of [...directories].sort(
      (left, right) =>
        right.split(path.sep).length - left.split(path.sep).length,
    )) {
      await syncDirectory(directory);
    }
    return true;
  } catch {
    return false;
  }
}

export async function cleanupGitBranchCheckoutDirectory(
  directory: string,
): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

function assertCheckoutText(content: Buffer): void {
  if (
    content.includes(0) ||
    Buffer.from(content.toString("utf8"), "utf8").compare(content) !== 0
  ) {
    throw new Error("Git branch checkout supports complete UTF-8 text only");
  }
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  label: string,
): Promise<Buffer> {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(content, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error(`${label} changed while it was read`);
    }
    offset += result.bytesRead;
  }
  const probe = Buffer.alloc(1);
  if ((await handle.read(probe, 0, 1, size)).bytesRead > 0) {
    throw new Error(`${label} changed while it was read`);
  }
  return content;
}
