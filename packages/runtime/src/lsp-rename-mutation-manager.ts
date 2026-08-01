import type {
  LspRenameApplyDetails,
  LspRenameDetails,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  LspRenameApplyDiagnostics,
  type LspRenameDiagnosticsObservation,
  type LspRenameDiagnosticsState,
  unavailableLspRenameDiagnostics,
} from "./lsp-rename-apply-diagnostics.js";
import {
  commitLspRename,
  type CommitLspRenameOptions,
} from "./lsp-rename-commit.js";
import type { LspRenameResult } from "./lsp-rename.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import {
  formatLspWorkspaceEditApplySummary,
  LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS,
  LspWorkspaceEditMutationCoordinator,
  MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS,
  type LspWorkspaceEditPreviewSource,
} from "./lsp-workspace-edit-mutation.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

export const MAX_LSP_RENAME_APPLY_PREVIEWS =
  MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS;
export const LSP_RENAME_APPLY_PREVIEW_TTL_MS =
  LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS;

export interface LspRenameApplyPreview {
  id: string;
  expiresAt: string;
  result: LspRenameResult;
}

export interface LspRenameApplyResult {
  details: LspRenameApplyDetails;
  summary: string;
}

export interface LspRenameMutationManagerOptions {
  workspaceRoot: string;
  dataRoot: string;
  diagnostics: Pick<
    LspRenameApplyDiagnostics,
    "observeBefore" | "observeAfter"
  >;
  tests?: Pick<WriteLinkedTestVerificationRunner, "captureBefore" | "run">;
  now?: () => Date;
  commit?: typeof commitLspRename;
  commitOptions?: Pick<CommitLspRenameOptions, "renameFile" | "linkFile">;
  authorizeFiles?: (files: LspRenameFile[]) => boolean;
}

interface LspRenamePreviewSource extends LspWorkspaceEditPreviewSource {
  relativePath: string;
  details: LspRenameDetails;
  files: LspRenameFile[];
}

export class LspRenameMutationManager {
  private readonly authorizeFiles:
    | ((files: LspRenameFile[]) => boolean)
    | undefined;
  private readonly coordinator: LspWorkspaceEditMutationCoordinator<
    LspRenamePreviewSource,
    LspRenameDiagnosticsState,
    LspRenameDiagnosticsObservation
  >;

  constructor(options: LspRenameMutationManagerOptions) {
    this.authorizeFiles = options.authorizeFiles;
    this.coordinator = new LspWorkspaceEditMutationCoordinator({
      workspaceRoot: options.workspaceRoot,
      dataRoot: options.dataRoot,
      label: "LSP rename apply",
      previewPrefix: "renamepreview",
      diagnostics: {
        observeBefore: (files, signal) =>
          options.diagnostics.observeBefore(files, signal),
        observeAfter: (state, expectedFiles, signal) =>
          options.diagnostics.observeAfter(state, expectedFiles, signal),
        unavailable: unavailableLspRenameDiagnostics,
      },
      ...(options.tests ? { tests: options.tests } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.commit ? { commit: options.commit } : {}),
      ...(options.commitOptions
        ? { commitOptions: options.commitOptions }
        : {}),
    });
  }

  storePreview(result: LspRenameResult): LspRenameApplyPreview | undefined {
    if (result.details.status !== "found" || result.files.length === 0) {
      return undefined;
    }
    if (this.authorizeFiles && !this.authorizeFiles(result.files)) {
      throw new Error("LSP rename apply targets are not authorized");
    }
    const preview = this.coordinator.storePreview({
      sourcePreviewResultSha256: result.details.resultSha256,
      relativePath: result.relativePath,
      details: result.details,
      files: result.files,
    });
    return preview
      ? {
          id: preview.id,
          expiresAt: preview.expiresAt,
          result: sourceResult(preview.source),
        }
      : undefined;
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<LspRenameApplyResult> {
    const execution = await this.coordinator.apply(previewId, signal);
    const {
      expectedFiles: _expectedFiles,
      addedFileCount: _addedFileCount,
      modifiedFileCount: _modifiedFileCount,
      deletedFileCount: _deletedFileCount,
      ...durableOutcome
    } = execution.outcome;
    const base = {
      kind: "napier.lsp-rename-apply" as const,
      schemaVersion: 1 as const,
      ...durableOutcome,
      ...(execution.diagnostics
        ? { diagnostics: execution.diagnostics.details }
        : {}),
      ...(execution.tests ? { tests: execution.tests.details } : {}),
    };
    const details: LspRenameApplyDetails = {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    };
    return {
      details,
      summary: formatLspWorkspaceEditApplySummary({
        label: "LSP rename apply",
        details,
        ...(execution.diagnostics
          ? { diagnosticsSummary: execution.diagnostics.summary }
          : {}),
        ...(execution.tests ? { testsSummary: execution.tests.summary } : {}),
        appliedMessage:
          "The coordinated rename is committed. Run relevant behavior verification before claiming completion.",
        rolledBackMessage:
          "The coordinated commit failed and the original file set was restored. Preview again before retrying.",
        indeterminateMessage:
          "Workspace state is indeterminate. Inspect every target before any retry.",
      }),
    };
  }
}

function sourceResult(source: LspRenamePreviewSource): LspRenameResult {
  return {
    relativePath: source.relativePath,
    details: structuredClone(source.details),
    files: structuredClone(source.files),
  };
}
