import type { LspCodeActionApplyDetails } from "@napier/contracts";

import {
  LspCodeActionApplyDiagnostics,
  type LspCodeActionApplyDiagnosticsObservation,
} from "./lsp-code-action-apply-diagnostics.js";
import type {
  LspCodeAction,
  LspCodeActionsResult,
} from "./lsp-code-actions.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commitLspRename,
  type CommitLspRenameOptions,
} from "./lsp-rename-commit.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import {
  formatLspWorkspaceEditApplySummary,
  LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS,
  LspWorkspaceEditMutationCoordinator,
  MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS,
  type LspWorkspaceEditPreviewSource,
} from "./lsp-workspace-edit-mutation.js";
import type { LspRenameDiagnosticsState } from "./lsp-rename-apply-diagnostics.js";
import { createId } from "./ids.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

export const MAX_LSP_CODE_ACTION_APPLY_PREVIEWS =
  MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS;
export const LSP_CODE_ACTION_APPLY_PREVIEW_TTL_MS =
  LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS;

export interface LspCodeActionApplyPreview {
  id: string;
  expiresAt: string;
  actionIndex: number;
  actionSha256: string;
}

export interface LspCodeActionApplyResult {
  details: LspCodeActionApplyDetails;
  summary: string;
}

export interface LspCodeActionMutationManagerOptions {
  workspaceRoot: string;
  dataRoot: string;
  diagnostics: Pick<
    LspCodeActionApplyDiagnostics,
    "observeBefore" | "observeAfter" | "unavailable"
  >;
  tests?: Pick<WriteLinkedTestVerificationRunner, "captureBefore" | "run">;
  now?: () => Date;
  commit?: typeof commitLspRename;
  commitOptions?: Pick<CommitLspRenameOptions, "renameFile" | "linkFile">;
}

interface LspCodeActionPreviewSource extends LspWorkspaceEditPreviewSource {
  files: LspRenameFile[];
  sourceActionSha256: string;
  sourceResolved: boolean;
  sourceCommandIgnored: boolean;
}

export class LspCodeActionMutationManager {
  private readonly coordinator: LspWorkspaceEditMutationCoordinator<
    LspCodeActionPreviewSource,
    LspRenameDiagnosticsState,
    LspCodeActionApplyDiagnosticsObservation
  >;

  constructor(options: LspCodeActionMutationManagerOptions) {
    this.coordinator = new LspWorkspaceEditMutationCoordinator({
      workspaceRoot: options.workspaceRoot,
      dataRoot: options.dataRoot,
      label: "LSP Code Action apply",
      previewPrefix: "actionpreview",
      diagnostics: options.diagnostics,
      ...(options.tests ? { tests: options.tests } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.commit ? { commit: options.commit } : {}),
      ...(options.commitOptions
        ? { commitOptions: options.commitOptions }
        : {}),
    });
  }

  storePreviews(result: LspCodeActionsResult): LspCodeActionApplyPreview[] {
    if (result.details.status !== "found" || result.actions.length === 0) {
      return [];
    }
    const exclusiveGroupId = createId("actiongroup");
    const previews: LspCodeActionApplyPreview[] = [];
    for (const [actionIndex, action] of result.actions.entries()) {
      const preview = this.coordinator.storePreview(
        actionSource(result, action, exclusiveGroupId),
      );
      if (!preview) {
        this.coordinator.discard(previews.map((item) => item.id));
        throw new Error("LSP Code Action apply preview could not be stored");
      }
      previews.push({
        id: preview.id,
        expiresAt: preview.expiresAt,
        actionIndex,
        actionSha256: action.actionSha256,
      });
    }
    return previews;
  }

  discardPreviews(previews: LspCodeActionApplyPreview[]): void {
    this.coordinator.discard(previews.map((preview) => preview.id));
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<LspCodeActionApplyResult> {
    const execution = await this.coordinator.apply(previewId, signal);
    const { expectedFiles: _expectedFiles, ...durableOutcome } =
      execution.outcome;
    const base = {
      kind: "napier.lsp-code-action-apply" as const,
      schemaVersion: 1 as const,
      ...durableOutcome,
      sourceActionSha256: execution.source.sourceActionSha256,
      sourceResolved: execution.source.sourceResolved,
      sourceCommandIgnored: execution.source.sourceCommandIgnored,
      commandPolicy: "deny_all" as const,
      ...(execution.diagnostics
        ? { diagnostics: execution.diagnostics.details }
        : {}),
      ...(execution.tests ? { tests: execution.tests.details } : {}),
    };
    const details: LspCodeActionApplyDetails = {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    };
    return {
      details,
      summary: formatLspWorkspaceEditApplySummary({
        label: "LSP Code Action apply",
        details,
        ...(execution.diagnostics
          ? { diagnosticsSummary: execution.diagnostics.summary }
          : {}),
        ...(execution.tests ? { testsSummary: execution.tests.summary } : {}),
        appliedMessage:
          "The selected quick-fix text edits are committed and every language-server command remained denied. Run relevant behavior verification before claiming completion.",
        rolledBackMessage:
          "The selected quick-fix commit failed and the original file set was restored. Request fresh Code Actions before retrying.",
        indeterminateMessage:
          "Workspace state is indeterminate. Inspect every target before any retry.",
      }),
    };
  }
}

function actionSource(
  result: LspCodeActionsResult,
  action: LspCodeAction,
  exclusiveGroupId: string,
): LspCodeActionPreviewSource {
  return {
    sourcePreviewResultSha256: result.details.resultSha256,
    sourceActionSha256: action.actionSha256,
    sourceResolved: action.resolved,
    sourceCommandIgnored: action.commandIgnored,
    exclusiveGroupId,
    files: action.files,
  };
}
