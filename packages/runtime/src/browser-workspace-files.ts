import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { MAX_BROWSER_SCREENSHOT_BYTES } from "./browser-session-model.js";
import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";
import {
  preflightWorkspaceOutputFile,
  type WorkspaceOutputFile,
  writeWorkspaceOutputFile,
} from "./workspace-output-file.js";

export const MAX_BROWSER_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_BROWSER_DOWNLOAD_BYTES = 32 * 1024 * 1024;

export type BrowserWorkspaceFile = WorkspaceOutputFile;

export interface BrowserPreparedUpload extends BrowserWorkspaceFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export async function inspectBrowserUpload(
  workspaceRootInput: string,
  inputPath: string,
): Promise<BrowserWorkspaceFile> {
  const prepared = await prepareBrowserUpload(workspaceRootInput, inputPath);
  try {
    const {
      name: _name,
      mimeType: _mimeType,
      buffer: _buffer,
      ...file
    } = prepared;
    return file;
  } finally {
    prepared.buffer.fill(0);
  }
}

export async function prepareBrowserUpload(
  workspaceRootInput: string,
  inputPath: string,
): Promise<BrowserPreparedUpload> {
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
      name: path.basename(relativePath),
      mimeType: browserUploadMimeType(relativePath),
      buffer,
    };
  } finally {
    await handle.close();
  }
}

export function assertBrowserPreparedUpload(
  upload: BrowserPreparedUpload,
): void {
  if (
    upload.pathSha256 !== sha256(upload.path) ||
    upload.fileSha256 !== sha256(upload.buffer) ||
    upload.fileBytes !== upload.buffer.byteLength ||
    upload.fileBytes > MAX_BROWSER_UPLOAD_BYTES ||
    upload.name !== path.basename(upload.path) ||
    !upload.mimeType
  ) {
    throw new Error("Browser prepared upload is invalid");
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
  return await writeWorkspaceOutputFile(
    workspaceRootInput,
    inputPath,
    stream,
    {
      scope: "Browser",
      action: "download",
      maximumBytes: MAX_BROWSER_DOWNLOAD_BYTES,
    },
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
  return await writeWorkspaceOutputFile(
    workspaceRootInput,
    inputPath,
    Readable.from([screenshot]),
    {
      scope: "Browser",
      action: "screenshot",
      maximumBytes: screenshot.byteLength,
    },
    signal,
  );
}

export async function preflightBrowserDownload(
  workspaceRootInput: string,
  inputPath: string,
): Promise<void> {
  await preflightWorkspaceOutputFile(workspaceRootInput, inputPath, {
    scope: "Browser",
    action: "download",
    maximumBytes: MAX_BROWSER_DOWNLOAD_BYTES,
  });
}

export async function preflightBrowserScreenshot(
  workspaceRootInput: string,
  inputPath: string,
): Promise<void> {
  assertBrowserScreenshotPath(inputPath);
  await preflightWorkspaceOutputFile(workspaceRootInput, inputPath, {
    scope: "Browser",
    action: "screenshot",
    maximumBytes: MAX_BROWSER_SCREENSHOT_BYTES,
  });
}

function browserUploadMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".txt":
    case ".log":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".xml":
      return "application/xml";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
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
