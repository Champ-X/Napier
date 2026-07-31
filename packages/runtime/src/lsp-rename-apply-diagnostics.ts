import type {
  LspRenameApplyDiagnosticsDetails,
  WorkspacePatchDiagnosticsDetails,
  WorkspacePatchDiagnosticsStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  lspDiagnosticLanguageForPath,
  LspDiagnosticsRunner,
  type LspDiagnosticsResult,
  type LspDiagnosticsRunnerOptions,
} from "./lsp-diagnostics.js";
import { createLspPatchObservation } from "./lsp-patch-diagnostics.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import type { LspRenameCommitExpectedFile } from "./lsp-rename-commit.js";

export const MAX_LSP_RENAME_DIAGNOSTIC_FILES = 8;

export interface LspRenameDiagnosticsState {
  entries: Array<{
    path: string;
    pathSha256: string;
    result: LspDiagnosticsResult;
  }>;
  omittedFileCount: number;
}

export interface LspRenameDiagnosticsObservation {
  details: LspRenameApplyDiagnosticsDetails;
  summary: string;
}

export class LspRenameApplyDiagnostics {
  private readonly runner: LspDiagnosticsRunner;

  constructor(options: LspDiagnosticsRunnerOptions) {
    this.runner = new LspDiagnosticsRunner(options);
  }

  async observeBefore(
    files: LspRenameFile[],
    signal?: AbortSignal,
  ): Promise<LspRenameDiagnosticsState> {
    const supported = files.filter(
      (file) => lspDiagnosticLanguageForPath(file.path) !== undefined,
    );
    const selected = supported.slice(0, MAX_LSP_RENAME_DIAGNOSTIC_FILES);
    const entries: LspRenameDiagnosticsState["entries"] = [];
    for (const file of selected) {
      signal?.throwIfAborted();
      const result = await this.runner.run({
        path: file.path,
        ...(signal ? { signal } : {}),
      });
      if (result.details.fileSha256 !== file.fileSha256) {
        throw new Error(
          "Pre-rename diagnostics do not match the preview SHA-256",
        );
      }
      entries.push({
        path: file.path,
        pathSha256: file.pathSha256,
        result,
      });
    }
    return {
      entries,
      omittedFileCount: supported.length - selected.length,
    };
  }

  async observeAfter(
    state: LspRenameDiagnosticsState,
    expectedFiles: LspRenameCommitExpectedFile[],
    signal?: AbortSignal,
  ): Promise<LspRenameDiagnosticsObservation> {
    const expectedByPath = new Map(
      expectedFiles.map((file) => [file.pathSha256, file]),
    );
    const observations: Array<{
      path: string;
      pathSha256: string;
      details?: WorkspacePatchDiagnosticsDetails;
      errorSha256?: string;
      durationMs?: number;
    }> = [];
    for (const entry of state.entries) {
      const expected = expectedByPath.get(entry.pathSha256);
      if (!expected) {
        throw new Error("Rename diagnostics target binding is unavailable");
      }
      const startedAt = Date.now();
      try {
        const after = await this.runner.run({
          path: entry.path,
          ...(signal && !signal.aborted ? { signal } : {}),
        });
        const details = createLspPatchObservation(
          expected.expectedSha256,
          entry.result,
          after,
        ).details;
        if (!details) {
          throw new Error("Rename diagnostics result is unavailable");
        }
        observations.push({
          path: entry.path,
          pathSha256: entry.pathSha256,
          details,
        });
      } catch (error) {
        observations.push({
          path: entry.path,
          pathSha256: entry.pathSha256,
          errorSha256: sha256(errorMessage(error)),
          durationMs:
            entry.result.details.durationMs +
            Math.max(0, Date.now() - startedAt),
        });
      }
    }
    return aggregateDiagnostics(state, observations);
  }
}

export function unavailableLspRenameDiagnostics(
  state: LspRenameDiagnosticsState,
  error: unknown,
): LspRenameDiagnosticsObservation {
  const beforeDiagnosticCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.diagnosticCount,
    0,
  );
  const beforeErrorCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.errorCount,
    0,
  );
  const beforeWarningCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.warningCount,
    0,
  );
  const base = {
    kind: "napier.lsp-rename-apply-diagnostics" as const,
    schemaVersion: 1 as const,
    status: "unavailable" as const,
    fileCount: state.entries.length,
    omittedFileCount: state.omittedFileCount,
    beforeDiagnosticCount,
    beforeErrorCount,
    beforeWarningCount,
    truncated: state.omittedFileCount > 0,
    beforeResultSetSha256: sha256(
      canonicalJson(
        state.entries.map((entry) => ({
          pathSha256: entry.pathSha256,
          resultSha256: entry.result.details.resultSha256,
        })),
      ),
    ),
    errorSha256: sha256(errorMessage(error)),
    durationMs: state.entries.reduce(
      (total, entry) => total + entry.result.details.durationMs,
      0,
    ),
  };
  return {
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
    summary: [
      "Rename diagnostics: unavailable",
      `Files checked before commit: ${state.entries.length}`,
      `Files omitted: ${state.omittedFileCount}`,
      `Error SHA-256: ${base.errorSha256}`,
      "The rename commit outcome remains authoritative; run fresh diagnostics before claiming type safety.",
    ].join("\n"),
  };
}

function aggregateDiagnostics(
  state: LspRenameDiagnosticsState,
  observations: Array<{
    path: string;
    pathSha256: string;
    details?: WorkspacePatchDiagnosticsDetails;
    errorSha256?: string;
    durationMs?: number;
  }>,
): LspRenameDiagnosticsObservation {
  const details = observations
    .map((observation) => observation.details)
    .filter(
      (value): value is WorkspacePatchDiagnosticsDetails => value !== undefined,
    );
  const errors = observations
    .map((observation) => observation.errorSha256)
    .filter((value): value is string => value !== undefined);
  const beforeDiagnosticCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.diagnosticCount,
    0,
  );
  const beforeErrorCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.errorCount,
    0,
  );
  const beforeWarningCount = state.entries.reduce(
    (total, entry) => total + entry.result.details.warningCount,
    0,
  );
  const afterDiagnosticCount = sum(details, "afterDiagnosticCount");
  const afterErrorCount = sum(details, "afterErrorCount");
  const afterWarningCount = sum(details, "afterWarningCount");
  const introducedCount = sum(details, "introducedCount");
  const resolvedCount = sum(details, "resolvedCount");
  const unchangedCount = sum(details, "unchangedCount");
  const statuses = details.map((entry) => entry.status);
  const truncated =
    state.omittedFileCount > 0 ||
    details.some((entry) => entry.truncated === true);
  const status = aggregateStatus(
    statuses,
    errors.length > 0,
    truncated,
    afterDiagnosticCount,
    introducedCount,
    resolvedCount,
  );
  const beforeResultSetSha256 = sha256(
    canonicalJson(
      state.entries.map((entry) => ({
        pathSha256: entry.pathSha256,
        resultSha256: entry.result.details.resultSha256,
      })),
    ),
  );
  const afterReceipts = observations.map((observation) => ({
    pathSha256: observation.pathSha256,
    resultSha256: observation.details?.resultSha256 ?? null,
    errorSha256: observation.errorSha256 ?? null,
  }));
  const base = {
    kind: "napier.lsp-rename-apply-diagnostics" as const,
    schemaVersion: 1 as const,
    status,
    fileCount: state.entries.length,
    omittedFileCount: state.omittedFileCount,
    beforeDiagnosticCount,
    ...(errors.length === 0 ? { afterDiagnosticCount } : {}),
    beforeErrorCount,
    ...(errors.length === 0 ? { afterErrorCount } : {}),
    beforeWarningCount,
    ...(errors.length === 0 ? { afterWarningCount } : {}),
    ...(errors.length === 0
      ? { introducedCount, resolvedCount, unchangedCount }
      : {}),
    truncated,
    beforeResultSetSha256,
    afterResultSetSha256: sha256(canonicalJson(afterReceipts)),
    ...(errors.length === 0
      ? {
          deltaSetSha256: sha256(
            canonicalJson(
              details.map((entry) => ({
                resultSha256: entry.resultSha256,
                deltaSetSha256: entry.deltaSetSha256 ?? null,
              })),
            ),
          ),
        }
      : { errorSha256: sha256(canonicalJson(errors.sort())) }),
    durationMs: observations.reduce(
      (total, observation) =>
        total +
        (observation.details?.durationMs ?? observation.durationMs ?? 0),
      0,
    ),
  };
  return {
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
    summary: [
      `Rename diagnostics: ${status}`,
      `Files checked: ${state.entries.length}`,
      `Files omitted: ${state.omittedFileCount}`,
      `Diagnostics: ${beforeDiagnosticCount} -> ${errors.length === 0 ? afterDiagnosticCount : "unavailable"}`,
      `Errors: ${beforeErrorCount} -> ${errors.length === 0 ? afterErrorCount : "unavailable"}`,
      ...(errors.length === 0
        ? [
            `Delta: ${introducedCount} introduced / ${resolvedCount} resolved / ${unchangedCount} unchanged`,
          ]
        : []),
      ...observations.map((observation) =>
        observation.details
          ? `${observation.path}: ${observation.details.status}`
          : `${observation.path}: unavailable`,
      ),
    ].join("\n"),
  };
}

function aggregateStatus(
  statuses: WorkspacePatchDiagnosticsStatus[],
  unavailable: boolean,
  truncated: boolean,
  afterDiagnosticCount: number,
  introducedCount: number,
  resolvedCount: number,
): WorkspacePatchDiagnosticsStatus {
  if (unavailable) return "unavailable";
  if (statuses.includes("drifted")) return "drifted";
  if (truncated) return "truncated";
  if (statuses.includes("regressed")) return "regressed";
  if (statuses.includes("introduced")) return "introduced";
  if (resolvedCount > introducedCount) return "improved";
  if (afterDiagnosticCount === 0) return "clean";
  return "unchanged";
}

function sum(
  details: WorkspacePatchDiagnosticsDetails[],
  field:
    | "afterDiagnosticCount"
    | "afterErrorCount"
    | "afterWarningCount"
    | "introducedCount"
    | "resolvedCount"
    | "unchangedCount",
): number {
  return details.reduce((total, entry) => total + (entry[field] ?? 0), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
