import type { LspCodeActionsDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_FIXED_ENVIRONMENT,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  type LspDiagnosticsRunnerOptions,
  runBoundLspSourceSession,
} from "./lsp-diagnostics.js";
import {
  MAX_LSP_CODE_ACTIONS,
  MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS,
  MAX_LSP_CODE_ACTION_TITLE_CHARS,
  parseLspCodeActionResponse,
} from "./lsp-code-action-parser.js";
import {
  MAX_LSP_CODE_ACTION_DIAGNOSTICS,
  parseCodeActionDiagnostics,
  prepareLspCodeActionOperation,
} from "./lsp-code-action-diagnostics.js";
import {
  materializeLspCodeActions,
  type LspCodeAction,
} from "./lsp-code-action-edits.js";
import {
  validateLspPositionShape,
  validateLspSourcePosition,
} from "./lsp-locations.js";
import {
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  runLspProtocolSession,
} from "./lsp-protocol-session.js";
import {
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_PREVIEW_BYTES,
  MAX_LSP_RENAME_REPLACEMENT_CHARS,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
} from "./lsp-rename-workspace-edit.js";

export { MAX_LSP_CODE_ACTION_DIAGNOSTICS } from "./lsp-code-action-diagnostics.js";
export type { LspCodeAction } from "./lsp-code-action-edits.js";

export interface LspCodeActionsRequest {
  path: string;
  line: number;
  character: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspCodeActionsResult {
  details: LspCodeActionsDetails;
  actions: LspCodeAction[];
  relativePath: string;
}

export class LspCodeActionsRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspCodeActionsRequest): Promise<LspCodeActionsResult> {
    validateLspPositionShape(request, "LSP code action");
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP code action",
        abortedMessage: "LSP code action was aborted",
      },
      (child, protocolRequest, signal) =>
        runLspProtocolSession(
          child,
          protocolRequest,
          prepareLspCodeActionOperation(request),
          signal,
        ),
      (prepared) =>
        validateLspSourcePosition(prepared.source, request, "LSP code action"),
    );
    const { prepared, execution, durationMs } = bound;
    const diagnostics = parseCodeActionDiagnostics(execution.value.diagnostics);
    const parsed = parseLspCodeActionResponse(execution.value.actions);
    const { actions, allEdits, targetFiles, previewBytes, actionReceipts } =
      await materializeLspCodeActions(
        {
          workspaceRoot: prepared.workspaceRoot,
          sourcePath: prepared.relativePath,
          sourcePathSha256: sha256(prepared.relativePath),
          sourceFileSha256: prepared.fileSha256,
          ...(request.signal ? { signal: request.signal } : {}),
        },
        parsed.actions,
      );
    const diagnosticReceipts = diagnostics
      .map((diagnostic) => diagnostic.receipt)
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
    const preferredActionCount = actions.filter(
      (action) => action.isPreferred,
    ).length;
    const commandIgnoredCount = actions.filter(
      (action) => action.commandIgnored,
    ).length;
    const complete =
      parsed.omittedActionCount === 0 && parsed.truncated === false;
    const base = {
      kind: "napier.lsp-code-actions" as const,
      schemaVersion: 1 as const,
      status: actions.length > 0 ? ("found" as const) : ("not_found" as const),
      complete,
      truncated: parsed.truncated,
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
      diagnosticCount: diagnostics.length,
      actionCount: actions.length,
      omittedActionCount: parsed.omittedActionCount,
      preferredActionCount,
      commandIgnoredCount,
      fileCount: targetFiles.length,
      editCount: allEdits.length,
      previewBytes,
      diagnosticSetSha256: sha256(canonicalJson(diagnosticReceipts)),
      actionSetSha256: sha256(canonicalJson(actionReceipts)),
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
          maxDiagnostics: MAX_LSP_CODE_ACTION_DIAGNOSTICS,
          maxResponseActions: MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS,
          maxActions: MAX_LSP_CODE_ACTIONS,
          maxTitleChars: MAX_LSP_CODE_ACTION_TITLE_CHARS,
          maxFiles: MAX_LSP_RENAME_FILES,
          maxEdits: MAX_LSP_RENAME_EDITS,
          maxReplacementChars: MAX_LSP_RENAME_REPLACEMENT_CHARS,
          maxPreviewBytes: MAX_LSP_RENAME_PREVIEW_BYTES,
          maxToolOutputBytes: MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
          maxProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
          maxStderrChars: MAX_LSP_STDERR_CHARS,
          materializationConcurrency: 1,
          sourceDocumentVersion: 1,
          targetHashRevalidation: true,
          workspaceEditPreference: "documentChanges",
          quickFixOnly: true,
          codeActionResolve: false,
          commandsExecuted: false,
          workspaceApplyEdit: false,
          resourceOperations: false,
          annotatedEdits: false,
          lineBreakInsertionNormalization: true,
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
      actions,
      relativePath: prepared.relativePath,
    };
  }
}
