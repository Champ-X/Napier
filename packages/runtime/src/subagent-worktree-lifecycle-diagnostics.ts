import type {
  LspRenameApplyDiagnosticsDetails,
  WorkspacePatchDiagnosticsStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  lspDiagnosticLanguageForPath,
  LspDiagnosticsRunner,
  type LspDiagnostic,
  type LspDiagnosticsResult,
  type LspDiagnosticsRunnerOptions,
} from "./lsp-diagnostics.js";
import { createLspPatchObservation } from "./lsp-patch-diagnostics.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";

export const MAX_SUBAGENT_LIFECYCLE_DIAGNOSTIC_FILES = 8;

export interface SubagentWorktreeLifecycleDiagnosticsState {
  entries: Array<{
    change: SubagentWorktreeChange;
    before?: LspDiagnosticsResult;
  }>;
  omittedFileCount: number;
}

export interface SubagentWorktreeLifecycleDiagnosticsObservation {
  details: LspRenameApplyDiagnosticsDetails;
  summary: string;
}

export interface SubagentWorktreeLifecycleDiagnosticsAdapter {
  observeBefore(
    changes: SubagentWorktreeChange[],
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeLifecycleDiagnosticsState>;
  observeAfter(
    state: SubagentWorktreeLifecycleDiagnosticsState,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeLifecycleDiagnosticsObservation>;
  unavailable(
    state: SubagentWorktreeLifecycleDiagnosticsState,
    error: unknown,
  ): SubagentWorktreeLifecycleDiagnosticsObservation;
}

interface FileObservation {
  path: string;
  pathSha256: string;
  operation: SubagentWorktreeChange["operation"];
  status?: WorkspacePatchDiagnosticsStatus;
  beforeDiagnosticCount: number;
  afterDiagnosticCount?: number;
  beforeErrorCount: number;
  afterErrorCount?: number;
  beforeWarningCount: number;
  afterWarningCount?: number;
  introducedCount?: number;
  resolvedCount?: number;
  unchangedCount?: number;
  truncated: boolean;
  beforeResultSha256?: string;
  afterResultSha256?: string;
  deltaSetSha256?: string;
  errorSha256?: string;
  durationMs: number;
}

export class SubagentWorktreeLifecycleDiagnostics implements SubagentWorktreeLifecycleDiagnosticsAdapter {
  private readonly runner: LspDiagnosticsRunner;

  constructor(options: LspDiagnosticsRunnerOptions) {
    const { session: _persistentSession, ...oneShotOptions } = options;
    this.runner = new LspDiagnosticsRunner(oneShotOptions);
  }

  async observeBefore(
    changes: SubagentWorktreeChange[],
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeLifecycleDiagnosticsState> {
    const supported = changes.filter(
      (change) => lspDiagnosticLanguageForPath(change.path) !== undefined,
    );
    const selected = supported.slice(
      0,
      MAX_SUBAGENT_LIFECYCLE_DIAGNOSTIC_FILES,
    );
    const entries: SubagentWorktreeLifecycleDiagnosticsState["entries"] = [];
    for (const change of selected) {
      signal?.throwIfAborted();
      if (change.beforeSha256 === null) {
        entries.push({ change });
        continue;
      }
      const before = await this.runner.run({
        path: change.path,
        ...(signal ? { signal } : {}),
      });
      if (before.details.fileSha256 !== change.beforeSha256) {
        throw new Error(
          "Pre-merge lifecycle diagnostics do not match the preview SHA-256",
        );
      }
      entries.push({ change, before });
    }
    return {
      entries,
      omittedFileCount: supported.length - selected.length,
    };
  }

  async observeAfter(
    state: SubagentWorktreeLifecycleDiagnosticsState,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeLifecycleDiagnosticsObservation> {
    const observations: FileObservation[] = [];
    for (const entry of state.entries) {
      const startedAt = Date.now();
      try {
        observations.push(
          entry.change.afterSha256 === null
            ? removedObservation(entry.change, entry.before)
            : await this.observePresent(entry, signal),
        );
      } catch (error) {
        observations.push({
          path: entry.change.path,
          pathSha256: entry.change.pathSha256,
          operation: entry.change.operation,
          beforeDiagnosticCount: entry.before?.details.diagnosticCount ?? 0,
          beforeErrorCount: entry.before?.details.errorCount ?? 0,
          beforeWarningCount: entry.before?.details.warningCount ?? 0,
          truncated: entry.before?.details.truncated === true,
          ...(entry.before
            ? { beforeResultSha256: entry.before.details.resultSha256 }
            : {}),
          errorSha256: sha256(errorMessage(error)),
          durationMs:
            (entry.before?.details.durationMs ?? 0) +
            Math.max(0, Date.now() - startedAt),
        });
      }
    }
    return aggregateLifecycleDiagnostics(state, observations);
  }

  unavailable(
    state: SubagentWorktreeLifecycleDiagnosticsState,
    error: unknown,
  ): SubagentWorktreeLifecycleDiagnosticsObservation {
    return unavailableLifecycleDiagnostics(state, error);
  }

  private async observePresent(
    entry: SubagentWorktreeLifecycleDiagnosticsState["entries"][number],
    signal?: AbortSignal,
  ): Promise<FileObservation> {
    const after = await this.runner.run({
      path: entry.change.path,
      ...(signal && !signal.aborted ? { signal } : {}),
    });
    const details = createLspPatchObservation(
      entry.change.afterSha256!,
      entry.before,
      after,
    ).details;
    if (!details) {
      throw new Error("Lifecycle diagnostics result is unavailable");
    }
    return {
      path: entry.change.path,
      pathSha256: entry.change.pathSha256,
      operation: entry.change.operation,
      status: details.status,
      beforeDiagnosticCount: details.beforeDiagnosticCount ?? 0,
      afterDiagnosticCount: details.afterDiagnosticCount ?? 0,
      beforeErrorCount: details.beforeErrorCount ?? 0,
      afterErrorCount: details.afterErrorCount ?? 0,
      beforeWarningCount: details.beforeWarningCount ?? 0,
      afterWarningCount: details.afterWarningCount ?? 0,
      introducedCount: details.introducedCount ?? 0,
      resolvedCount: details.resolvedCount ?? 0,
      unchangedCount: details.unchangedCount ?? 0,
      truncated: details.truncated === true,
      ...(details.beforeResultSha256
        ? { beforeResultSha256: details.beforeResultSha256 }
        : {}),
      ...(details.afterResultSha256
        ? { afterResultSha256: details.afterResultSha256 }
        : {}),
      ...(details.deltaSetSha256
        ? { deltaSetSha256: details.deltaSetSha256 }
        : {}),
      durationMs: details.durationMs,
    };
  }
}

function removedObservation(
  change: SubagentWorktreeChange,
  before: LspDiagnosticsResult | undefined,
): FileObservation {
  if (!before || change.beforeSha256 === null) {
    throw new Error("Deleted lifecycle diagnostics state is unavailable");
  }
  const resolved = diagnosticIdentityCounts(before.diagnostics);
  const resolvedCount = before.details.diagnosticCount;
  return {
    path: change.path,
    pathSha256: change.pathSha256,
    operation: change.operation,
    status: before.details.truncated
      ? "truncated"
      : resolvedCount === 0
        ? "clean"
        : "improved",
    beforeDiagnosticCount: resolvedCount,
    afterDiagnosticCount: 0,
    beforeErrorCount: before.details.errorCount,
    afterErrorCount: 0,
    beforeWarningCount: before.details.warningCount,
    afterWarningCount: 0,
    introducedCount: 0,
    resolvedCount,
    unchangedCount: 0,
    truncated: before.details.truncated,
    beforeResultSha256: before.details.resultSha256,
    deltaSetSha256: sha256(
      canonicalJson({ introduced: [], resolved, unchanged: [] }),
    ),
    durationMs: before.details.durationMs,
  };
}

function aggregateLifecycleDiagnostics(
  state: SubagentWorktreeLifecycleDiagnosticsState,
  observations: FileObservation[],
): SubagentWorktreeLifecycleDiagnosticsObservation {
  const errors = observations
    .map((observation) => observation.errorSha256)
    .filter((value): value is string => value !== undefined);
  const successful = observations.filter(
    (
      observation,
    ): observation is FileObservation & {
      status: WorkspacePatchDiagnosticsStatus;
      afterDiagnosticCount: number;
      afterErrorCount: number;
      afterWarningCount: number;
      introducedCount: number;
      resolvedCount: number;
      unchangedCount: number;
      deltaSetSha256: string;
    } =>
      observation.status !== undefined &&
      observation.afterDiagnosticCount !== undefined &&
      observation.afterErrorCount !== undefined &&
      observation.afterWarningCount !== undefined &&
      observation.introducedCount !== undefined &&
      observation.resolvedCount !== undefined &&
      observation.unchangedCount !== undefined &&
      observation.deltaSetSha256 !== undefined,
  );
  const beforeDiagnosticCount = sum(observations, "beforeDiagnosticCount");
  const beforeErrorCount = sum(observations, "beforeErrorCount");
  const beforeWarningCount = sum(observations, "beforeWarningCount");
  const afterDiagnosticCount = sum(successful, "afterDiagnosticCount");
  const afterErrorCount = sum(successful, "afterErrorCount");
  const afterWarningCount = sum(successful, "afterWarningCount");
  const introducedCount = sum(successful, "introducedCount");
  const resolvedCount = sum(successful, "resolvedCount");
  const unchangedCount = sum(successful, "unchangedCount");
  const truncated =
    state.omittedFileCount > 0 ||
    observations.some((observation) => observation.truncated);
  const status = aggregateStatus(
    successful.map((observation) => observation.status),
    errors.length > 0,
    truncated,
    afterDiagnosticCount,
    introducedCount,
    resolvedCount,
  );
  const beforeResultSetSha256 = sha256(
    canonicalJson(
      state.entries.map((entry) => ({
        pathSha256: entry.change.pathSha256,
        resultSha256: entry.before?.details.resultSha256 ?? null,
      })),
    ),
  );
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
    ...(errors.length === 0
      ? {
          afterResultSetSha256: sha256(
            canonicalJson(
              observations.map((observation) => ({
                pathSha256: observation.pathSha256,
                resultSha256: observation.afterResultSha256 ?? null,
              })),
            ),
          ),
          deltaSetSha256: sha256(
            canonicalJson(
              successful.map((observation) => ({
                pathSha256: observation.pathSha256,
                deltaSetSha256: observation.deltaSetSha256,
              })),
            ),
          ),
        }
      : { errorSha256: sha256(canonicalJson(errors.sort())) }),
    durationMs: sum(observations, "durationMs"),
  };
  return {
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
    summary: [
      `Coder lifecycle diagnostics: ${status}`,
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
        observation.status
          ? `${observation.path} (${observation.operation}): ${observation.status}`
          : `${observation.path} (${observation.operation}): unavailable`,
      ),
    ].join("\n"),
  };
}

function unavailableLifecycleDiagnostics(
  state: SubagentWorktreeLifecycleDiagnosticsState,
  error: unknown,
): SubagentWorktreeLifecycleDiagnosticsObservation {
  const beforeDiagnosticCount = state.entries.reduce(
    (total, entry) => total + (entry.before?.details.diagnosticCount ?? 0),
    0,
  );
  const beforeErrorCount = state.entries.reduce(
    (total, entry) => total + (entry.before?.details.errorCount ?? 0),
    0,
  );
  const beforeWarningCount = state.entries.reduce(
    (total, entry) => total + (entry.before?.details.warningCount ?? 0),
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
    truncated:
      state.omittedFileCount > 0 ||
      state.entries.some((entry) => entry.before?.details.truncated === true),
    beforeResultSetSha256: sha256(
      canonicalJson(
        state.entries.map((entry) => ({
          pathSha256: entry.change.pathSha256,
          resultSha256: entry.before?.details.resultSha256 ?? null,
        })),
      ),
    ),
    errorSha256: sha256(errorMessage(error)),
    durationMs: state.entries.reduce(
      (total, entry) => total + (entry.before?.details.durationMs ?? 0),
      0,
    ),
  };
  return {
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
    summary: [
      "Coder lifecycle diagnostics: unavailable",
      `Files checked before commit: ${state.entries.length}`,
      `Files omitted: ${state.omittedFileCount}`,
      `Error SHA-256: ${base.errorSha256}`,
      "The candidate commit remains authoritative; run fresh diagnostics before claiming type safety.",
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

function diagnosticIdentityCounts(
  diagnostics: LspDiagnostic[],
): Array<{ diagnosticSha256: string; count: number }> {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const identity = sha256(
      canonicalJson({
        severity: diagnostic.severity,
        code: diagnostic.code ?? null,
        source: diagnostic.source ?? null,
        message: diagnostic.message,
      }),
    );
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([diagnosticSha256, count]) => ({ diagnosticSha256, count }));
}

function sum<T>(
  values: T[],
  field: {
    [Key in keyof T]: T[Key] extends number | undefined ? Key : never;
  }[keyof T],
): number {
  return values.reduce((total, value) => total + Number(value[field] ?? 0), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
