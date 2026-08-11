import type { LspRenameDetails } from "@napier/contracts";

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
  validateLspPositionShape,
  validateLspSourcePosition,
  waitForLspTargetReady,
  workspaceLspLocation,
} from "./lsp-locations.js";
import {
  lspSessionEvidence,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
} from "./lsp-protocol-session.js";
import {
  assertLspRenamePreviewBytes,
  canonicalLspRenameEdits,
  lspRenameEditReceipt,
  lspRenameFiles,
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_NEW_NAME_CHARS,
  MAX_LSP_RENAME_PREVIEW_BYTES,
  MAX_LSP_RENAME_REPLACEMENT_CHARS,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
  parseLspRenameWorkspaceEdit,
  parsePrepareRenameResult,
  prepareRenameReceipt,
  type LspRenameEdit,
  type LspRenameFile,
  validateLspRenameNewName,
} from "./lsp-rename-workspace-edit.js";

export {
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_NEW_NAME_CHARS,
  MAX_LSP_RENAME_PREVIEW_BYTES,
  MAX_LSP_RENAME_REPLACEMENT_CHARS,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
  type LspRenameEdit,
  type LspRenameFile,
} from "./lsp-rename-workspace-edit.js";

interface ProtocolRenameResult {
  prepare: unknown;
  workspaceEdit: unknown;
}

export interface LspRenameRequest {
  path: string;
  line: number;
  character: number;
  newName: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspRenameResult {
  details: LspRenameDetails;
  files: LspRenameFile[];
  relativePath: string;
}

export class LspRenameRunner {
  constructor(private readonly options: LspDiagnosticsRunnerOptions) {}

  async run(request: LspRenameRequest): Promise<LspRenameResult> {
    validateLspPositionShape(request, "LSP rename");
    validateLspRenameNewName(request.newName);
    const bound = await runBoundLspSourceSession(
      this.options,
      request,
      {
        label: "LSP rename",
        abortedMessage: "LSP rename was aborted",
      },
      (connection, targetUri) => {
        const ready = waitForLspTargetReady(connection, targetUri);
        return async (): Promise<ProtocolRenameResult> => {
          await ready;
          const position = {
            line: request.line - 1,
            character: request.character - 1,
          };
          const prepare = await connection.sendRequest(
            "textDocument/prepareRename",
            {
              textDocument: { uri: targetUri },
              position,
            },
          );
          if (prepare === null || prepare === undefined) {
            return { prepare: null, workspaceEdit: null };
          }
          const workspaceEdit = await connection.sendRequest(
            "textDocument/rename",
            {
              textDocument: { uri: targetUri },
              position,
              newName: request.newName,
            },
          );
          return { prepare, workspaceEdit };
        };
      },
      (prepared) =>
        validateLspSourcePosition(prepared.source, request, "LSP rename"),
    );
    const { prepared, execution, durationMs } = bound;
    const prepare = parsePrepareRenameResult(execution.value.prepare);
    if (prepare?.kind === "range") {
      const location = await workspaceLspLocation(
        prepared.workspaceRoot,
        {
          uri: prepared.protocolTargetUri,
          range: prepare.range,
        },
        "LSP rename prepare",
        { toHostUri: prepared.toHostUri },
      );
      if (!location) {
        throw new Error("LSP rename prepare target is unavailable");
      }
    }
    const candidates = prepare
      ? parseLspRenameWorkspaceEdit(execution.value.workspaceEdit)
      : [];
    const edits = await Promise.all(
      candidates.map(async (candidate, index) => {
        const location = await workspaceLspLocation(
          prepared.workspaceRoot,
          candidate,
          "LSP rename",
          { toHostUri: prepared.toHostUri },
        );
        if (!location) {
          throw new Error(
            `LSP rename edit ${index + 1} targets an unsupported or out-of-workspace file`,
          );
        }
        if (location.previewTruncated) {
          throw new Error(
            `LSP rename edit ${index + 1} exceeds the old-text preview limit`,
          );
        }
        return {
          path: location.path,
          pathSha256: location.pathSha256,
          fileSha256: location.fileSha256,
          startLine: location.startLine,
          startCharacter: location.startCharacter,
          endLine: location.endLine,
          endCharacter: location.endCharacter,
          rangeSha256: location.rangeSha256,
          oldText: location.preview,
          oldTextSha256: location.previewSha256,
          newText: candidate.newText,
          newTextSha256: sha256(candidate.newText),
        } satisfies LspRenameEdit;
      }),
    );
    const canonicalEdits = canonicalLspRenameEdits(edits);
    const previewBytes = assertLspRenamePreviewBytes(canonicalEdits);
    const files = lspRenameFiles(canonicalEdits);
    const receipts = canonicalEdits.map(lspRenameEditReceipt);
    const targetFiles = files.map((file) => ({
      pathSha256: file.pathSha256,
      fileSha256: file.fileSha256,
      editCount: file.edits.length,
    }));
    const prepareReceipt = prepareRenameReceipt(prepare);
    const base = {
      kind: "napier.lsp-rename" as const,
      schemaVersion: 1 as const,
      status:
        canonicalEdits.length > 0 ? ("found" as const) : ("not_found" as const),
      complete: true as const,
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
      newNameSha256: sha256(request.newName),
      prepareResultSha256: sha256(canonicalJson(prepareReceipt)),
      fileCount: files.length,
      editCount: canonicalEdits.length,
      previewBytes,
      editSetSha256: sha256(canonicalJson(receipts)),
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
          maxFiles: MAX_LSP_RENAME_FILES,
          maxEdits: MAX_LSP_RENAME_EDITS,
          maxNewNameChars: MAX_LSP_RENAME_NEW_NAME_CHARS,
          maxReplacementChars: MAX_LSP_RENAME_REPLACEMENT_CHARS,
          maxPreviewBytes: MAX_LSP_RENAME_PREVIEW_BYTES,
          maxToolOutputBytes: MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
          maxProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
          maxStderrChars: MAX_LSP_STDERR_CHARS,
          workspaceConfined: true,
          resourceOperations: false,
          annotatedEdits: false,
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
      files,
      relativePath: prepared.relativePath,
    };
  }
}
