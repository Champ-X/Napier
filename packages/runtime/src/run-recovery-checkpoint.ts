import type { RunEvent, RunRecord } from "@napier/contracts";
import type { RunRecoveryCheckpoint } from "@napier/contracts/manual-run-recovery";
import type { RunOrchestrationStateV1 } from "@napier/contracts/run-orchestration-state";
import { projectRunOrchestrationState } from "./run-orchestration-projection.js";

/** Same projection for HTTP/SDK and local consumers. No private inputs or paths. */
export function projectRunRecoveryCheckpoint(
  run: RunRecord | undefined,
  source: RunEvent[],
  runs: RunRecord[] = [],
): RunRecoveryCheckpoint | undefined {
  if (!run || (run.status !== "interrupted" && run.status !== "failed")) {
    return undefined;
  }
  const state = projectRunOrchestrationState(run, source, runs);
  if (!state) return undefined;
  return recoveryCheckpointFromOrchestration(state);
}

/** Reuse the already-folded ledger projection when loading a Thread detail. */
export function recoveryCheckpointFromOrchestration(
  state: RunOrchestrationStateV1,
): RunRecoveryCheckpoint {
  return {
    runId: state.runId,
    sourceRunId: state.sourceRunId,
    throughSeq: state.revisedAtSeq,
    evidenceLimited: state.evidenceLimited,
    total: state.toolStartTotal,
    omitted: state.evidenceLimited
      ? state.toolStartTotal
      : Math.max(0, state.toolStartTotal - state.openToolOps.length),
    counts: { ...state.toolOpCounts },
    operations: state.openToolOps.map((operation) => ({
      callId: operation.callId,
      toolName: operation.toolName,
      startedSeq: operation.startedSeq,
      evidenceSeq: operation.evidenceSeq,
      status: operation.recoveryStatus,
      reason: operation.recoveryReason,
    })),
  };
}
