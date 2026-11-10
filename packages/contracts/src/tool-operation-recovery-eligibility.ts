import type {
  RecoveryOperationReason,
  RecoveryOperationStatus,
} from "./manual-run-recovery.js";
import type { ToolReplayClassV1 } from "./tool-replay-class.js";

/**
 * Durable intent → effect → settlement fence for one tool.operation journal,
 * aligned with Pi Durable's uncertain window without replacing Napier evidence.
 */
export type ToolOperationFencePhaseV1 =
  | "none"
  | "intent"
  | "started"
  | "effect_pending"
  | "settled"
  | "indeterminate";

export interface ToolOperationRecoveryRowV1 {
  parentCallId: string;
  toolName: string;
  startedSeq: number;
  evidenceSeq: number;
  /** Primary execution-authority / domain operation when journalled. */
  operationId?: string;
  fencePhase: ToolOperationFencePhaseV1;
  replayClass: ToolReplayClassV1;
  recoveryStatus: RecoveryOperationStatus;
  recoveryReason: RecoveryOperationReason;
  /** True when classification used tool.operation.* fences, not only tool.started. */
  journalBacked: boolean;
}

export interface RunToolRecoveryEligibilityTableV1 {
  kind: "napier.run-tool-recovery-eligibility";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  revisedAtSeq: number;
  evidenceLimited: boolean;
  rows: ToolOperationRecoveryRowV1[];
}

export function isRunToolRecoveryEligibilityTableV1(
  value: unknown,
): value is RunToolRecoveryEligibilityTableV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["kind"] === "napier.run-tool-recovery-eligibility" &&
    record["schemaVersion"] === 1 &&
    typeof record["threadId"] === "string" &&
    typeof record["runId"] === "string" &&
    typeof record["revisedAtSeq"] === "number" &&
    typeof record["evidenceLimited"] === "boolean" &&
    Array.isArray(record["rows"])
  );
}

/** Map journal fence onto orchestration toolPhase vocabulary. */
export function fencePhaseToOrchestrationToolPhase(
  fence: ToolOperationFencePhaseV1,
): "intent" | "effect_pending" | "settled" | "indeterminate" | "interrupted" {
  if (fence === "intent" || fence === "started" || fence === "none") {
    return fence === "none" ? "interrupted" : "intent";
  }
  if (fence === "effect_pending") return "effect_pending";
  if (fence === "settled") return "settled";
  return "indeterminate";
}
