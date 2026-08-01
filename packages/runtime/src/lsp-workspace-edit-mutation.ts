import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import {
  commitLspRename,
  type CommitLspRenameOptions,
  type LspRenameCommitExpectedFile,
  type LspRenameCommitOutcome,
} from "./lsp-rename-commit.js";
import { createId } from "./ids.js";
import type { WriteLinkedTestBeforeState } from "./write-linked-test-selection.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

export const MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS = 32;
export const LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS = 5 * 60_000;

export interface LspWorkspaceEditPreviewSource {
  sourcePreviewResultSha256: string;
  files: LspRenameFile[];
  exclusiveGroupId?: string;
}

export interface LspWorkspaceEditApplyPreview<Source> {
  id: string;
  expiresAt: string;
  source: Source;
}

export interface LspWorkspaceEditDiagnosticsAdapter<
  State,
  Observation extends { details: object; summary: string },
> {
  observeBefore(files: LspRenameFile[], signal?: AbortSignal): Promise<State>;
  observeAfter(
    state: State,
    expectedFiles: LspRenameCommitExpectedFile[],
    signal?: AbortSignal,
  ): Promise<Observation>;
  unavailable(state: State, error: unknown): Observation;
}

export interface LspWorkspaceEditMutationOptions<
  Source extends LspWorkspaceEditPreviewSource,
  State,
  Observation extends { details: object; summary: string },
> {
  workspaceRoot: string;
  dataRoot: string;
  label: string;
  previewPrefix: string;
  diagnostics: LspWorkspaceEditDiagnosticsAdapter<State, Observation>;
  tests?: Pick<WriteLinkedTestVerificationRunner, "captureBefore" | "run"> &
    Partial<Pick<WriteLinkedTestVerificationRunner, "supports">>;
  now?: () => Date;
  commit?: typeof commitLspRename;
  commitSource?: (
    source: Source,
    signal?: AbortSignal,
  ) => Promise<LspRenameCommitOutcome>;
  changeCount?: (source: Source) => number;
  commitOptions?: Pick<CommitLspRenameOptions, "renameFile" | "linkFile">;
  preflight?: (source: Source, signal?: AbortSignal) => Promise<void>;
}

export interface LspWorkspaceEditMutationExecution<
  Source,
  Observation extends { details: object; summary: string },
> {
  source: Source;
  outcome: LspRenameCommitOutcome;
  diagnostics?: Observation;
  tests?: Awaited<ReturnType<WriteLinkedTestVerificationRunner["run"]>>;
}

export interface LspWorkspaceEditApplySummaryDetails {
  status: "applied" | "rolled_back" | "indeterminate";
  postcondition: "verified" | "drifted" | "indeterminate";
  fileCount: number;
  editCount: number;
  committedFileCount: number;
  restoredFileCount: number;
  recoveryArtifactCount: number;
  rollbackVerified: boolean;
  durable: boolean;
  expectedFileSetSha256: string;
  observedFileSetSha256?: string;
  errorSha256?: string;
}

export interface LspWorkspaceEditApplySummaryOptions {
  label: string;
  details: LspWorkspaceEditApplySummaryDetails;
  diagnosticsSummary?: string;
  testsSummary?: string;
  appliedMessage: string;
  rolledBackMessage: string;
  indeterminateMessage: string;
}

interface StoredPreview<Source> {
  source: Source;
  expiresAt: string;
  createdAtMs: number;
}

export class LspWorkspaceEditMutationCoordinator<
  Source extends LspWorkspaceEditPreviewSource,
  State,
  Observation extends { details: object; summary: string },
> {
  private readonly previews = new Map<string, StoredPreview<Source>>();
  private readonly currentTime: () => Date;
  private readonly commit: typeof commitLspRename;
  private readonly idPattern: RegExp;

  constructor(
    private readonly options: LspWorkspaceEditMutationOptions<
      Source,
      State,
      Observation
    >,
  ) {
    if (!/^[a-z][a-z0-9_]{1,15}$/u.test(options.previewPrefix)) {
      throw new Error("LSP WorkspaceEdit preview prefix is invalid");
    }
    this.currentTime = options.now ?? (() => new Date());
    this.commit = options.commit ?? commitLspRename;
    this.idPattern = new RegExp(
      `^${options.previewPrefix}_[a-z0-9]{8,80}$`,
      "u",
    );
  }

  storePreview(
    source: Source,
  ): LspWorkspaceEditApplyPreview<Source> | undefined {
    const changeCount =
      this.options.changeCount?.(source) ?? source.files.length;
    if (changeCount === 0) return undefined;
    this.prune();
    const now = this.validNow();
    const id = createId(this.options.previewPrefix);
    const expiresAt = new Date(
      now.getTime() + LSP_WORKSPACE_EDIT_APPLY_PREVIEW_TTL_MS,
    ).toISOString();
    const stored = structuredClone(source);
    this.previews.set(id, {
      source: stored,
      expiresAt,
      createdAtMs: now.getTime(),
    });
    this.prune();
    return { id, expiresAt, source: structuredClone(stored) };
  }

  discard(previewIds: Iterable<string>): void {
    for (const previewId of previewIds) this.previews.delete(previewId);
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<LspWorkspaceEditMutationExecution<Source, Observation>> {
    if (!this.idPattern.test(previewId)) {
      throw new Error(`${this.options.label} preview ID is invalid`);
    }
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error(`${this.options.label} preview not found`);
    }
    if (Date.parse(preview.expiresAt) <= this.validNow().getTime()) {
      this.previews.delete(previewId);
      throw new Error(`${this.options.label} preview expired`);
    }
    this.consumePreviewGroup(previewId, preview.source.exclusiveGroupId);
    this.prune();
    assertNotAborted(signal, this.options.label);
    await this.options.preflight?.(preview.source, signal);
    assertNotAborted(signal, this.options.label);
    const testsEnabled = this.testsEnabled(preview.source);
    const testBefore = testsEnabled
      ? await this.captureTestsBefore(preview.source, signal)
      : undefined;
    const diagnostics = await this.options.diagnostics.observeBefore(
      preview.source.files,
      signal,
    );
    assertNotAborted(signal, this.options.label);
    await this.options.preflight?.(preview.source, signal);
    assertNotAborted(signal, this.options.label);
    const outcome = this.options.commitSource
      ? await this.options.commitSource(preview.source, signal)
      : await this.commit({
          workspaceRoot: this.options.workspaceRoot,
          dataRoot: this.options.dataRoot,
          sourcePreviewResultSha256: preview.source.sourcePreviewResultSha256,
          files: preview.source.files,
          ...(signal ? { signal } : {}),
          ...this.options.commitOptions,
        });
    const diagnosticObservation =
      outcome.status === "applied"
        ? await this.observeAfter(diagnostics, outcome.expectedFiles, signal)
        : undefined;
    const testObservation =
      outcome.status === "applied" &&
      outcome.postcondition === "verified" &&
      testsEnabled &&
      this.options.tests
        ? await this.options.tests.run(
            outcome.expectedFiles.map((file) => ({
              path: file.path,
              expectedSha256: file.expectedSha256,
            })),
            testBefore,
            signal,
          )
        : undefined;
    return {
      source: structuredClone(preview.source),
      outcome,
      ...(diagnosticObservation ? { diagnostics: diagnosticObservation } : {}),
      ...(testObservation ? { tests: testObservation } : {}),
    };
  }

  private consumePreviewGroup(
    selectedPreviewId: string,
    exclusiveGroupId?: string,
  ): void {
    if (!exclusiveGroupId) {
      this.previews.delete(selectedPreviewId);
      return;
    }
    for (const [previewId, preview] of this.previews) {
      if (preview.source.exclusiveGroupId === exclusiveGroupId) {
        this.previews.delete(previewId);
      }
    }
  }

  private async captureTestsBefore(
    source: Source,
    signal?: AbortSignal,
  ): Promise<WriteLinkedTestBeforeState | undefined> {
    if (!this.options.tests) return undefined;
    assertNotAborted(signal, this.options.label);
    return this.options.tests.captureBefore(
      source.files.map((file) => ({
        path: file.path,
        expectedSha256: file.fileSha256,
      })),
    );
  }

  private testsEnabled(source: Source): boolean {
    return Boolean(
      this.options.tests &&
      source.files.length > 0 &&
      (!this.options.tests.supports ||
        source.files.every((file) => this.options.tests!.supports!(file.path))),
    );
  }

  private async observeAfter(
    state: State,
    expectedFiles: LspRenameCommitExpectedFile[],
    signal?: AbortSignal,
  ): Promise<Observation> {
    try {
      return await this.options.diagnostics.observeAfter(
        state,
        expectedFiles,
        signal,
      );
    } catch (error) {
      return this.options.diagnostics.unavailable(state, error);
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
    while (retained.length > MAX_LSP_WORKSPACE_EDIT_APPLY_PREVIEWS) {
      const oldest = retained.shift();
      if (oldest) this.previews.delete(oldest[0]);
    }
  }

  private validNow(): Date {
    const value = this.currentTime();
    if (!Number.isFinite(value.getTime())) {
      throw new Error(`${this.options.label} time is invalid`);
    }
    return value;
  }
}

export function formatLspWorkspaceEditApplySummary(
  options: LspWorkspaceEditApplySummaryOptions,
): string {
  const { details } = options;
  return [
    `${options.label}: ${details.status}`,
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
    ...(details.errorSha256 ? [`Error SHA-256: ${details.errorSha256}`] : []),
    ...(options.diagnosticsSummary ? ["", options.diagnosticsSummary] : []),
    ...(options.testsSummary ? ["", options.testsSummary] : []),
    "",
    details.status === "applied" && details.postcondition === "verified"
      ? options.appliedMessage
      : details.status === "rolled_back"
        ? options.rolledBackMessage
        : options.indeterminateMessage,
  ].join("\n");
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  label: string,
): void {
  if (signal?.aborted) {
    throw new Error(`${label} was aborted before commit`);
  }
}
