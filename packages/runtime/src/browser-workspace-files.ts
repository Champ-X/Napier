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

import { MAX_BROWSER_SCREENSHOT_BYTES } from "./browser-session-model.js";
import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_BROWSER_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_BROWSER_DOWNLOAD_BYTES = 32 * 1024 * 1024;

export interface BrowserWorkspaceFile {
  target: string;
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
}

export async function inspectBrowserUpload(
  workspaceRootInput: string,
  inputPath: string,
): Promise<BrowserWorkspaceFile> {
  const { relativePath, target } = await resolveExistingBrowserFile(
    workspaceRootInput,
    inputPath,
    "upload",
  );
  const handle = await open(
    target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Browser upload path must be a file");
    if (info.size > MAX_BROWSER_UPLOAD_BYTES) {
      throw new Error(
        `Browser uploads support files up to ${MAX_BROWSER_UPLOAD_BYTES} bytes`,
      );
    }
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_BROWSER_UPLOAD_BYTES) {
      throw new Error(
        `Browser uploads support files up to ${MAX_BROWSER_UPLOAD_BYTES} bytes`,
      );
    }
    return {
      target,
      path: relativePath,
      pathSha256: sha256(relativePath),
      fileSha256: sha256(buffer),
      fileBytes: buffer.byteLength,
    };
  } finally {
    await handle.close();
  }
}

export async function assertBrowserUploadCurrent(
  file: BrowserWorkspaceFile,
): Promise<void> {
  const handle = await open(
    file.target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  ).catch(() => {
    throw new Error("Browser upload changed during execution");
  });
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size !== file.fileBytes ||
      info.size > MAX_BROWSER_UPLOAD_BYTES
    ) {
      throw new Error("Browser upload changed during execution");
    }
    const buffer = await handle.readFile();
    if (
      buffer.byteLength !== file.fileBytes ||
      sha256(buffer) !== file.fileSha256
    ) {
      throw new Error("Browser upload changed during execution");
    }
  } finally {
    await handle.close();
  }
}

export async function writeBrowserDownload(
  workspaceRootInput: string,
  inputPath: string,
  stream: Readable,
  signal?: AbortSignal,
): Promise<BrowserWorkspaceFile> {
  return await writeNewBrowserFile(
    workspaceRootInput,
    inputPath,
    "download",
    stream,
    MAX_BROWSER_DOWNLOAD_BYTES,
    signal,
  );
}

export async function writeBrowserScreenshot(
  workspaceRootInput: string,
  inputPath: string,
  screenshot: Buffer,
  signal?: AbortSignal,
): Promise<BrowserWorkspaceFile> {
  assertBrowserScreenshotPath(inputPath);
  if (
    screenshot.byteLength < 1 ||
    screenshot.byteLength > MAX_BROWSER_SCREENSHOT_BYTES
  ) {
    throw new Error("Browser screenshot exceeds the output limit");
  }
  return await writeNewBrowserFile(
    workspaceRootInput,
    inputPath,
    "screenshot",
    Readable.from([screenshot]),
    screenshot.byteLength,
    signal,
  );
}

export async function preflightBrowserDownload(
  workspaceRootInput: string,
  inputPath: string,
): Promise<void> {
  await resolveNewBrowserFile(workspaceRootInput, inputPath, "download");
}

export async function preflightBrowserScreenshot(
  workspaceRootInput: string,
  inputPath: string,
): Promise<void> {
  assertBrowserScreenshotPath(inputPath);
  await resolveNewBrowserFile(workspaceRootInput, inputPath, "screenshot");
}

async function writeNewBrowserFile(
  workspaceRootInput: string,
  inputPath: string,
  action: string,
  stream: Readable,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<BrowserWorkspaceFile> {
  const target = await resolveNewBrowserFile(
    workspaceRootInput,
    inputPath,
    action,
  );
  assertNotAborted(signal, action);
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
    await assertOpenTarget(target, opened.dev, opened.ino, action);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of stream) {
      assertNotAborted(signal, action);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(
          `Browser ${action}s support files up to ${maximumBytes} bytes`,
        );
      }
      chunks.push(chunk);
      await writeFully(handle, chunk, action);
    }
    await handle.sync();
    const completed = await handle.stat();
    if (
      !completed.isFile() ||
      completed.size !== bytes ||
      completed.dev !== opened.dev ||
      completed.ino !== opened.ino
    ) {
      throw new Error(`Browser ${action} target changed during execution`);
    }
    await assertOpenTarget(target, opened.dev, opened.ino, action);
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

async function resolveExistingBrowserFile(
  workspaceRootInput: string,
  inputPath: string,
  action: string,
): Promise<{
  workspaceRoot: string;
  relativePath: string;
  target: string;
}> {
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const relativePath = normalizeBrowserWorkspacePath(inputPath, action);
  const lexical = path.resolve(workspaceRoot, relativePath);
  if (!isPathInsideWorkspace(lexical, workspaceRoot)) {
    throw new Error(`Browser ${action} path escapes the workspace`);
  }
  await assertSafeParent(workspaceRoot, relativePath, action);
  const info = await lstat(lexical).catch(() => {
    throw new Error(`Browser ${action} target is unavailable`);
  });
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Browser ${action} path must be a regular file`);
  }
  const canonical = await realpath(lexical);
  if (canonical !== lexical) {
    throw new Error(`Browser ${action} path must not traverse a symlink`);
  }
  return { workspaceRoot, relativePath, target: lexical };
}

async function resolveNewBrowserFile(
  workspaceRootInput: string,
  inputPath: string,
  action: string,
): Promise<{
  workspaceRoot: string;
  relativePath: string;
  target: string;
}> {
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const relativePath = normalizeBrowserWorkspacePath(inputPath, action);
  const target = path.resolve(workspaceRoot, relativePath);
  if (!isPathInsideWorkspace(target, workspaceRoot)) {
    throw new Error(`Browser ${action} path escapes the workspace`);
  }
  await assertSafeParent(workspaceRoot, relativePath, action);
  try {
    await lstat(target);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { workspaceRoot, relativePath, target };
    }
    throw error;
  }
  throw new Error(`Browser ${action} target already exists`);
}

async function assertSafeParent(
  workspaceRoot: string,
  relativePath: string,
  action: string,
): Promise<void> {
  let current = workspaceRoot;
  for (const segment of relativePath.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => {
      throw new Error(`Browser ${action} parent path does not exist`);
    });
    if (info.isSymbolicLink()) {
      throw new Error(`Browser ${action} refuses symlink path components`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Browser ${action} parent path must be a directory`);
    }
  }
  const parent = path.dirname(path.resolve(workspaceRoot, relativePath));
  if ((await realpath(parent)) !== parent) {
    throw new Error(`Browser ${action} parent must not traverse a symlink`);
  }
}

async function assertOpenTarget(
  target: {
    workspaceRoot: string;
    target: string;
  },
  device: number,
  inode: number,
  action = "download",
): Promise<void> {
  const [canonical, info] = await Promise.all([
    realpath(target.target),
    lstat(target.target),
  ]).catch(() => {
    throw new Error(`Browser ${action} target changed during execution`);
  });
  if (
    canonical !== target.target ||
    !isPathInsideWorkspace(canonical, target.workspaceRoot) ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.dev !== device ||
    info.ino !== inode
  ) {
    throw new Error(`Browser ${action} target changed during execution`);
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

function normalizeBrowserWorkspacePath(input: string, action: string): string {
  if (
    !input ||
    input.length > 500 ||
    path.isAbsolute(input) ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw new Error(
      `Browser ${action} path must be a visible workspace-relative path`,
    );
  }
  const normalized = path.normalize(input);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Browser ${action} path escapes the workspace`);
  }
  if (
    normalized
      .split(path.sep)
      .some((segment) => isProtectedWorkspacePathSegment(segment))
  ) {
    throw new Error(`Browser ${action} path targets a protected workspace`);
  }
  return normalized;
}

function assertBrowserScreenshotPath(inputPath: string): void {
  if (path.extname(inputPath).toLowerCase() !== ".png") {
    throw new Error("Browser screenshot path must end in .png");
  }
}

async function writeFully(
  handle: FileHandle,
  buffer: Buffer,
  action = "download",
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
      throw new Error(`Browser ${action} write made no progress`);
    }
    offset += written.bytesWritten;
  }
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  action = "download",
): void {
  if (signal?.aborted) throw new Error(`Browser ${action} was cancelled`);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
