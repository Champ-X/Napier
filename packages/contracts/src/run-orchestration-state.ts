import type {
  RecoveryOperationReason,
  RecoveryOperationStatus,
} from "./manual-run-recovery.js";
import type { ToolReplayClassV1 } from "./tool-replay-class.js";

/**
 * Total orchestration program counter for one Run (Pi Durable `op.state` analogue).
 *
 * Recovery reads this complete value. It must not depend on a prior register
 * version. Evidence stays in the event ledger; this register only locates the
 * open work. Phase 1 may project it from events (`source: "projected"`);
 * later phases may persist it (`source: "persisted"`).
 */
export type RunOrchestrationPhaseV1 =
  | "ready"
  | "generating"
  | "tooling"
  | "waiting_decision"
  | "settling"
  | "terminal";

/** Side-effect fence for one tool operation inside the register. */
export type RunOrchestrationToolPhaseV1 =
  | "intent"
  | "effect_pending"
  | "settled"
  | "indeterminate"
  | "interrupted";

export interface RunOrchestrationToolOpV1 {
  callId: string;
  toolName: string;
  startedSeq: number;
  evidenceSeq: number;
  toolPhase: RunOrchestrationToolPhaseV1;
  replayClass: ToolReplayClassV1;
  recoveryStatus: RecoveryOperationStatus;
  recoveryReason: RecoveryOperationReason;
}

export interface RunOrchestrationStateV1 {
  kind: "napier.run-orchestration-state";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  sourceRunId: string;
  phase: RunOrchestrationPhaseV1;
  cancelRequested: boolean;
  configSnapshotHash?: string;
  /** Greatest event seq folded into this total state. */
  revisedAtSeq: number;
  evidenceLimited: boolean;
  /** Count of tool.started rows considered, including omitted/unclassified. */
  toolStartTotal: number;
  openToolOps: RunOrchestrationToolOpV1[];
  toolOpCounts: Record<RecoveryOperationStatus, number>;
  source: "projected" | "persisted";
}

export function emptyToolOpCounts(): Record<RecoveryOperationStatus, number> {
  return {
    completed: 0,
    not_executed: 0,
    needs_reconciliation: 0,
    not_replayable: 0,
  };
}

/** Recovery continues only when no open op still needs reconciliation. */
export function orchestrationBlocksAutomaticReplay(
  state: RunOrchestrationStateV1,
): boolean {
  if (state.evidenceLimited) return true;
  return state.openToolOps.some(
    (op) =>
      op.recoveryStatus === "needs_reconciliation" ||
      op.toolPhase === "indeterminate" ||
      op.toolPhase === "effect_pending",
  );
}

export function isRunOrchestrationStateV1(
  value: unknown,
): value is RunOrchestrationStateV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["kind"] === "napier.run-orchestration-state" &&
    record["schemaVersion"] === 1 &&
    typeof record["threadId"] === "string" &&
    typeof record["runId"] === "string" &&
    typeof record["sourceRunId"] === "string" &&
    typeof record["phase"] === "string" &&
    typeof record["cancelRequested"] === "boolean" &&
    typeof record["revisedAtSeq"] === "number" &&
    typeof record["evidenceLimited"] === "boolean" &&
    typeof record["toolStartTotal"] === "number" &&
    Array.isArray(record["openToolOps"]) &&
    (record["source"] === "projected" || record["source"] === "persisted")
  );
}
