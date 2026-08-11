import type { LspSymbolsDetails } from "@napier/contracts";

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
  DEFAULT_LSP_SYMBOLS,
  lspDocumentSymbolReceipt,
  MAX_LSP_SYMBOL_CONTAINER_CHARS,
  MAX_LSP_SYMBOL_DEPTH,
  MAX_LSP_SYMBOL_DETAIL_CHARS,
  MAX_LSP_SYMBOL_DISPLAY_BYTES,
  MAX_LSP_SYMBOL_NAME_CHARS,
  MAX_LSP_SYMBOL_RANGE_CHARS,
  MAX_LSP_SYMBOL_RESPONSE_NODES,
  MAX_LSP_SYMBOL_SIGNATURE_CHARS,
  MAX_LSP_SYMBOLS,
  parseLspDocumentSymbols,
  type LspDocumentSymbol,
  validateLspMaxSymbols,
} from "./lsp-symbol-parser.js";
import { waitForLspTargetReady } from "./lsp-locations.js";

export const MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES = 64 * 1024;

export interface LspSymbolsRequest {
  path: string;
  maxSymbols?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspSymbolsResult {
  details: LspSymbolsDetails;
  symbols: LspDocumentSymbol[];
  relativePath: string;
}

export class LspSymbolsRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspSymbolsRequest): Promise<LspSymbolsResult> {
    const maxSymbols = request.maxSymbols ?? DEFAULT_LSP_SYMBOLS;
    validateLspMaxSymbols(maxSymbols);
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP symbols",
        abortedMessage: "LSP symbols were aborted",
      },
      (connection, targetUri) => {
        const ready = waitForLspTargetReady(connection, targetUri);
        return async () => {
          await ready;
          return connection.sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: targetUri },
          });
        };
      },
    );
    const { prepared, execution, durationMs } = bound;
    const parsed = parseLspDocumentSymbols(execution.value, {
      source: prepared.source,
      targetUri: prepared.protocolTargetUri,
      maxSymbols,
    });
    const symbolReceipts = parsed.symbols.map(lspDocumentSymbolReceipt);
    const complete = parsed.omittedSymbolCount === 0 && !parsed.truncated;
    const base = {
      kind: "napier.lsp-symbols" as const,
      schemaVersion: 1 as const,
      status:
        parsed.symbols.length > 0 ? ("found" as const) : ("not_found" as const),
      complete,
      truncated: parsed.truncated,
      responseShape: parsed.responseShape,
      language: prepared.language,
      sandbox: this.options.sandbox.id,
      workspaceAccess: "read_only" as const,
      networkAccess: "denied" as const,
      workspaceRootSha256: sha256(prepared.workspaceRoot),
      sourcePathSha256: sha256(prepared.relativePath),
      sourceFileSha256: prepared.fileSha256,
      sourceFileBytes: prepared.fileBytes,
      responseSymbolCount: parsed.responseSymbolCount,
      symbolCount: parsed.symbols.length,
      omittedSymbolCount: parsed.omittedSymbolCount,
      maxDepth: parsed.maxDepth,
      deprecatedSymbolCount: parsed.deprecatedSymbolCount,
      displayBytes: parsed.displayBytes,
      symbolSetSha256: sha256(canonicalJson(symbolReceipts)),
      kindCountsSha256: sha256(canonicalJson(parsed.kindCounts)),
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
          maxResponseNodes: MAX_LSP_SYMBOL_RESPONSE_NODES,
          maxSymbols,
          absoluteMaxSymbols: MAX_LSP_SYMBOLS,
          maxDepth: MAX_LSP_SYMBOL_DEPTH,
          maxNameChars: MAX_LSP_SYMBOL_NAME_CHARS,
          maxDetailChars: MAX_LSP_SYMBOL_DETAIL_CHARS,
          maxContainerChars: MAX_LSP_SYMBOL_CONTAINER_CHARS,
          maxSignatureChars: MAX_LSP_SYMBOL_SIGNATURE_CHARS,
          maxAggregateRangeChars: MAX_LSP_SYMBOL_RANGE_CHARS,
          maxDisplayBytes: MAX_LSP_SYMBOL_DISPLAY_BYTES,
          maxToolOutputBytes: MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES,
          maxProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
          maxStderrChars: MAX_LSP_STDERR_CHARS,
          hierarchicalDocumentSymbols: true,
          workspaceConfined: true,
          workspaceApplyEdit: false,
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
      symbols: parsed.symbols,
      relativePath: prepared.relativePath,
    };
  }
}
