import type { LspDefinitionDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { lspProviderRuntimeLimitEvidence } from "./lsp-runtime-assets.js";
import {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  type LspDiagnosticsRunnerOptions,
  runBoundLspSourceSession,
} from "./lsp-diagnostics.js";
import {
  lspSessionEvidence,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
} from "./lsp-protocol-session.js";
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

export const MAX_LSP_DEFINITIONS = 32;
export const MAX_LSP_DEFINITION_PREVIEW_CHARS = MAX_LSP_LOCATION_PREVIEW_CHARS;

export interface LspDefinitionRequest {
  path: string;
  line: number;
  character: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type LspDefinitionLocation = LspWorkspaceLocation;

export interface LspDefinitionResult {
  details: LspDefinitionDetails;
  locations: LspDefinitionLocation[];
  relativePath: string;
}

export class LspDefinitionRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspDefinitionRequest): Promise<LspDefinitionResult> {
    validateLspPositionShape(request, "LSP definition");
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP definition",
        abortedMessage: "LSP definition was aborted",
      },
      (connection, targetUri) => {
        const ready = waitForLspTargetReady(connection, targetUri);
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
      (prepared) =>
        validateLspSourcePosition(prepared.source, request, "LSP definition"),
    );
    const { prepared, execution, durationMs } = bound;
    const candidates = parseLspLocationResponse(
      execution.value,
      "LSP definition",
      { allowLocationLinks: true },
    );
    const truncated = candidates.length > MAX_LSP_DEFINITIONS;
    const selected = candidates.slice(0, MAX_LSP_DEFINITIONS);
    const locations: LspDefinitionLocation[] = [];
    let omittedDefinitionCount = candidates.length - selected.length;
    for (const candidate of selected) {
      const location = await workspaceLspLocation(
        prepared.workspaceRoot,
        candidate,
        "LSP definition",
      );
      if (!location) {
        omittedDefinitionCount += 1;
        continue;
      }
      locations.push(location);
    }
    const distinct = canonicalLspLocations(locations);
    const receipts = distinct.map(lspLocationReceipt);
    const targetFiles = lspTargetFileReceipts(receipts);
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
          ...lspProviderRuntimeLimitEvidence(prepared.assets),
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
      ...lspSessionEvidence(execution),
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
