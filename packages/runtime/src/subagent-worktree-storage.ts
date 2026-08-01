import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

const OWNER_ID = /^[a-z][a-z0-9_-]{2,96}$/u;
const ownerRoots = new Map<string, Promise<string>>();
const GENERATED_DIRECTORIES = new Set([
  ".vite",
  "benchmark-results",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);

export async function prepareSubagentWorktreeOwnerRoot(input: {
  workspaceRoot: string;
  dataRoot: string;
  ownerId: string;
}): Promise<string> {
  if (!OWNER_ID.test(input.ownerId)) {
    throw new Error("Subagent worktree owner ID is invalid");
  }
  const [workspaceRoot, dataRoot] = await Promise.all([
    realpath(path.resolve(input.workspaceRoot)),
    realpath(path.resolve(input.dataRoot)),
  ]);
  assertPrivateDataRoot(workspaceRoot, dataRoot);
  const key = `${dataRoot}\0${input.ownerId}`;
  const existing = ownerRoots.get(key);
  if (existing) {
    try {
      const ownerRoot = await existing;
      await validateOwnerRoot(ownerRoot);
      return ownerRoot;
    } catch (error) {
      ownerRoots.delete(key);
      throw error;
    }
  }
  const initialized = initializeOwnerRoot(dataRoot, input.ownerId);
  ownerRoots.set(key, initialized);
  try {
    return await initialized;
  } catch (error) {
    ownerRoots.delete(key);
    throw error;
  }
}

async function initializeOwnerRoot(
  dataRoot: string,
  ownerId: string,
): Promise<string> {
  const worktreesRoot = path.join(dataRoot, "subagent-worktrees");
  await mkdir(worktreesRoot, { recursive: true, mode: 0o700 });
  let worktreesInfo = await lstat(worktreesRoot);
  if (
    !worktreesInfo.isDirectory() ||
    worktreesInfo.isSymbolicLink() ||
    (await realpath(worktreesRoot)) !== worktreesRoot
  ) {
    throw new Error("Subagent worktree root is not canonical");
  }
  if ((worktreesInfo.mode & 0o077) !== 0) {
    await chmod(worktreesRoot, 0o700);
    worktreesInfo = await lstat(worktreesRoot);
    if ((worktreesInfo.mode & 0o077) !== 0) {
      throw new Error("Subagent worktree root is not private");
    }
  }
  const children = await readdir(worktreesRoot, { withFileTypes: true });
  for (const child of children) {
    if (child.name === ownerId) continue;
    if (!child.isDirectory() || child.isSymbolicLink()) {
      throw new Error("Subagent worktree root contains an unsafe entry");
    }
    if (await ownerProcessAlive(path.join(worktreesRoot, child.name))) {
      continue;
    }
    await rm(path.join(worktreesRoot, child.name), {
      recursive: true,
      force: false,
    });
  }
  const ownerRoot = path.join(worktreesRoot, ownerId);
  await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
  let ownerInfo = await lstat(ownerRoot);
  if (
    !ownerInfo.isDirectory() ||
    ownerInfo.isSymbolicLink() ||
    (await realpath(ownerRoot)) !== ownerRoot
  ) {
    throw new Error("Subagent worktree owner root is invalid");
  }
  if ((ownerInfo.mode & 0o077) !== 0) {
    await chmod(ownerRoot, 0o700);
    ownerInfo = await lstat(ownerRoot);
    if ((ownerInfo.mode & 0o077) !== 0) {
      throw new Error("Subagent worktree owner root is not private");
    }
  }
  await bindOwnerProcess(ownerRoot);
  await validateOwnerRoot(ownerRoot);
  return ownerRoot;
}

async function bindOwnerProcess(ownerRoot: string): Promise<void> {
  const manifestPath = path.join(ownerRoot, "owner.json");
  try {
    const handle = await open(manifestPath, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid })}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const record = await readOwnerManifest(ownerRoot);
    if (record.pid !== process.pid) {
      throw new Error("Subagent worktree owner ID is already active");
    }
  }
}

async function ownerProcessAlive(ownerRoot: string): Promise<boolean> {
  try {
    const info = await lstat(ownerRoot);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(ownerRoot)) !== ownerRoot
    ) {
      throw new Error("Subagent worktree owner root is invalid");
    }
    const record = await readOwnerManifest(ownerRoot);
    return isProcessAlive(record.pid);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function validateOwnerRoot(ownerRoot: string): Promise<void> {
  const info = await lstat(ownerRoot);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (await realpath(ownerRoot)) !== ownerRoot
  ) {
    throw new Error("Subagent worktree owner root is invalid");
  }
  const record = await readOwnerManifest(ownerRoot);
  if (record.pid !== process.pid) {
    throw new Error("Subagent worktree owner ID is already active");
  }
}

async function readOwnerManifest(ownerRoot: string): Promise<{ pid: number }> {
  const manifestPath = path.join(ownerRoot, "owner.json");
  const info = await lstat(manifestPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 1_024 ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("Subagent worktree owner manifest is unsafe");
  }
  return parseOwnerManifest(await readFile(manifestPath, "utf8"));
}

function parseOwnerManifest(value: string): { pid: number } {
  const parsed = JSON.parse(value) as { pid?: unknown };
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Number.isSafeInteger(parsed.pid) ||
    Number(parsed.pid) < 1
  ) {
    throw new Error("Subagent worktree owner manifest is invalid");
  }
  return { pid: Number(parsed.pid) };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function assertPrivateDataRoot(sourceRoot: string, dataRoot: string): void {
  const relative = path.relative(sourceRoot, dataRoot);
  const inside =
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
  if (
    inside &&
    !relative
      .split(path.sep)
      .filter(Boolean)
      .some(
        (segment) =>
          isProtectedWorkspacePathSegment(segment) ||
          GENERATED_DIRECTORIES.has(segment.toLowerCase()),
      )
  ) {
    throw new Error(
      "Subagent worktree data root must be outside or protected from workspace scans",
    );
  }
}
