import type { LspDiagnosticsDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { lspProviderRuntimeLimitEvidence } from "./lsp-runtime-assets.js";
import {
  type LspDiagnostic,
  LSP_DIAGNOSTICS_QUIET_MS,
  lspSessionEvidence,
  MAX_LSP_DIAGNOSTICS,
  MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  prepareLspDiagnosticsOperation,
} from "./lsp-protocol-session.js";
import {
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  type LspDiagnosticsRunnerOptions,
  type LspSourceRequest,
  runBoundLspSourceSession,
} from "./lsp-source-session.js";

export {
  type LspDiagnostic,
  LSP_DIAGNOSTICS_QUIET_MS,
  MAX_LSP_DIAGNOSTICS,
  MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
} from "./lsp-protocol-session.js";
export {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  MAX_LSP_DIAGNOSTICS_TIMEOUT_MS,
  type LspDiagnosticsRunnerOptions,
  type LspRuntimeAssets,
  type PreparedLspSource,
  LspDiagnosticsTargetDriftError,
  lspDiagnosticLanguageForPath,
  runBoundLspSourceSession,
} from "./lsp-source-session.js";

export type LspDiagnosticsRequest = LspSourceRequest;

export interface LspDiagnosticsResult {
  details: LspDiagnosticsDetails;
  diagnostics: LspDiagnostic[];
  relativePath: string;
}

export class LspDiagnosticsRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspDiagnosticsRequest): Promise<LspDiagnosticsResult> {
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP diagnostics",
        abortedMessage: "LSP diagnostics were aborted",
      },
      prepareLspDiagnosticsOperation,
    );
    const { prepared, execution, durationMs } = bound;
    const diagnostics = execution.value.diagnostics;
    const codeSet = [
      ...new Set(
        diagnostics
          .map((diagnostic) => diagnostic.code)
          .filter((code): code is string => Boolean(code)),
      ),
    ].sort();
    const counts = countSeverities(diagnostics);
    const diagnosticSetSha256 = sha256(canonicalJson(diagnostics));
    const base = {
      kind: "napier.lsp-diagnostics" as const,
      schemaVersion: 1 as const,
      status:
        diagnostics.length === 0
          ? ("clean" as const)
          : ("diagnostics" as const),
      language: prepared.language,
      sandbox: this.options.sandbox.id,
      workspaceAccess: "read_only" as const,
      networkAccess: "denied" as const,
      workspaceRootSha256: sha256(prepared.workspaceRoot),
      pathSha256: sha256(prepared.relativePath),
      fileSha256: prepared.fileSha256,
      fileBytes: prepared.fileBytes,
      diagnosticCount: diagnostics.length,
      ...counts,
      truncated: execution.value.truncated,
      diagnosticSetSha256,
      codeSetSha256: sha256(canonicalJson(codeSet)),
      nodeExecutableSha256: prepared.assets.nodeExecutableSha256,
      languageServerVersion: prepared.assets.languageServerVersion,
      languageServerSha256: prepared.assets.languageServerSha256,
      typescriptVersion: prepared.assets.typescriptVersion,
      typescriptServerSha256: prepared.assets.typescriptServerSha256,
      environmentSha256: sha256(canonicalJson(LSP_FIXED_ENVIRONMENT)),
      resourceLimitsSha256: sha256(
        canonicalJson({
          ...lspProviderRuntimeLimitEvidence(prepared.assets),
          timeoutMs: prepared.timeoutMs,
          maxFileBytes: MAX_LSP_DIAGNOSTIC_FILE_BYTES,
          maxDiagnostics: MAX_LSP_DIAGNOSTICS,
          maxDiagnosticMessageChars: MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS,
          diagnosticsQuietMs: LSP_DIAGNOSTICS_QUIET_MS,
          maxProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
          maxStderrChars: MAX_LSP_STDERR_CHARS,
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
      diagnostics,
      relativePath: prepared.relativePath,
    };
  }
}

function countSeverities(diagnostics: LspDiagnostic[]): {
  errorCount: number;
  warningCount: number;
  informationCount: number;
  hintCount: number;
} {
  return {
    errorCount: diagnostics.filter((item) => item.severity === 1).length,
    warningCount: diagnostics.filter((item) => item.severity === 2).length,
    informationCount: diagnostics.filter((item) => item.severity === 3).length,
    hintCount: diagnostics.filter((item) => item.severity === 4).length,
  };
}
