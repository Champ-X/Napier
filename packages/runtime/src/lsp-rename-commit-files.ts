import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import type {
  LspRenameEdit,
  LspRenameFile,
} from "./lsp-rename-workspace-edit.js";
import type {
  WorkspaceChange,
  WorkspaceChangeExpectedFile,
} from "./workspace-change-model.js";

export interface LspRenameCommitExpectedFile extends WorkspaceChangeExpectedFile {
  beforeSha256: string;
  expectedSha256: string;
}

export async function lspRenameWorkspaceChanges(
  workspaceRootInput: string,
  files: LspRenameFile[],
): Promise<WorkspaceChange[]> {
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  return Promise.all(
    files.map((file) => lspRenameWorkspaceChange(workspaceRoot, file)),
  );
}

export function lspRenameExpectedFiles(
  files: WorkspaceChangeExpectedFile[],
): LspRenameCommitExpectedFile[] {
  return files.map((file) => {
    if (file.beforeSha256 === null || file.expectedSha256 === null) {
      throw new Error("LSP rename expected file state is invalid");
    }
    return {
      path: file.path,
      pathSha256: file.pathSha256,
      beforeSha256: file.beforeSha256,
      expectedSha256: file.expectedSha256,
    };
  });
}

async function lspRenameWorkspaceChange(
  workspaceRoot: string,
  file: LspRenameFile,
): Promise<WorkspaceChange> {
  const target = path.resolve(workspaceRoot, ...file.path.split("/"));
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
  const source = decodeUtf8(buffer);
  const content = applyLspRenameEdits(source, file.edits);
  if (content.includes("\u0000")) {
    throw new Error("LSP rename apply output contains a null byte");
  }
  const output = Buffer.from(content, "utf8");
  if (output.byteLength > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    throw new Error("LSP rename apply output exceeds the file limit");
  }
  const afterSha256 = sha256(output);
  if (afterSha256 === file.fileSha256) {
    throw new Error("LSP rename apply produced no file change");
  }
  return {
    path: file.path,
    pathSha256: file.pathSha256,
    beforeSha256: file.fileSha256,
    afterSha256,
    content,
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

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("LSP rename apply target is not valid UTF-8");
  }
}
