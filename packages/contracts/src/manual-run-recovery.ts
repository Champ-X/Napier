import type { RunRecord } from "./execution-runs.js";

/** Historical ledger facts, never a fresh filesystem verification or replay grant. */
export interface RunRecoveryCheckpoint {
  runId: string;
  sourceRunId: string;
  throughSeq: number;
  evidenceLimited: boolean;
  total: number;
  omitted: number;
  counts: Record<RecoveryOperationStatus, number>;
  operations: Array<{
    callId: string;
    toolName: string;
    startedSeq: number;
    evidenceSeq: number;
    status: RecoveryOperationStatus;
    reason: RecoveryOperationReason;
  }>;
}

export type RecoveryOperationStatus =
  | "completed"
  | "not_executed"
  | "needs_reconciliation"
  | "not_replayable";

export type RecoveryOperationReason =
  | "patch_settled"
  | "patch_reconciled"
  | "patch_not_committed"
  | "read_completed"
  | "read_stopped"
  | "effect_unresolved"
  | "effect_not_replayable"
  | "evidence_missing";

export type ManualRunRecoveryThreadStatus =
  | "idle"
  | "running"
  | "waiting"
  | "failed";

export type ManualRunRecoveryBlockReason =
  | "workflow_managed"
  | "context_compaction"
  | "model_experiment"
  | "tool_experiment"
  | "agent_experiment";

function hasResumableFailedOutcome(run: RunRecord): boolean {
  return (
    run.status === "failed" &&
    (run.outcome === "paused_budget" || run.outcome === "partial")
  );
}

export function isManualRunRecoveryParent(run: RunRecord): boolean {
  return (
    (run.status === "interrupted" || hasResumableFailedOutcome(run)) &&
    manualRunRecoveryBlockReason(run) === undefined
  );
}

export function manualRunRecoverySettlementMatches(
  threadStatus: ManualRunRecoveryThreadStatus,
  run: RunRecord,
): boolean {
  return (
    (threadStatus === "waiting" && run.status === "interrupted") ||
    (threadStatus === "idle" && hasResumableFailedOutcome(run))
  );
}

export function manualRunRecoveryBlockReason(
  run: RunRecord,
): ManualRunRecoveryBlockReason | undefined {
  if (
    run.source === "workflow" ||
    run.source === "workflow_reuse" ||
    run.source === "workflow_simulation"
  ) {
    return "workflow_managed";
  }
  if (run.source === "model_experiment") return "model_experiment";
  if (run.source === "context_compaction") return "context_compaction";
  if (run.source === "tool_experiment") return "tool_experiment";
  if (
    run.configuration &&
    "executionMode" in run.configuration &&
    run.configuration.executionMode === "agent_experiment_read_only"
  ) {
    return "agent_experiment";
  }
  return undefined;
}

export function isManuallyResumableRun(
  threadStatus: ManualRunRecoveryThreadStatus,
  run: RunRecord,
): boolean {
  return (
    manualRunRecoverySettlementMatches(threadStatus, run) &&
    manualRunRecoveryBlockReason(run) === undefined
  );
}
