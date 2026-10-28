import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  SubagentWorktreeFile,
  SubagentWorktreeSnapshot,
} from "./subagent-worktree-diff.js";
import { SUBAGENT_WORKTREE_POLICY as policy } from "./subagent-worktree-policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const GENERATED_WORKTREE_DIRECTORIES = new Set([
  ".vite",
  "benchmark-results",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);
const ACTIVE_CHANGE_ARTIFACT =
  /^\..+\.napier-change-[a-f0-9]{20}\.(?:bak|deleted|tmp)$/u;

export interface SubagentWorktreeSession {
  taskId: string;
  root: string;
  sourceRoot: string;
  sourceSnapshotSha256: string;
  sourceFileCount: number;
  sourceBytes: number;
  baselineSha256: string;
  copyReceipt: WorktreeCopyReceipt;
  readScopes: Array<{ path: string; kind: "file" | "tree" | "names" }>;
  writePaths: string[];
  writeScopeSetSha256: string;
}

export interface WorktreeCopyReceipt {
  clonedFiles: number;
  copiedFiles: number;
  cloneAttempts?: number;
  cloneFallbackCode?: string;
}

interface CopyCapabilities {
  destinationDevice: number;
  unsupportedSources: Set<string>;
}

export async function readWorktreeSnapshot(
  root: string,
  options: {
    signal?: AbortSignal;
    retainPaths?: ReadonlySet<string>;
    copyTo?: string;
    copyReceipt?: WorktreeCopyReceipt;
    forceCopy?: boolean;
    scopes?: ReadonlyArray<{ path: string; kind: "file" | "tree" | "names" }>;
  } = {},
): Promise<SubagentWorktreeSnapshot> {
  const files: SubagentWorktreeFile[] = [];
  const capabilities: CopyCapabilities = {
    destinationDevice: options.copyTo ? (await lstat(options.copyTo)).dev : 0,
    unsupportedSources: new Set(),
  };
  let bytes = 0;
  let directories = 0;
  const directoryPaths: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    options.signal?.throwIfAborted();
    if (++directories > policy.maxDirectories || depth > policy.maxDepth) {
      throw new Error("Subagent worktree directory policy limit exceeded");
    }
    const info = await lstat(directory);
    if (depth > 0)
      directoryPaths.push(
        path.relative(root, directory).split(path.sep).join("/"),
      );
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    ) {
      throw new Error("Subagent worktree directory is not canonical");
    }
    if (options.copyTo && depth > 0)
      await mkdir(path.join(options.copyTo, path.relative(root, directory)), {
        recursive: true,
        mode: 0o700,
      });
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      options.signal?.throwIfAborted();
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (ACTIVE_CHANGE_ARTIFACT.test(child.name)) {
        const original = relative.replace(
          /\.([^/]+)\.napier-change-[a-f0-9]{20}\.(?:bak|deleted|tmp)$/u,
          "$1",
        );
        if (!selectedPath(original, false, options.scopes)) continue;
        throw new Error(
          "Subagent worktree source contains an active change transaction",
        );
      }
      if (
        isProtectedWorkspacePathSegment(child.name) ||
        GENERATED_WORKTREE_DIRECTORIES.has(child.name.toLowerCase())
      )
        continue;
      if (
        !selectedPath(
          relative,
          child.isDirectory() || child.isSymbolicLink(),
          options.scopes,
        )
      )
        continue;
      if (child.isSymbolicLink())
        throw new Error("Subagent worktree does not admit workspace symlinks");
      if (child.isDirectory()) {
        await visit(absolute, depth + 1);
        continue;
      }
      if (!child.isFile())
        throw new Error("Subagent worktree does not admit special files");
      if (files.length >= policy.maxFiles)
        throw new Error("Subagent worktree file policy limit exceeded");
      const captured = await readCanonicalWorktreeFile(absolute);
      bytes += captured.buffer.byteLength;
      if (bytes > policy.maxSourceBytes)
        throw new Error("Subagent worktree byte policy limit exceeded");
      const retained = options.retainPaths?.has(relative) === true;
      if (retained && captured.buffer.byteLength > policy.maxWriteFileBytes) {
        throw new Error("Subagent worktree write target exceeds its limit");
      }
      if (options.copyTo) {
        await copyCapturedFile(
          absolute,
          path.join(options.copyTo, relative),
          captured,
          options,
          capabilities,
        );
      }
      files.push({
        path: relative,
        pathSha256: sha256(relative),
        fileSha256: sha256(captured.buffer),
        sizeBytes: captured.buffer.byteLength,
        mode: captured.mode,
        ...(retained ? { buffer: captured.buffer } : {}),
      });
    }
  };
  await visit(root, 0);
  return {
    files,
    directories: directoryPaths,
    fileCount: files.length,
    bytes,
    contentSha256: worktreeSnapshotHash(files, directoryPaths),
  };
}

export function worktreeSnapshotHash(
  files: SubagentWorktreeFile[],
  directories: string[] = [],
): string {
  return sha256(
    canonicalJson({
      directories,
      files: files.map(({ pathSha256, fileSha256, sizeBytes, mode }) => ({
        pathSha256,
        fileSha256,
        sizeBytes,
        mode,
      })),
    }),
  );
}

export async function readCanonicalWorktreeFile(
  target: string,
): Promise<{ buffer: Buffer; mode: number; device: number }> {
  if ((await realpath(target)) !== target)
    throw new Error("Subagent worktree source file is not canonical");
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > policy.maxSourceFileBytes) {
      throw new Error("Subagent worktree source file exceeds its limit");
    }
    // Bounded even if a concurrent writer grows the file while it is read.
    const buffer = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const [after, current] = await Promise.all([handle.stat(), lstat(target)]);
    if (
      offset !== opened.size ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      after.size !== opened.size ||
      current.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      current.ctimeMs !== opened.ctimeMs ||
      (await realpath(target)) !== target
    ) {
      throw new Error("Subagent worktree source file changed during capture");
    }
    return {
      buffer: buffer.subarray(0, offset),
      mode: opened.mode & 0o777,
      device: opened.dev,
    };
  } finally {
    await handle.close();
  }
}

async function copyCapturedFile(
  source: string,
  target: string,
  captured: { buffer: Buffer; mode: number; device: number },
  options: { forceCopy?: boolean; copyReceipt?: WorktreeCopyReceipt },
  capabilities: CopyCapabilities,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let cloned = false;
  const devicePair = `${captured.device}:${capabilities.destinationDevice}`;
  if (!options.forceCopy && !capabilities.unsupportedSources.has(devicePair)) {
    if (options.copyReceipt)
      options.copyReceipt.cloneAttempts =
        (options.copyReceipt.cloneAttempts ?? 0) + 1;
    try {
      await copyFile(
        source,
        target,
        constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE,
      );
      cloned = true;
    } catch (error) {
      if (
        !["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EXDEV"].includes(
          errorCode(error) ?? "",
        )
      )
        throw error;
      capabilities.unsupportedSources.add(devicePair);
      if (options.copyReceipt)
        options.copyReceipt.cloneFallbackCode = errorCode(error)!;
    }
  }
  if (!cloned) {
    const handle = await open(target, "wx", captured.mode);
    try {
      await handle.writeFile(captured.buffer);
    } finally {
      await handle.close();
    }
  }
  await chmod(target, captured.mode);
  const copied = await readCanonicalWorktreeFile(target);
  if (!copied.buffer.equals(captured.buffer) || copied.mode !== captured.mode) {
    throw new Error("Subagent worktree source changed during copy");
  }
  if (options.copyReceipt)
    options.copyReceipt[cloned ? "clonedFiles" : "copiedFiles"] += 1;
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function selectedPath(
  relative: string,
  directory: boolean,
  scopes?: ReadonlyArray<{ path: string; kind: "file" | "tree" | "names" }>,
): boolean {
  return (
    !scopes ||
    scopes.some(
      (scope) =>
        relative === scope.path ||
        (scope.kind !== "file" &&
          (scope.path === "." || relative.startsWith(`${scope.path}/`))) ||
        (directory && scope.path.startsWith(`${relative}/`)),
    )
  );
}
