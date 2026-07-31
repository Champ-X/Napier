import type { LspRenameApplyDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commitLspRename,
  type CommitLspRenameOptions,
} from "./lsp-rename-commit.js";
import {
  LspRenameApplyDiagnostics,
  type LspRenameDiagnosticsState,
  unavailableLspRenameDiagnostics,
} from "./lsp-rename-apply-diagnostics.js";
import type { LspRenameResult } from "./lsp-rename.js";
import { createId } from "./ids.js";

export const MAX_LSP_RENAME_APPLY_PREVIEWS = 32;
export const LSP_RENAME_APPLY_PREVIEW_TTL_MS = 5 * 60_000;

const PREVIEW_ID = /^renamepreview_[a-z0-9]{8,80}$/u;

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
  now?: () => Date;
  commit?: typeof commitLspRename;
  commitOptions?: Pick<CommitLspRenameOptions, "renameFile" | "linkFile">;
}

interface StoredPreview {
  result: LspRenameResult;
  expiresAt: string;
  createdAtMs: number;
}

export class LspRenameMutationManager {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly currentTime: () => Date;
  private readonly commit: typeof commitLspRename;

  constructor(private readonly options: LspRenameMutationManagerOptions) {
    this.currentTime = options.now ?? (() => new Date());
    this.commit = options.commit ?? commitLspRename;
  }

  storePreview(result: LspRenameResult): LspRenameApplyPreview | undefined {
    if (result.details.status !== "found" || result.files.length === 0) {
      return undefined;
    }
    this.prune();
    const now = this.validNow();
    const id = createId("renamepreview");
    const expiresAt = new Date(
      now.getTime() + LSP_RENAME_APPLY_PREVIEW_TTL_MS,
    ).toISOString();
    this.previews.set(id, {
      result: structuredClone(result),
      expiresAt,
      createdAtMs: now.getTime(),
    });
    this.prune();
    return { id, expiresAt, result: structuredClone(result) };
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<LspRenameApplyResult> {
    if (!PREVIEW_ID.test(previewId)) {
      throw new Error("LSP rename apply preview ID is invalid");
    }
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error("LSP rename apply preview not found");
    }
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      this.previews.delete(previewId);
      throw new Error("LSP rename apply preview expired");
    }
    this.previews.delete(previewId);
    this.prune();
    signal?.throwIfAborted();
    const diagnostics = await this.options.diagnostics.observeBefore(
      preview.result.files,
      signal,
    );
    signal?.throwIfAborted();
    const outcome = await this.commit({
      workspaceRoot: this.options.workspaceRoot,
      dataRoot: this.options.dataRoot,
      sourcePreviewResultSha256: preview.result.details.resultSha256,
      files: preview.result.files,
      ...(signal ? { signal } : {}),
      ...this.options.commitOptions,
    });
    const diagnosticObservation =
      outcome.status === "applied"
        ? await this.observeAfter(diagnostics, outcome.expectedFiles, signal)
        : undefined;
    const { expectedFiles: _expectedFiles, ...durableOutcome } = outcome;
    const base = {
      kind: "napier.lsp-rename-apply" as const,
      schemaVersion: 1 as const,
      ...durableOutcome,
      ...(diagnosticObservation
        ? { diagnostics: diagnosticObservation.details }
        : {}),
    };
    const details: LspRenameApplyDetails = {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    };
    return {
      details,
      summary: [
        `LSP rename apply: ${details.status}`,
        `Postcondition: ${details.postcondition}`,
        `Files: ${details.fileCount}`,
        `Edits: ${details.editCount}`,
        `Committed files: ${details.committedFileCount}`,
        `Restored files: ${details.restoredFileCount}`,
        `Recovery artifacts: ${details.recoveryArtifactCount}`,
        `Rollback verified: ${String(details.rollbackVerified)}`,
        `Durable: ${String(details.durable)}`,
        `Expected file set SHA-256: ${details.expectedFileSetSha256}`,
        ...(details.observedFileSetSha256
          ? [`Observed file set SHA-256: ${details.observedFileSetSha256}`]
          : []),
        ...(details.errorSha256
          ? [`Error SHA-256: ${details.errorSha256}`]
          : []),
        ...(diagnosticObservation ? ["", diagnosticObservation.summary] : []),
        "",
        details.status === "applied" && details.postcondition === "verified"
          ? "The coordinated rename is committed. Run relevant behavior verification before claiming completion."
          : details.status === "rolled_back"
            ? "The coordinated commit failed and the original file set was restored. Preview again before retrying."
            : "Workspace state is indeterminate. Inspect every target before any retry.",
      ].join("\n"),
    };
  }

  private async observeAfter(
    state: LspRenameDiagnosticsState,
    expectedFiles: Parameters<LspRenameApplyDiagnostics["observeAfter"]>[1],
    signal?: AbortSignal,
  ) {
    try {
      return await this.options.diagnostics.observeAfter(
        state,
        expectedFiles,
        signal,
      );
    } catch (error) {
      return unavailableLspRenameDiagnostics(state, error);
    }
  }

  private prune(): void {
    const now = this.validNow().getTime();
    for (const [id, preview] of this.previews) {
      if (Date.parse(preview.expiresAt) <= now) this.previews.delete(id);
    }
    const retained = [...this.previews.entries()].sort(
      (left, right) => left[1].createdAtMs - right[1].createdAtMs,
    );
    while (retained.length > MAX_LSP_RENAME_APPLY_PREVIEWS) {
      const oldest = retained.shift();
      if (oldest) this.previews.delete(oldest[0]);
    }
  }

  private validNow(): Date {
    const value = this.currentTime();
    if (!Number.isFinite(value.getTime())) {
      throw new Error("LSP rename apply time is invalid");
    }
    return value;
  }
}
