import type { ArtifactManifestEntry, ExecutionPlan, RunEvent } from "@napier/contracts";

import { toolEventTraceView } from "./tool-event-view";

export type TaskValidationCheckId =
  | "typecheck"
  | "tests"
  | "diagnostics"
  | "artifact";
export type TaskValidationStatus =
  | "passed"
  | "failed"
  | "warning"
  | "unknown";
export type TaskValidationSource = "receipt" | "lsp" | "ledger";

export interface TaskValidationMatrixRow {
  id: TaskValidationCheckId;
  status: TaskValidationStatus;
  source: TaskValidationSource;
  eventSeq?: number;
  runId?: string;
  durationMs?: number;
  exitCode?: number;
  diagnosticCount?: number;
  errorCount?: number;
  warningCount?: number;
  artifactCount?: number;
  verifiedArtifactCount?: number;
  producedArtifactCount?: number;
  missingArtifactCount?: number;
  stale?: boolean;
}

export function taskValidationMatrix(
  events: readonly RunEvent[],
  plans: readonly ExecutionPlan[],
): TaskValidationMatrixRow[] {
  const latestWriteSeq = latestWorkspaceWriteSeq(events);
  return [
    verificationRow("typecheck", events, latestWriteSeq),
    verificationRow("tests", events, latestWriteSeq),
    diagnosticsRow(events, latestWriteSeq),
    artifactRow(plans),
  ];
}

function verificationRow(
  id: "typecheck" | "tests",
  events: readonly RunEvent[],
  latestWriteSeq: number,
): TaskValidationMatrixRow {
  const kind = id === "tests" ? "test" : "typecheck";
  const evidence = [...events].reverse().find((event) => {
    const view = toolEventTraceView(event);
    return view?.toolName === "verify_workspace" &&
      view.verificationKind === kind &&
      view.verificationStatus;
  });
  const view = evidence ? toolEventTraceView(evidence) : undefined;
  if (!evidence || !view?.verificationStatus) {
    return { id, status: "unknown", source: "receipt" };
  }
  const stale = evidence.seq < latestWriteSeq;
  const passed = view.verificationStatus === "passed";
  const durationMs = numberField(evidence.payload, "details", "durationMs");
  return {
    id,
    status: passed ? (stale ? "warning" : "passed") : "failed",
    source: "receipt",
    eventSeq: evidence.seq,
    runId: evidence.runId,
    ...(view.verificationExitCode !== undefined
      ? { exitCode: view.verificationExitCode }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(stale ? { stale: true } : {}),
  };
}

function diagnosticsRow(
  events: readonly RunEvent[],
  latestWriteSeq: number,
): TaskValidationMatrixRow {
  const evidence = [...events].reverse().find((event) => {
    const view = toolEventTraceView(event);
    return view?.toolName === "lsp_diagnostics" && view.lspStatus;
  });
  const view = evidence ? toolEventTraceView(evidence) : undefined;
  if (!evidence || !view?.lspStatus) {
    return { id: "diagnostics", status: "unknown", source: "lsp" };
  }
  const stale = evidence.seq < latestWriteSeq;
  const failed =
    evidence.type === "tool.failed" || (view.lspErrorCount ?? 0) > 0;
  const warning =
    stale ||
    view.lspStatus === "diagnostics" ||
    (view.lspWarningCount ?? 0) > 0;
  return {
    id: "diagnostics",
    status: failed ? "failed" : warning ? "warning" : "passed",
    source: "lsp",
    eventSeq: evidence.seq,
    runId: evidence.runId,
    ...(view.lspDiagnosticCount !== undefined
      ? { diagnosticCount: view.lspDiagnosticCount }
      : {}),
    ...(view.lspErrorCount !== undefined
      ? { errorCount: view.lspErrorCount }
      : {}),
    ...(view.lspWarningCount !== undefined
      ? { warningCount: view.lspWarningCount }
      : {}),
    ...(view.lspDurationMs !== undefined
      ? { durationMs: view.lspDurationMs }
      : {}),
    ...(stale ? { stale: true } : {}),
  };
}

function artifactRow(
  plans: readonly ExecutionPlan[],
): TaskValidationMatrixRow {
  const plan = currentPlan(plans);
  const artifacts = plan?.artifacts ?? [];
  if (artifacts.length === 0) {
    return { id: "artifact", status: "unknown", source: "ledger" };
  }
  const counts = artifactCounts(artifacts);
  const status: TaskValidationStatus =
    counts.missingArtifactCount > 0
      ? "failed"
      : counts.verifiedArtifactCount === counts.artifactCount
        ? "passed"
        : counts.verifiedArtifactCount + counts.producedArtifactCount > 0
          ? "warning"
          : "unknown";
  return { id: "artifact", status, source: "ledger", ...counts };
}

function currentPlan(plans: readonly ExecutionPlan[]): ExecutionPlan | undefined {
  return (
    plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? plans.at(-1)
  );
}

function artifactCounts(artifacts: readonly ArtifactManifestEntry[]) {
  return {
    artifactCount: artifacts.length,
    verifiedArtifactCount: artifacts.filter(
      (artifact) => artifact.status === "verified",
    ).length,
    producedArtifactCount: artifacts.filter(
      (artifact) => artifact.status === "produced",
    ).length,
    missingArtifactCount: artifacts.filter(
      (artifact) => artifact.status === "missing",
    ).length,
  };
}

function latestWorkspaceWriteSeq(events: readonly RunEvent[]): number {
  return events.reduce((latest, event) => {
    if (
      event.type === "tool.completed" &&
      record(event.payload)?.["effect"] === "write"
    ) {
      return Math.max(latest, event.seq);
    }
    return latest;
  }, -1);
}

function numberField(
  payload: unknown,
  parent: string,
  key: string,
): number | undefined {
  const value = record(record(payload)?.[parent])?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
