import type { RunRecord } from "./execution-runs.js";

export type ManualRunRecoveryThreadStatus =
  | "idle"
  | "running"
  | "waiting"
  | "failed";

export type ManualRunRecoveryBlockReason =
  | "workflow_managed"
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
