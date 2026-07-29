import type { LspReferencesDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  type LspDiagnosticsRunnerOptions,
  runBoundLspSourceSession,
} from "./lsp-diagnostics.js";
import {
  canonicalLspLocations,
  lspLocationReceipt,
  lspTargetFileReceipts,
  MAX_LSP_LOCATION_PREVIEW_CHARS,
  parseLspLocationResponse,
  type LspWorkspaceLocation,
  validateLspPositionShape,
  validateLspSourcePosition,
  waitForLspTargetReady,
  workspaceLspLocation,
} from "./lsp-locations.js";
import {
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  runLspProtocolSession,
} from "./lsp-protocol-session.js";

export const MAX_LSP_REFERENCES = 64;
export const MAX_LSP_REFERENCE_PREVIEW_CHARS = MAX_LSP_LOCATION_PREVIEW_CHARS;

export interface LspReferencesRequest {
  path: string;
  line: number;
  character: number;
  includeDeclaration?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type LspReferenceLocation = LspWorkspaceLocation;

export interface LspReferencesResult {
  details: LspReferencesDetails;
  locations: LspReferenceLocation[];
  relativePath: string;
}

export class LspReferencesRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspReferencesRequest): Promise<LspReferencesResult> {
    validateLspPositionShape(request, "LSP references");
    if (
      request.includeDeclaration !== undefined &&
      typeof request.includeDeclaration !== "boolean"
    ) {
      throw new Error("LSP references includeDeclaration must be a boolean");
    }
    const includeDeclaration = request.includeDeclaration ?? true;
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP references",
        abortedMessage: "LSP references were aborted",
      },
      (child, protocolRequest, signal) =>
        runLspProtocolSession(
          child,
          protocolRequest,
          (connection, targetUri) => {
            const ready = waitForLspTargetReady(connection, targetUri);
            return async () => {
              await ready;
              return connection.sendRequest("textDocument/references", {
                textDocument: { uri: targetUri },
                position: {
                  line: request.line - 1,
                  character: request.character - 1,
                },
                context: { includeDeclaration },
              });
            };
          },
          signal,
        ),
      (prepared) =>
        validateLspSourcePosition(prepared.source, request, "LSP references"),
    );
    const { prepared, execution, durationMs } = bound;
    const candidates = parseLspLocationResponse(
      execution.value,
      "LSP references",
      { allowLocationLinks: false, requireArray: true },
    );
    const truncated = candidates.length > MAX_LSP_REFERENCES;
    const selected = candidates.slice(0, MAX_LSP_REFERENCES);
    const locations: LspReferenceLocation[] = [];
    let omittedReferenceCount = candidates.length - selected.length;
    for (const candidate of selected) {
      const location = await workspaceLspLocation(
        prepared.workspaceRoot,
        candidate,
        "LSP references",
      );
      if (!location) {
        omittedReferenceCount += 1;
        continue;
      }
      locations.push(location);
    }
    const distinct = canonicalLspLocations(locations);
    const receipts = distinct.map(lspLocationReceipt);
    const targetFiles = lspTargetFileReceipts(receipts);
    const base = {
      kind: "napier.lsp-references" as const,
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
      includeDeclaration,
      referenceCount: distinct.length,
      omittedReferenceCount,
      truncated,
      referenceSetSha256: sha256(canonicalJson(receipts)),
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
          maxReferences: MAX_LSP_REFERENCES,
          maxPreviewChars: MAX_LSP_REFERENCE_PREVIEW_CHARS,
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
