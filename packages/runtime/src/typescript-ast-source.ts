import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export type TypescriptAstLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

export interface TypescriptAstSource {
  workspaceRoot: string;
  target: string;
  path: string;
  pathSha256: string;
  source: string;
  fileSha256: string;
  fileBytes: number;
  language: TypescriptAstLanguage;
  scriptKind: import("typescript").ScriptKind;
}

export const MAX_TYPESCRIPT_AST_FILE_BYTES = 1024 * 1024;

export async function loadTypescriptAstSource(
  ts: typeof import("typescript"),
  workspaceRootInput: string,
  sourcePath: string,
  label: string,
  expectedSha256?: string,
): Promise<TypescriptAstSource> {
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
  const language = typescriptAstLanguage(relativePath);
  if (!language) {
    throw new Error(`${label} supports TypeScript and JavaScript source files`);
  }
  const handle = await filesystemValueWithoutPath(
    () => open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW),
    `${label} target is unavailable`,
  );
  let buffer: Buffer;
  try {
    const info = await filesystemValueWithoutPath(
      () => handle.stat(),
      `${label} target is unavailable`,
    );
    if (!info.isFile()) throw new Error(`${label} path must be a file`);
    if (info.size > MAX_TYPESCRIPT_AST_FILE_BYTES) {
      throw new Error(
        `${label} supports files up to ${MAX_TYPESCRIPT_AST_FILE_BYTES} bytes`,
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
  if (buffer.byteLength > MAX_TYPESCRIPT_AST_FILE_BYTES) {
    throw new Error(
      `${label} supports files up to ${MAX_TYPESCRIPT_AST_FILE_BYTES} bytes`,
    );
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} target must be valid UTF-8`);
  }
  const fileSha256 = sha256(buffer);
  if (expectedSha256 && fileSha256 !== expectedSha256) {
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
    language,
    scriptKind: typescriptAstScriptKind(ts, language),
  };
}

export async function assertTypescriptAstSourceCurrent(
  source: TypescriptAstSource,
  label: string,
): Promise<void> {
  const changedMessage = `${label} source changed during inspection`;
  const handle = await filesystemValueWithoutPath(
    () => open(source.target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW),
    changedMessage,
  );
  let buffer: Buffer;
  try {
    const info = await filesystemValueWithoutPath(
      () => handle.stat(),
      changedMessage,
    );
    if (!info.isFile() || info.size > MAX_TYPESCRIPT_AST_FILE_BYTES) {
      throw new Error(changedMessage);
    }
    buffer = await filesystemValueWithoutPath(
      () => handle.readFile(),
      changedMessage,
    );
  } finally {
    await filesystemValueWithoutPath(() => handle.close(), changedMessage);
  }
  if (sha256(buffer) !== source.fileSha256) {
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

function typescriptAstLanguage(
  relativePath: string,
): TypescriptAstLanguage | undefined {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    default:
      return undefined;
  }
}

function typescriptAstScriptKind(
  ts: typeof import("typescript"),
  language: TypescriptAstLanguage,
): import("typescript").ScriptKind {
  switch (language) {
    case "typescript":
      return ts.ScriptKind.TS;
    case "typescriptreact":
      return ts.ScriptKind.TSX;
    case "javascript":
      return ts.ScriptKind.JS;
    case "javascriptreact":
      return ts.ScriptKind.JSX;
  }
}
