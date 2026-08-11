import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MessageConnection } from "vscode-jsonrpc/node.js";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_LSP_LOCATION_PREVIEW_CHARS = 1_000;

export interface LspSourcePosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LspLocationCandidate {
  uri: string;
  range: LspRange;
}

export interface LspWorkspaceLocationOptions {
  allowLineBreakInsertion?: boolean;
  toHostUri?: (uri: string) => string | undefined;
}

export interface LspWorkspaceLocation {
  path: string;
  pathSha256: string;
  fileSha256: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  rangeSha256: string;
  preview: string;
  previewSha256: string;
  previewTruncated?: true;
}

export interface LspLocationReceipt {
  pathSha256: string;
  fileSha256: string;
  rangeSha256: string;
  previewSha256: string;
}

export interface LspTargetFileReceipt {
  pathSha256: string;
  fileSha256: string;
}

export function waitForLspTargetReady(
  connection: MessageConnection,
  targetUri: string,
): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: unknown) => {
        if (!record(params) || params["uri"] !== targetUri) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(resolve, 100);
      },
    );
  });
}

export function validateLspPositionShape(
  position: LspSourcePosition,
  label: string,
): void {
  if (
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.character) ||
    position.line < 1 ||
    position.character < 1
  ) {
    throw new Error(
      `${label} line and character must be positive 1-based integers`,
    );
  }
}

export function validateLspSourcePosition(
  source: string,
  position: LspSourcePosition,
  label: string,
): void {
  const lines = source.split("\n");
  const selected = lines[position.line - 1];
  if (selected === undefined || position.character > selected.length + 1) {
    throw new Error(`${label} position is outside the source file`);
  }
}

export function parseLspLocationResponse(
  value: unknown,
  label: string,
  options: { allowLocationLinks: boolean; requireArray?: boolean },
): LspLocationCandidate[] {
  if (value === null || value === undefined) return [];
  if (options.requireArray && !Array.isArray(value)) {
    throw new Error(`${label} response must be an array or null`);
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((candidate, index) => {
    if (!record(candidate)) {
      throw new Error(`${label} result ${index + 1} is malformed`);
    }
    const uri =
      options.allowLocationLinks && typeof candidate["targetUri"] === "string"
        ? candidate["targetUri"]
        : typeof candidate["uri"] === "string"
          ? candidate["uri"]
          : undefined;
    const range = parseLspRange(
      options.allowLocationLinks
        ? (candidate["targetSelectionRange"] ??
            candidate["targetRange"] ??
            candidate["range"])
        : candidate["range"],
    );
    if (!uri || !range) {
      throw new Error(`${label} result ${index + 1} is malformed`);
    }
    return { uri, range };
  });
}

export async function workspaceLspLocation(
  workspaceRoot: string,
  candidate: LspLocationCandidate,
  label: string,
  options: LspWorkspaceLocationOptions = {},
): Promise<LspWorkspaceLocation | undefined> {
  let lexical: string;
  try {
    const hostUri = options.toHostUri
      ? options.toHostUri(candidate.uri)
      : candidate.uri;
    if (!hostUri) return undefined;
    const url = new URL(hostUri);
    if (url.protocol !== "file:") return undefined;
    lexical = path.resolve(fileURLToPath(url));
  } catch {
    return undefined;
  }
  let target: string;
  try {
    target = await realpath(lexical);
  } catch {
    return undefined;
  }
  if (target !== lexical || !isPathInside(target, workspaceRoot)) {
    return undefined;
  }
  const relativePath = path.relative(workspaceRoot, target);
  if (
    relativePath
      .split(path.sep)
      .filter(Boolean)
      .some(isProtectedWorkspacePathSegment)
  ) {
    return undefined;
  }
  let buffer: Buffer;
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
      return undefined;
    }
    buffer = await readFile(target);
  } catch {
    return undefined;
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
  const normalizedRange = normalizeLineBreakInsertion(
    source,
    candidate.range,
    options.allowLineBreakInsertion === true,
  );
  const preview = rangePreview(source, normalizedRange);
  if (!preview) {
    throw new Error(`${label} returned an out-of-range workspace target`);
  }
  const range = {
    startLine: normalizedRange.start.line + 1,
    startCharacter: normalizedRange.start.character + 1,
    endLine: normalizedRange.end.line + 1,
    endCharacter: normalizedRange.end.character + 1,
  };
  return {
    path: relativePath,
    pathSha256: sha256(relativePath),
    fileSha256: sha256(buffer),
    ...range,
    rangeSha256: sha256(canonicalJson(range)),
    preview: preview.text,
    previewSha256: sha256(preview.text),
    ...(preview.truncated ? { previewTruncated: true as const } : {}),
  };
}

export function canonicalLspLocations(
  locations: LspWorkspaceLocation[],
): LspWorkspaceLocation[] {
  return [
    ...new Map(
      locations.map((location) => [
        `${location.pathSha256}:${location.fileSha256}:${location.rangeSha256}`,
        location,
      ]),
    ).values(),
  ].sort((left, right) =>
    canonicalJson(lspLocationReceipt(left)).localeCompare(
      canonicalJson(lspLocationReceipt(right)),
    ),
  );
}

export function lspLocationReceipt(
  location: LspWorkspaceLocation,
): LspLocationReceipt {
  return {
    pathSha256: location.pathSha256,
    fileSha256: location.fileSha256,
    rangeSha256: location.rangeSha256,
    previewSha256: location.previewSha256,
  };
}

export function lspTargetFileReceipts(
  receipts: LspLocationReceipt[],
): LspTargetFileReceipt[] {
  return [
    ...new Map(
      receipts.map((receipt) => [
        `${receipt.pathSha256}:${receipt.fileSha256}`,
        {
          pathSha256: receipt.pathSha256,
          fileSha256: receipt.fileSha256,
        },
      ]),
    ).values(),
  ].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}

export function parseLspRange(value: unknown): LspRange | undefined {
  if (!record(value)) return undefined;
  const start = record(value["start"]) ? value["start"] : undefined;
  const end = record(value["end"]) ? value["end"] : undefined;
  if (
    !start ||
    !end ||
    !nonNegativeInteger(start["line"]) ||
    !nonNegativeInteger(start["character"]) ||
    !nonNegativeInteger(end["line"]) ||
    !nonNegativeInteger(end["character"]) ||
    Number(end["line"]) < Number(start["line"]) ||
    (end["line"] === start["line"] &&
      Number(end["character"]) < Number(start["character"]))
  ) {
    return undefined;
  }
  return {
    start: {
      line: Number(start["line"]),
      character: Number(start["character"]),
    },
    end: {
      line: Number(end["line"]),
      character: Number(end["character"]),
    },
  };
}

export function lspRangeText(
  source: string,
  range: LspRange,
): string | undefined {
  const lines = source.split("\n");
  const startLine = lines[range.start.line];
  const endLine = lines[range.end.line];
  if (
    startLine === undefined ||
    endLine === undefined ||
    range.start.character > lspLineLength(startLine) ||
    range.end.character > lspLineLength(endLine)
  ) {
    return undefined;
  }
  return range.start.line === range.end.line
    ? startLine.slice(range.start.character, range.end.character)
    : [
        startLine.slice(range.start.character),
        ...lines.slice(range.start.line + 1, range.end.line),
        endLine.slice(0, range.end.character),
      ].join("\n");
}

function rangePreview(
  source: string,
  range: LspRange,
): { text: string; truncated: boolean } | undefined {
  const selected = lspRangeText(source, range);
  if (selected === undefined) return undefined;
  return {
    text: selected.slice(0, MAX_LSP_LOCATION_PREVIEW_CHARS),
    truncated: selected.length > MAX_LSP_LOCATION_PREVIEW_CHARS,
  };
}

function normalizeLineBreakInsertion(
  source: string,
  range: LspRange,
  allowed: boolean,
): LspRange {
  if (
    !allowed ||
    range.start.line !== range.end.line ||
    range.start.character !== range.end.character
  ) {
    return range;
  }
  const lines = source.split("\n");
  const line = lines[range.start.line];
  if (
    line === undefined ||
    range.start.line >= lines.length - 1 ||
    range.start.character !== lspLineLength(line) + 1
  ) {
    return range;
  }
  const position = { line: range.start.line + 1, character: 0 };
  return { start: position, end: position };
}

function lspLineLength(line: string): number {
  return line.endsWith("\r") ? line.length - 1 : line.length;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
