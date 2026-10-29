import type { JsonValue, SubagentOutcome, SubagentStopReason, SubagentTask, SubagentTaskStatus, SubagentCompletionCandidate, SubagentCompletionReservation } from "@napier/contracts";
import type { SubagentChildRunFence, SubagentChildRunState } from "./subagent-execution-fence-types.js";

declare const preparedBrand: unique symbol;
export interface PreparedSubagentCompletion { readonly [preparedBrand]: true }
export interface PrepareSubagentCompletionInput extends SubagentChildRunFence {
  finish: FinishSubagentTaskInput;
  assertActive?: () => void;
}
export interface PreparedSubagentCompletionResult extends SubagentChildRunState {
  prepared: PreparedSubagentCompletion;
}
export type SubagentCandidateDeliveryAuthority = (
  reservation: SubagentCompletionReservation,
  candidate: SubagentCompletionCandidate,
) => Promise<boolean>;

export interface FinishSubagentTaskInput {
  status: Exclude<SubagentTaskStatus, "pending" | "running">;
  stopReason: SubagentStopReason;
  result?: string;
  outcome?: SubagentOutcome;
  output?: JsonValue;
  error?: string;
  usage?: SubagentTask["usage"];
  preparedCompletion?: PreparedSubagentCompletion;
  candidateId?: string;
}
