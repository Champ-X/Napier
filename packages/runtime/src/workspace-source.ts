import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export interface WorkspaceSourceFile {
  workspaceRoot: string;
  target: string;
  path: string;
  pathSha256: string;
  source: string;
  fileSha256: string;
  fileBytes: number;
}

export async function loadWorkspaceSourceFile(
  workspaceRootInput: string,
  sourcePath: string,
  options: {
    label: string;
    maxBytes: number;
    extensions: ReadonlySet<string>;
    extensionError: string;
    expectedSha256?: string;
  },
): Promise<WorkspaceSourceFile> {
  const { label } = options;
  if (
    !sourcePath ||
    path.isAbsolute(sourcePath) ||
    sourcePath.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(sourcePath)
  ) {
    throw new Error(`${label} path must be workspace-relative`);
  }
  const workspaceRoot = await filesystemValueWithoutPath(
    () => realpath(path.resolve(workspaceRootInput)),
    `${label} workspace is unavailable`,
  );
  const lexicalTarget = path.resolve(workspaceRoot, sourcePath);
  if (!isPathInsideWorkspace(lexicalTarget, workspaceRoot)) {
    throw new Error(`${label} path escapes the workspace`);
  }
  const relativePath = path.relative(workspaceRoot, lexicalTarget);
  if (
    relativePath
      .split(path.sep)
      .filter(Boolean)
      .some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error(`${label} path targets a protected workspace root`);
  }
  if (!options.extensions.has(path.extname(relativePath).toLowerCase())) {
    throw new Error(options.extensionError);
  }
  const target = await filesystemValueWithoutPath(
    () => realpath(lexicalTarget),
    `${label} target is unavailable`,
  );
  if (path.resolve(target) !== path.resolve(lexicalTarget)) {
    throw new Error(`${label} path must not traverse a symlink`);
  }
  if (!isPathInsideWorkspace(target, workspaceRoot)) {
    throw new Error(`${label} path resolves outside the workspace`);
  }
  const handle = await filesystemValueWithoutPath(
    () => open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)),
    `${label} target is unavailable`,
  );
  let buffer: Buffer;
  try {
    const info = await filesystemValueWithoutPath(
      () => handle.stat(),
      `${label} target is unavailable`,
    );
    if (!info.isFile()) throw new Error(`${label} path must be a file`);
    if (info.size > options.maxBytes) {
      throw new Error(
        `${label} supports files up to ${options.maxBytes} bytes`,
      );
    }
    buffer = await filesystemValueWithoutPath(
      () => handle.readFile(),
      `${label} target is unavailable`,
    );
  } finally {
    await filesystemValueWithoutPath(
      () => handle.close(),
      `${label} target is unavailable`,
    );
  }
  if (buffer.byteLength > options.maxBytes) {
    throw new Error(`${label} supports files up to ${options.maxBytes} bytes`);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} target must be valid UTF-8`);
  }
  const fileSha256 = sha256(buffer);
  if (options.expectedSha256 && fileSha256 !== options.expectedSha256) {
    throw new Error(`${label} source does not match expectedSha256`);
  }
  return {
    workspaceRoot,
    target,
    path: relativePath,
    pathSha256: sha256(relativePath),
    source,
    fileSha256,
    fileBytes: buffer.byteLength,
  };
}

export async function assertWorkspaceSourceCurrent(
  source: Pick<WorkspaceSourceFile, "target" | "fileSha256" | "fileBytes">,
  options: { label: string; maxBytes: number; changedMessage?: string },
): Promise<void> {
  const changedMessage =
    options.changedMessage ??
    `${options.label} source changed during execution`;
  const handle = await filesystemValueWithoutPath(
    () =>
      open(source.target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)),
    changedMessage,
  );
  let buffer: Buffer;
  try {
    const info = await filesystemValueWithoutPath(
      () => handle.stat(),
      changedMessage,
    );
    if (
      !info.isFile() ||
      info.size > options.maxBytes ||
      info.size !== source.fileBytes
    ) {
      throw new Error(changedMessage);
    }
    buffer = await filesystemValueWithoutPath(
      () => handle.readFile(),
      changedMessage,
    );
  } finally {
    await filesystemValueWithoutPath(() => handle.close(), changedMessage);
  }
  if (
    buffer.byteLength !== source.fileBytes ||
    sha256(buffer) !== source.fileSha256
  ) {
    throw new Error(changedMessage);
  }
}

async function filesystemValueWithoutPath<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(message);
  }
}
