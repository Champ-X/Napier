import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  ProjectSkillSnapshotError,
  type ProjectSkillHandleTraversalProbe,
  type ProjectSkillRootAnchor,
  type ProjectSkillTraversalStrategy,
} from "./project-skill-snapshot-model.js";

export async function openProjectSkillRoot(
  workspacePath: string,
  root: string,
  signal?: AbortSignal,
): Promise<ProjectSkillRootAnchor> {
  const workspaceInfo = await stableDirectoryInfo(workspacePath, signal);
  const workspaceHandle = await open(
    workspacePath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!workspaceHandle)
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  let handle: FileHandle | undefined;
  try {
    const workspaceIdentity = await workspaceHandle.stat();
    checkProjectSkillSignal(signal);
    if (
      !workspaceIdentity.isDirectory() ||
      !sameIdentity(workspaceIdentity, workspaceInfo)
    ) {
      throw new ProjectSkillSnapshotError("workspace_untrusted");
    }
    const workspaceTraversal = await handleRelativePath(
      workspaceHandle,
      workspaceIdentity,
      workspacePath,
      signal,
    );
    const relativeRoot = path.join(workspaceTraversal.path, "skills");
    const pathInfo = await stableDirectoryInfo(root, signal);
    handle = await open(
      relativeRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    ).catch(() => undefined);
    if (!handle) throw new ProjectSkillSnapshotError("workspace_untrusted");
    const identity = await handle.stat();
    checkProjectSkillSignal(signal);
    if (!identity.isDirectory() || !sameIdentity(identity, pathInfo)) {
      throw new ProjectSkillSnapshotError("workspace_untrusted");
    }
    const rootTraversal = await handleRelativePath(
      handle,
      identity,
      root,
      signal,
    );
    if (rootTraversal.strategy !== workspaceTraversal.strategy) {
      throw new ProjectSkillSnapshotError("workspace_untrusted");
    }
    const anchor = {
      path: root,
      relativePath: rootTraversal.path,
      handle,
      identity,
      workspacePath,
      workspaceHandle,
      workspaceIdentity,
      traversalStrategy: rootTraversal.strategy,
    };
    await assertProjectSkillAnchorCurrent(anchor, signal);
    return anchor;
  } catch (error) {
    await Promise.allSettled([handle?.close(), workspaceHandle.close()]);
    throw error;
  }
}

export async function handleProjectSkillRelativePath(
  handle: FileHandle,
  identity: Stats,
  fallbackPath: string,
  signal?: AbortSignal,
): Promise<{ path: string; strategy: ProjectSkillTraversalStrategy }> {
  return handleRelativePath(handle, identity, fallbackPath, signal);
}

export function resolveProjectSkillTraversalStrategy(
  platform: string,
  probe: ProjectSkillHandleTraversalProbe,
): ProjectSkillTraversalStrategy {
  if (!probe.fdIdentityMatches)
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  if (platform === "linux") {
    if (probe.directoryOpened && probe.childOpened) return "fd_relative";
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  if (platform === "darwin") {
    if (probe.directoryOpened && probe.childOpened) return "fd_relative";
    if (
      !probe.directoryOpened &&
      !probe.childOpened &&
      probe.directoryOpenErrorCode === "ENOTDIR" &&
      (probe.childOpenErrorCode === "ENOENT" ||
        probe.childOpenErrorCode === "ENOTDIR")
    ) {
      return "darwin_held_path";
    }
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  throw new ProjectSkillSnapshotError("workspace_untrusted");
}

export async function assertProjectSkillAnchorCurrent(
  anchor: ProjectSkillRootAnchor,
  signal?: AbortSignal,
): Promise<void> {
  checkProjectSkillSignal(signal);
  const [workspaceHeld, held] = await Promise.all([
    anchor.workspaceHandle.stat(),
    anchor.handle.stat(),
  ]);
  checkProjectSkillSignal(signal);
  const [workspaceCurrent, current] = await Promise.all([
    lstat(anchor.workspacePath).catch(() => undefined),
    lstat(anchor.path).catch(() => undefined),
  ]);
  checkProjectSkillSignal(signal);
  if (
    !workspaceCurrent?.isDirectory() ||
    workspaceCurrent.isSymbolicLink() ||
    !current?.isDirectory() ||
    current.isSymbolicLink() ||
    !sameProjectSkillStableState(anchor.workspaceIdentity, workspaceHeld) ||
    !sameProjectSkillStableState(workspaceHeld, workspaceCurrent) ||
    !sameProjectSkillStableState(anchor.identity, held) ||
    !sameProjectSkillStableState(held, current)
  ) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
}

export async function assertProjectSkillDirectoryCurrent(
  handle: FileHandle,
  identity: Stats,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  checkProjectSkillSignal(signal);
  const held = await handle.stat();
  checkProjectSkillSignal(signal);
  const current = await lstat(target).catch(() => undefined);
  checkProjectSkillSignal(signal);
  if (
    !current?.isDirectory() ||
    current.isSymbolicLink() ||
    !sameProjectSkillStableState(identity, held) ||
    !sameProjectSkillStableState(held, current)
  ) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
}

export function sameProjectSkillIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return sameIdentity(left, right);
}

export function sameProjectSkillStableState(
  left: Stats,
  right: Stats,
): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export function checkProjectSkillSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation aborted", "AbortError");
  }
}

async function handleRelativePath(
  handle: FileHandle,
  identity: Stats,
  fallbackPath: string,
  signal?: AbortSignal,
): Promise<{ path: string; strategy: ProjectSkillTraversalStrategy }> {
  const candidate =
    process.platform === "darwin"
      ? `/dev/fd/${handle.fd}`
      : process.platform === "linux"
        ? `/proc/self/fd/${handle.fd}`
        : undefined;
  if (!candidate) throw new ProjectSkillSnapshotError("workspace_untrusted");
  checkProjectSkillSignal(signal);
  const resolved = await stat(candidate).catch(() => undefined);
  checkProjectSkillSignal(signal);
  let directoryOpened = false;
  let directoryOpenErrorCode: string | undefined;
  let childOpened = false;
  let childOpenErrorCode: string | undefined;
  try {
    const directory = await opendir(candidate);
    await directory.close();
    directoryOpened = true;
  } catch (error) {
    directoryOpenErrorCode = errorCode(error);
  }
  try {
    const child = await open(
      `${candidate}/.`,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    await child.close();
    childOpened = true;
  } catch (error) {
    childOpenErrorCode = errorCode(error);
  }
  const strategy = resolveProjectSkillTraversalStrategy(process.platform, {
    fdIdentityMatches: Boolean(
      resolved?.isDirectory() && sameHandlePathIdentity(identity, resolved),
    ),
    directoryOpened,
    ...(directoryOpenErrorCode ? { directoryOpenErrorCode } : {}),
    childOpened,
    ...(childOpenErrorCode ? { childOpenErrorCode } : {}),
  });
  if (strategy === "fd_relative") return { path: candidate, strategy };
  const current = await stableDirectoryInfo(fallbackPath, signal);
  checkProjectSkillSignal(signal);
  if (!sameProjectSkillStableState(identity, current)) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  return { path: fallbackPath, strategy };
}

async function stableDirectoryInfo(
  target: string,
  signal?: AbortSignal,
): Promise<Stats> {
  checkProjectSkillSignal(signal);
  const info = await lstat(target).catch(() => undefined);
  checkProjectSkillSignal(signal);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  return info;
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino)
  );
}

function sameHandlePathIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return process.platform === "darwin"
    ? String(left.ino) === String(right.ino)
    : sameIdentity(left, right);
}

function errorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
