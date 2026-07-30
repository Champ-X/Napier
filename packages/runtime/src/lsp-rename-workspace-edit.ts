import { sha256 } from "./ed25519.js";
import { parseLspRange, type LspRange } from "./lsp-locations.js";

export const MAX_LSP_RENAME_FILES = 32;
export const MAX_LSP_RENAME_EDITS = 256;
export const MAX_LSP_RENAME_NEW_NAME_CHARS = 256;
export const MAX_LSP_RENAME_REPLACEMENT_CHARS = 1_000;
export const MAX_LSP_RENAME_PREVIEW_BYTES = 32 * 1024;
export const MAX_LSP_RENAME_TOOL_OUTPUT_BYTES = 64 * 1024;

export interface LspRenameCandidate {
  uri: string;
  range: LspRange;
  newText: string;
}

export type PrepareRenameResult =
  | { kind: "range"; range: LspRange; placeholderSha256?: string }
  | { kind: "default" };

export interface LspRenameEdit {
  path: string;
  pathSha256: string;
  fileSha256: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  rangeSha256: string;
  oldText: string;
  oldTextSha256: string;
  newText: string;
  newTextSha256: string;
}

export interface LspRenameFile {
  path: string;
  pathSha256: string;
  fileSha256: string;
  edits: LspRenameEdit[];
}

export function validateLspRenameNewName(value: string): void {
  if (
    !value ||
    value.trim() !== value ||
    value.length > MAX_LSP_RENAME_NEW_NAME_CHARS ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(
      `LSP rename newName must be 1-${MAX_LSP_RENAME_NEW_NAME_CHARS} non-control characters without surrounding whitespace`,
    );
  }
}

export function parsePrepareRenameResult(
  value: unknown,
): PrepareRenameResult | undefined {
  if (value === null || value === undefined) return undefined;
  const directRange = parseLspRange(value);
  if (directRange) {
    if (!hasOnlyKeys(value, ["start", "end"])) {
      throw new Error("LSP rename prepare response is malformed");
    }
    return { kind: "range", range: directRange };
  }
  if (!record(value)) {
    throw new Error("LSP rename prepare response is malformed");
  }
  const range = parseLspRange(value["range"]);
  if (range) {
    if (!hasOnlyKeys(value, ["range", "placeholder"])) {
      throw new Error("LSP rename prepare response is malformed");
    }
    const placeholder = value["placeholder"];
    if (placeholder !== undefined && typeof placeholder !== "string") {
      throw new Error("LSP rename prepare placeholder is malformed");
    }
    return {
      kind: "range",
      range,
      ...(typeof placeholder === "string"
        ? { placeholderSha256: sha256(placeholder) }
        : {}),
    };
  }
  if (
    value["defaultBehavior"] === true &&
    hasOnlyKeys(value, ["defaultBehavior"])
  ) {
    return { kind: "default" };
  }
  throw new Error("LSP rename prepare response is malformed");
}

export function prepareRenameReceipt(
  value: PrepareRenameResult | undefined,
): unknown {
  if (!value) return null;
  return value.kind === "default"
    ? { kind: value.kind }
    : {
        kind: value.kind,
        range: value.range,
        placeholderSha256: value.placeholderSha256 ?? null,
      };
}

export function parseLspRenameWorkspaceEdit(
  value: unknown,
): LspRenameCandidate[] {
  if (value === null || value === undefined) return [];
  if (!record(value)) {
    throw new Error("LSP rename response must be a WorkspaceEdit or null");
  }
  const changes = value["changes"];
  const documentChanges = value["documentChanges"];
  if (changes !== undefined && documentChanges !== undefined) {
    throw new Error(
      "LSP rename response cannot contain both changes and documentChanges",
    );
  }
  if (value["changeAnnotations"] !== undefined) {
    throw new Error("LSP rename annotated edits are not supported");
  }
  if (!hasOnlyKeys(value, ["changes", "documentChanges"])) {
    throw new Error("LSP rename response contains unsupported fields");
  }
  const candidates =
    changes !== undefined
      ? parseChanges(changes)
      : documentChanges !== undefined
        ? parseDocumentChanges(documentChanges)
        : [];
  assertRenameLimits(candidates);
  return candidates;
}

export function canonicalLspRenameEdits(
  edits: LspRenameEdit[],
): LspRenameEdit[] {
  const sorted = edits.slice().sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) return pathOrder;
    const startOrder = comparePosition(
      { line: left.startLine, character: left.startCharacter },
      { line: right.startLine, character: right.startCharacter },
    );
    if (startOrder !== 0) return startOrder;
    const endOrder = comparePosition(
      { line: left.endLine, character: left.endCharacter },
      { line: right.endLine, character: right.endCharacter },
    );
    if (endOrder !== 0) return endOrder;
    return left.newText.localeCompare(right.newText);
  });
  let previous: LspRenameEdit | undefined;
  for (const edit of sorted) {
    if (
      previous?.path === edit.path &&
      (previous.fileSha256 !== edit.fileSha256 ||
        comparePosition(
          { line: previous.endLine, character: previous.endCharacter },
          { line: edit.startLine, character: edit.startCharacter },
        ) > 0 ||
        (previous.startLine === edit.startLine &&
          previous.startCharacter === edit.startCharacter))
    ) {
      throw new Error("LSP rename returned overlapping or drifting edits");
    }
    previous = edit;
  }
  return sorted;
}

export function lspRenameFiles(edits: LspRenameEdit[]): LspRenameFile[] {
  const files = new Map<string, LspRenameFile>();
  for (const edit of edits) {
    const current = files.get(edit.path);
    if (current) {
      current.edits.push(edit);
    } else {
      files.set(edit.path, {
        path: edit.path,
        pathSha256: edit.pathSha256,
        fileSha256: edit.fileSha256,
        edits: [edit],
      });
    }
  }
  return [...files.values()];
}

export function lspRenameEditReceipt(edit: LspRenameEdit): unknown {
  return {
    pathSha256: edit.pathSha256,
    fileSha256: edit.fileSha256,
    rangeSha256: edit.rangeSha256,
    oldTextSha256: edit.oldTextSha256,
    newTextSha256: edit.newTextSha256,
  };
}

export function assertLspRenamePreviewBytes(edits: LspRenameEdit[]): number {
  const previewBytes = edits.reduce(
    (total, edit) =>
      total +
      Buffer.byteLength(edit.oldText, "utf8") +
      Buffer.byteLength(edit.newText, "utf8"),
    0,
  );
  if (previewBytes > MAX_LSP_RENAME_PREVIEW_BYTES) {
    throw new Error(
      `LSP rename preview exceeds ${MAX_LSP_RENAME_PREVIEW_BYTES} UTF-8 bytes`,
    );
  }
  return previewBytes;
}

function parseChanges(value: unknown): LspRenameCandidate[] {
  if (!record(value)) {
    throw new Error("LSP rename changes must be an object");
  }
  return Object.entries(value).flatMap(([uri, edits]) =>
    parseTextEdits(uri, edits),
  );
}

function parseDocumentChanges(value: unknown): LspRenameCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("LSP rename documentChanges must be an array");
  }
  return value.flatMap((change, index) => {
    if (
      !record(change) ||
      typeof change["kind"] === "string" ||
      !record(change["textDocument"]) ||
      typeof change["textDocument"]["uri"] !== "string" ||
      !hasOnlyKeys(change, ["textDocument", "edits"]) ||
      !hasOnlyKeys(change["textDocument"], ["uri", "version"])
    ) {
      throw new Error(
        `LSP rename document change ${index + 1} is not a text edit`,
      );
    }
    const version = change["textDocument"]["version"];
    if (
      version !== undefined &&
      version !== null &&
      !Number.isSafeInteger(version)
    ) {
      throw new Error(
        `LSP rename document change ${index + 1} has an invalid version`,
      );
    }
    return parseTextEdits(change["textDocument"]["uri"], change["edits"]);
  });
}

function parseTextEdits(uri: string, value: unknown): LspRenameCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("LSP rename text edits must be an array");
  }
  return value.map((edit, index) => {
    if (record(edit) && edit["annotationId"] !== undefined) {
      throw new Error("LSP rename annotated edits are not supported");
    }
    if (
      !record(edit) ||
      !hasOnlyKeys(edit, ["range", "newText"]) ||
      typeof edit["newText"] !== "string" ||
      edit["newText"].length > MAX_LSP_RENAME_REPLACEMENT_CHARS ||
      edit["newText"].includes("\u0000")
    ) {
      throw new Error(`LSP rename text edit ${index + 1} is malformed`);
    }
    const range = parseLspRange(edit["range"]);
    if (!range || samePosition(range.start, range.end)) {
      throw new Error(`LSP rename text edit ${index + 1} has an invalid range`);
    }
    return { uri, range, newText: edit["newText"] };
  });
}

function assertRenameLimits(candidates: LspRenameCandidate[]): void {
  if (candidates.length > MAX_LSP_RENAME_EDITS) {
    throw new Error(
      `LSP rename returned more than ${MAX_LSP_RENAME_EDITS} edits`,
    );
  }
  if (
    new Set(candidates.map((candidate) => candidate.uri)).size >
    MAX_LSP_RENAME_FILES
  ) {
    throw new Error(
      `LSP rename returned more than ${MAX_LSP_RENAME_FILES} files`,
    );
  }
}

function comparePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}

function samePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): boolean {
  return left.line === right.line && left.character === right.character;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return (
    record(value) && Object.keys(value).every((key) => allowed.includes(key))
  );
}
