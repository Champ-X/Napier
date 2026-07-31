import { randomBytes } from "node:crypto";
import { open, readFile, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import type {
  LspRenameEdit,
  LspRenameFile,
} from "./lsp-rename-workspace-edit.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export interface LspRenameCommitExpectedFile {
  path: string;
  pathSha256: string;
  beforeSha256: string;
  expectedSha256: string;
}

export interface PreparedLspRenameFile extends LspRenameCommitExpectedFile {
  target: string;
  parent: string;
  mode: number;
  output: Buffer;
  temporaryPath: string;
  backupPath: string;
}

export interface LspRenameFileObservation {
  complete: boolean;
  matchesBefore: boolean;
  matchesExpected: boolean;
  fileSetSha256?: string;
}

export async function canonicalLspRenameWorkspaceRoot(
  workspaceRoot: string,
): Promise<string> {
  return realpath(path.resolve(workspaceRoot));
}

export function lspRenameLockTarget(
  workspaceRoot: string,
  relativePath: string,
): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath
      .split(path.sep)
      .filter(Boolean)
      .some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error("LSP rename apply path is invalid");
  }
  const target = path.resolve(workspaceRoot, relativePath);
  if (
    target === workspaceRoot ||
    !target.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("LSP rename apply path escapes the workspace");
  }
  return target;
}

export async function prepareLspRenameFile(
  workspaceRoot: string,
  file: LspRenameFile,
): Promise<PreparedLspRenameFile> {
  const target = lspRenameLockTarget(workspaceRoot, file.path);
  const canonical = await realpath(target);
  if (canonical !== target) {
    throw new Error("LSP rename apply target is not canonical");
  }
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    throw new Error("LSP rename apply target is unavailable");
  }
  const buffer = await readFile(target);
  if (sha256(buffer) !== file.fileSha256) {
    throw new Error("LSP rename apply preview is stale");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("LSP rename apply target is not valid UTF-8");
  }
  const updated = applyLspRenameEdits(source, file.edits);
  if (updated.includes("\u0000")) {
    throw new Error("LSP rename apply output contains a null byte");
  }
  const output = Buffer.from(updated, "utf8");
  if (output.byteLength > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    throw new Error("LSP rename apply output exceeds the file limit");
  }
  const expectedSha256 = sha256(output);
  if (expectedSha256 === file.fileSha256) {
    throw new Error("LSP rename apply produced no file change");
  }
  const suffix = randomBytes(10).toString("hex");
  const parent = path.dirname(target);
  return {
    path: file.path,
    pathSha256: file.pathSha256,
    beforeSha256: file.fileSha256,
    expectedSha256,
    target,
    parent,
    mode: info.mode,
    output,
    temporaryPath: path.join(
      parent,
      `.${path.basename(target)}.napier-rename-${suffix}.tmp`,
    ),
    backupPath: path.join(
      parent,
      `.${path.basename(target)}.napier-rename-${suffix}.bak`,
    ),
  };
}

export async function stageLspRenameFile(
  file: PreparedLspRenameFile,
): Promise<void> {
  const handle = await open(file.temporaryPath, "wx", file.mode);
  try {
    await handle.writeFile(file.output);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function cleanupLspRenameFiles(
  staged: PreparedLspRenameFile[],
  backups: PreparedLspRenameFile[],
): Promise<{ complete: boolean; remainingBackupCount: number }> {
  const [temporaryOutcomes, backupOutcomes] = await Promise.all([
    Promise.allSettled(staged.map((file) => unlink(file.temporaryPath))),
    Promise.allSettled(backups.map((file) => unlink(file.backupPath))),
  ]);
  const remainingTemporaryCount = temporaryOutcomes.filter(
    (outcome) =>
      outcome.status === "rejected" && errorCode(outcome.reason) !== "ENOENT",
  ).length;
  const remainingBackupCount = backupOutcomes.filter(
    (outcome) =>
      outcome.status === "rejected" && errorCode(outcome.reason) !== "ENOENT",
  ).length;
  return {
    complete: remainingTemporaryCount === 0 && remainingBackupCount === 0,
    remainingBackupCount,
  };
}

export async function observeLspRenameFiles(
  files: PreparedLspRenameFile[],
): Promise<LspRenameFileObservation> {
  const observed: Array<{ pathSha256: string; fileSha256: string }> = [];
  for (const file of files) {
    try {
      observed.push({
        pathSha256: file.pathSha256,
        fileSha256: await readLspRenameCurrentHash(file.target),
      });
    } catch {
      return {
        complete: false,
        matchesBefore: false,
        matchesExpected: false,
      };
    }
  }
  return {
    complete: true,
    matchesBefore: observed.every(
      (item, index) => item.fileSha256 === files[index]!.beforeSha256,
    ),
    matchesExpected: observed.every(
      (item, index) => item.fileSha256 === files[index]!.expectedSha256,
    ),
    fileSetSha256: sha256(canonicalJson(observed)),
  };
}

export async function readLspRenameCurrentHash(
  target: string,
): Promise<string> {
  return sha256(await readFile(target));
}

export async function syncLspRenameDirectories(
  files: PreparedLspRenameFile[],
): Promise<boolean> {
  const directories = [...new Set(files.map((file) => file.parent))];
  const outcomes = await Promise.allSettled(
    directories.map(async (directory) => {
      const handle = await open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }),
  );
  return outcomes.every((outcome) => outcome.status === "fulfilled");
}

export function lspRenameCommitReceipt(
  sourcePreviewResultSha256: string,
  files: PreparedLspRenameFile[],
): unknown {
  return {
    sourcePreviewResultSha256,
    files: files.map((file) => ({
      pathSha256: file.pathSha256,
      beforeSha256: file.beforeSha256,
      expectedSha256: file.expectedSha256,
    })),
  };
}

export function lspRenameExpectedFile(
  file: PreparedLspRenameFile,
): LspRenameCommitExpectedFile {
  return {
    path: file.path,
    pathSha256: file.pathSha256,
    beforeSha256: file.beforeSha256,
    expectedSha256: file.expectedSha256,
  };
}

function applyLspRenameEdits(source: string, edits: LspRenameEdit[]): string {
  const resolved = edits.map((edit) => {
    const start = lspPositionOffset(
      source,
      edit.startLine,
      edit.startCharacter,
    );
    const end = lspPositionOffset(source, edit.endLine, edit.endCharacter);
    if (start > end || source.slice(start, end) !== edit.oldText) {
      throw new Error("LSP rename apply edit no longer matches source");
    }
    return { start, end, newText: edit.newText };
  });
  let output = source;
  for (const edit of resolved.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`;
  }
  return output;
}

function lspPositionOffset(
  source: string,
  line: number,
  character: number,
): number {
  if (line < 1 || character < 1) {
    throw new Error("LSP rename apply range is invalid");
  }
  const lines = source.split("\n");
  const selected = lines[line - 1];
  const characterIndex = character - 1;
  if (selected === undefined || characterIndex > selected.length) {
    throw new Error("LSP rename apply range is outside the source");
  }
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += lines[index]!.length + 1;
  }
  return offset + characterIndex;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
