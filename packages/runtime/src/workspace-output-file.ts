import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export interface WorkspaceOutputFile {
  target: string;
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
}

export interface WorkspaceOutputFileOptions {
  scope: string;
  action: string;
  maximumBytes: number;
}

export async function preflightWorkspaceOutputFile(
  workspaceRootInput: string,
  inputPath: string,
  options: WorkspaceOutputFileOptions,
): Promise<string> {
  return (
    await resolveNewWorkspaceOutputFile(workspaceRootInput, inputPath, options)
  ).relativePath;
}

export async function writeWorkspaceOutputFile(
  workspaceRootInput: string,
  inputPath: string,
  stream: Readable,
  options: WorkspaceOutputFileOptions,
  signal?: AbortSignal,
): Promise<WorkspaceOutputFile> {
  const target = await resolveNewWorkspaceOutputFile(
    workspaceRootInput,
    inputPath,
    options,
  );
  assertNotAborted(signal, options);
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(
      target.target,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o644,
    );
    created = true;
    const opened = await handle.stat();
    await assertOpenTarget(target, opened.dev, opened.ino, options);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of stream) {
      assertNotAborted(signal, options);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > options.maximumBytes) {
        throw new Error(
          `${label(options)} supports files up to ${options.maximumBytes} bytes`,
        );
      }
      chunks.push(chunk);
      await writeFully(handle, chunk, options);
    }
    await handle.sync();
    const completed = await handle.stat();
    if (
      !completed.isFile() ||
      completed.size !== bytes ||
      completed.dev !== opened.dev ||
      completed.ino !== opened.ino
    ) {
      throw new Error(`${label(options)} target changed during execution`);
    }
    await assertOpenTarget(target, opened.dev, opened.ino, options);
    return {
      target: target.target,
      path: target.relativePath,
      pathSha256: sha256(target.relativePath),
      fileSha256: sha256(Buffer.concat(chunks, bytes)),
      fileBytes: bytes,
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (created) await removeFailedTarget(target).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function normalizeWorkspaceOutputPath(
  input: string,
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): string {
  if (
    !input ||
    input.length > 500 ||
    path.isAbsolute(input) ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw new Error(
      `${label(options)} path must be a visible workspace-relative path`,
    );
  }
  const normalized = path.normalize(input);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`${label(options)} path escapes the workspace`);
  }
  if (
    normalized
      .split(path.sep)
      .some((segment) => isProtectedWorkspacePathSegment(segment))
  ) {
    throw new Error(`${label(options)} path targets a protected workspace`);
  }
  return normalized;
}

async function resolveNewWorkspaceOutputFile(
  workspaceRootInput: string,
  inputPath: string,
  options: WorkspaceOutputFileOptions,
): Promise<{
  workspaceRoot: string;
  relativePath: string;
  target: string;
}> {
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const relativePath = normalizeWorkspaceOutputPath(inputPath, options);
  const target = path.resolve(workspaceRoot, relativePath);
  if (!isPathInsideWorkspace(target, workspaceRoot)) {
    throw new Error(`${label(options)} path escapes the workspace`);
  }
  await assertSafeParent(workspaceRoot, relativePath, options);
  try {
    await lstat(target);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { workspaceRoot, relativePath, target };
    }
    throw error;
  }
  throw new Error(`${label(options)} target already exists`);
}

async function assertSafeParent(
  workspaceRoot: string,
  relativePath: string,
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): Promise<void> {
  let current = workspaceRoot;
  for (const segment of relativePath.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => {
      throw new Error(`${label(options)} parent path does not exist`);
    });
    if (info.isSymbolicLink()) {
      throw new Error(`${label(options)} refuses symlink path components`);
    }
    if (!info.isDirectory()) {
      throw new Error(`${label(options)} parent path must be a directory`);
    }
  }
  const parent = path.dirname(path.resolve(workspaceRoot, relativePath));
  if ((await realpath(parent)) !== parent) {
    throw new Error(`${label(options)} parent must not traverse a symlink`);
  }
}

async function assertOpenTarget(
  target: { workspaceRoot: string; target: string },
  device: number,
  inode: number,
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): Promise<void> {
  const [canonical, info] = await Promise.all([
    realpath(target.target),
    lstat(target.target),
  ]).catch(() => {
    throw new Error(`${label(options)} target changed during execution`);
  });
  if (
    canonical !== target.target ||
    !isPathInsideWorkspace(canonical, target.workspaceRoot) ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.dev !== device ||
    info.ino !== inode
  ) {
    throw new Error(`${label(options)} target changed during execution`);
  }
}

async function removeFailedTarget(target: {
  workspaceRoot: string;
  target: string;
}): Promise<void> {
  const canonical = await realpath(target.target);
  if (
    canonical !== target.target ||
    !isPathInsideWorkspace(canonical, target.workspaceRoot)
  ) {
    return;
  }
  await unlink(target.target);
}

async function writeFully(
  handle: FileHandle,
  buffer: Buffer,
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const written = await handle.write(
      buffer,
      offset,
      buffer.byteLength - offset,
      null,
    );
    if (written.bytesWritten <= 0) {
      throw new Error(`${label(options)} write made no progress`);
    }
    offset += written.bytesWritten;
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): void {
  if (signal?.aborted) throw new Error(`${label(options)} was cancelled`);
}

function label(
  options: Pick<WorkspaceOutputFileOptions, "scope" | "action">,
): string {
  return `${options.scope} ${options.action}`;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
