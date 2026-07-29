import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LspDefinitionDetails } from "@napier/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node.js";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  type LspDiagnosticsRunnerOptions,
  runBoundLspSourceSession,
} from "./lsp-diagnostics.js";
import {
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  runLspProtocolSession,
} from "./lsp-protocol-session.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_LSP_DEFINITIONS = 32;
export const MAX_LSP_DEFINITION_PREVIEW_CHARS = 1_000;

export interface LspDefinitionRequest {
  path: string;
  line: number;
  character: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspDefinitionLocation {
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
}

export interface LspDefinitionResult {
  details: LspDefinitionDetails;
  locations: LspDefinitionLocation[];
  relativePath: string;
}

interface DefinitionCandidate {
  uri: string;
  range: LspRange;
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface DefinitionReceipt {
  pathSha256: string;
  fileSha256: string;
  rangeSha256: string;
  previewSha256: string;
}

export class LspDefinitionRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspDefinitionRequest): Promise<LspDefinitionResult> {
    validatePositionShape(request);
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP definition",
        abortedMessage: "LSP definition was aborted",
      },
      (child, protocolRequest, signal) =>
        runLspProtocolSession(
          child,
          protocolRequest,
          (connection, targetUri) => {
            const ready = targetDiagnosticsPublished(connection, targetUri);
            return async () => {
              await ready;
              return connection.sendRequest("textDocument/definition", {
                textDocument: { uri: targetUri },
                position: {
                  line: request.line - 1,
                  character: request.character - 1,
                },
              });
            };
          },
          signal,
        ),
      (prepared) =>
        validateSourcePosition(
          prepared.source,
          request.line,
          request.character,
        ),
    );
    const { prepared, execution, durationMs } = bound;
    const candidates = parseDefinitionResponse(execution.value);
    const truncated = candidates.length > MAX_LSP_DEFINITIONS;
    const selected = candidates.slice(0, MAX_LSP_DEFINITIONS);
    const locations: LspDefinitionLocation[] = [];
    let omittedDefinitionCount = candidates.length - selected.length;
    for (const candidate of selected) {
      const location = await workspaceDefinitionLocation(
        prepared.workspaceRoot,
        candidate,
      );
      if (!location) {
        omittedDefinitionCount += 1;
        continue;
      }
      locations.push(location);
    }
    const distinct = distinctLocations(locations).sort((left, right) =>
      canonicalJson(definitionReceipt(left)).localeCompare(
        canonicalJson(definitionReceipt(right)),
      ),
    );
    const receipts: DefinitionReceipt[] = distinct.map(definitionReceipt);
    const targetFiles = [
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
    const base = {
      kind: "napier.lsp-definition" as const,
      schemaVersion: 1 as const,
      status: distinct.length > 0 ? ("found" as const) : ("not_found" as const),
      language: prepared.language,
      sandbox: this.options.sandbox.id,
      workspaceAccess: "read_only" as const,
      networkAccess: "denied" as const,
      workspaceRootSha256: sha256(prepared.workspaceRoot),
      sourcePathSha256: sha256(prepared.relativePath),
      sourceFileSha256: prepared.fileSha256,
      sourceFileBytes: prepared.fileBytes,
      positionSha256: sha256(
        canonicalJson({ line: request.line, character: request.character }),
      ),
      definitionCount: distinct.length,
      omittedDefinitionCount,
      truncated,
      definitionSetSha256: sha256(canonicalJson(receipts)),
      targetFileSetSha256: sha256(canonicalJson(targetFiles)),
      nodeExecutableSha256: prepared.assets.nodeExecutableSha256,
      languageServerVersion: prepared.assets.languageServerVersion,
      languageServerSha256: prepared.assets.languageServerSha256,
      typescriptVersion: prepared.assets.typescriptVersion,
      typescriptServerSha256: prepared.assets.typescriptServerSha256,
      environmentSha256: sha256(canonicalJson(LSP_FIXED_ENVIRONMENT)),
      resourceLimitsSha256: sha256(
        canonicalJson({
          timeoutMs: request.timeoutMs ?? DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
          maxSourceFileBytes: MAX_LSP_DIAGNOSTIC_FILE_BYTES,
          maxTargetFileBytes: MAX_LSP_DIAGNOSTIC_FILE_BYTES,
          maxDefinitions: MAX_LSP_DEFINITIONS,
          maxPreviewChars: MAX_LSP_DEFINITION_PREVIEW_CHARS,
          maxProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
          maxStderrChars: MAX_LSP_STDERR_CHARS,
          workspaceConfined: true,
          processGroupTermination: true,
        }),
      ),
      timeoutMs: prepared.timeoutMs,
      durationMs,
      protocolBytes: execution.protocolBytes,
      stderrChars: execution.stderr.length,
      stderrSha256: sha256(execution.stderr),
      stderrTruncated: execution.stderrTruncated,
    };
    return {
      details: {
        ...base,
        resultSha256: sha256(canonicalJson(base)),
      },
      locations: distinct,
      relativePath: prepared.relativePath,
    };
  }
}

function targetDiagnosticsPublished(
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

function validatePositionShape(request: LspDefinitionRequest): void {
  if (
    !Number.isSafeInteger(request.line) ||
    !Number.isSafeInteger(request.character) ||
    request.line < 1 ||
    request.character < 1
  ) {
    throw new Error(
      "LSP definition line and character must be positive 1-based integers",
    );
  }
}

function validateSourcePosition(
  source: string,
  line: number,
  character: number,
): void {
  const lines = source.split("\n");
  const selected = lines[line - 1];
  if (selected === undefined || character > selected.length + 1) {
    throw new Error("LSP definition position is outside the source file");
  }
}

function parseDefinitionResponse(value: unknown): DefinitionCandidate[] {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((candidate, index) => {
    if (!record(candidate)) {
      throw new Error(`LSP definition result ${index + 1} is malformed`);
    }
    const uri =
      typeof candidate["targetUri"] === "string"
        ? candidate["targetUri"]
        : typeof candidate["uri"] === "string"
          ? candidate["uri"]
          : undefined;
    const range = parseRange(
      candidate["targetSelectionRange"] ??
        candidate["targetRange"] ??
        candidate["range"],
    );
    if (!uri || !range) {
      throw new Error(`LSP definition result ${index + 1} is malformed`);
    }
    return { uri, range };
  });
}

function parseRange(value: unknown): LspRange | undefined {
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

async function workspaceDefinitionLocation(
  workspaceRoot: string,
  candidate: DefinitionCandidate,
): Promise<LspDefinitionLocation | undefined> {
  let lexical: string;
  try {
    const url = new URL(candidate.uri);
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
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    return undefined;
  }
  const buffer = await readFile(target);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
  const preview = rangePreview(source, candidate.range);
  if (preview === undefined) {
    throw new Error("LSP definition returned an out-of-range workspace target");
  }
  const range = {
    startLine: candidate.range.start.line + 1,
    startCharacter: candidate.range.start.character + 1,
    endLine: candidate.range.end.line + 1,
    endCharacter: candidate.range.end.character + 1,
  };
  return {
    path: relativePath,
    pathSha256: sha256(relativePath),
    fileSha256: sha256(buffer),
    ...range,
    rangeSha256: sha256(canonicalJson(range)),
    preview,
    previewSha256: sha256(preview),
  };
}

function rangePreview(source: string, range: LspRange): string | undefined {
  const lines = source.split("\n");
  const startLine = lines[range.start.line];
  const endLine = lines[range.end.line];
  if (
    startLine === undefined ||
    endLine === undefined ||
    range.start.character > startLine.length ||
    range.end.character > endLine.length
  ) {
    return undefined;
  }
  const selected =
    range.start.line === range.end.line
      ? startLine.slice(range.start.character, range.end.character)
      : [
          startLine.slice(range.start.character),
          ...lines.slice(range.start.line + 1, range.end.line),
          endLine.slice(0, range.end.character),
        ].join("\n");
  return selected.slice(0, MAX_LSP_DEFINITION_PREVIEW_CHARS);
}

function distinctLocations(
  locations: LspDefinitionLocation[],
): LspDefinitionLocation[] {
  return [
    ...new Map(
      locations.map((location) => [
        `${location.pathSha256}:${location.fileSha256}:${location.rangeSha256}`,
        location,
      ]),
    ).values(),
  ];
}

function definitionReceipt(location: LspDefinitionLocation): DefinitionReceipt {
  return {
    pathSha256: location.pathSha256,
    fileSha256: location.fileSha256,
    rangeSha256: location.rangeSha256,
    previewSha256: location.previewSha256,
  };
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
