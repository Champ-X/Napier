import type { AgentProfile, JsonObject, ModelContextEnvelopeReceipt, RunEvent, RunRecord, Usage } from "@napier/contracts";
import type { SubagentChildRunFence, SubagentChildRunState } from "./subagent-execution-fence-types.js";
export type { SubagentChildRunFence, SubagentChildRunState, SubagentChildCheckpointFence } from "./subagent-execution-fence-types.js";
import type { SubagentCheckpointStore } from "./subagent-working-set-types.js";
import type { RunLeaseOptions } from "./run-lease-renewal.js";
import type { SubagentChildRunAuthorization } from "./subagent-child-authorization.js";
import type { FinishSubagentTaskInput } from "./subagent-store-records.js";

export interface StartSubagentChildRunInput {
  taskId: string;
  executionId: string;
  authorization: SubagentChildRunAuthorization;
  lease: RunLeaseOptions;
}
export interface StartedSubagentChildRun extends SubagentChildRunState {
  token: string;
  profile: AgentProfile;
}
export type SubagentChildInvocationPhase = "subagent_turn" | "typed_repair" | "outcome_repair" | "context_compaction";
export interface ReserveSubagentChildInvocationInput extends SubagentChildRunFence {
  requestId: string;
  phase: SubagentChildInvocationPhase;
}
export interface SubagentChildInvocationReservation {
  invocationId: string;
  invocationIndex: number;
  executionRevision: number;
  /** Newly committed events for best-effort publication outside the transaction. */
  events?: RunEvent[];
}
export interface SettleSubagentChildInvocationInput extends SubagentChildRunFence {
  invocationId: string;
  payload: JsonObject;
  usage?: Usage;
  /** Unknown physical completion must not manufacture a known zero-usage receipt. */
  usageStatus?: "known" | "unknown";
  capture?: { envelope: ModelContextEnvelopeReceipt; adapter?: JsonObject };
}
export interface FinishSubagentChildRunInput extends SubagentChildRunFence {
  finish: FinishSubagentTaskInput;
  assertActive?: () => void;
}
export interface SubagentChildProgressInput extends SubagentChildRunFence {
  stepDelta?: number;
  turnDelta?: number;
}
export interface BindSubagentChildRouteInput extends SubagentChildRunFence { routePlanId: string }
/** Runner-facing port; keeps the executor independent of the workspace store facade. */
export interface SubagentChildExecutionStore extends SubagentCheckpointStore {
  renewRunLease(runId: string, token: string, ttlMs: number): Promise<RunRecord>;
  assertSubagentChildRunActive(input: SubagentChildRunFence): SubagentChildRunState;
  reserveSubagentChildInvocation(input: ReserveSubagentChildInvocationInput): Promise<SubagentChildInvocationReservation>;
  settleSubagentChildInvocation(input: SettleSubagentChildInvocationInput): Promise<SubagentChildRunState>;
  recordSubagentChildProgress(input: SubagentChildProgressInput): Promise<SubagentChildRunState>;
  bindSubagentChildRoute(input: BindSubagentChildRouteInput): Promise<SubagentChildRunState>;
  finishSubagentChildRun(input: FinishSubagentChildRunInput): Promise<SubagentChildRunState>;
}
