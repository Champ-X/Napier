import type { Usage } from "@napier/contracts";
import type { FinishSubagentTaskInput } from "./subagent-store-records.js";
import { MAX_SUBAGENT_RESULT_CHARS, truncateSubagentText } from "./subagent-task-evidence.js";

export function subagentTaskFailure(error: unknown, input: {
  turnCapped: boolean;
  maxTurns: number;
  timedOut: boolean;
  cancelled: boolean;
  finalText: string;
  outcomeRejected: boolean;
  usage: Usage;
}): FinishSubagentTaskInput & { error: string } {
  const message = input.turnCapped
    ? `Subagent turn budget exhausted (${input.maxTurns})`
    : error instanceof Error ? error.message : String(error);
  const status = input.timedOut ? "timed_out" : input.cancelled ? "cancelled" : "failed";
  const stopReason = input.timedOut ? "timeout" : input.cancelled ? "cancelled"
    : input.turnCapped ? "turn_capped" : "error";
  return {
    status, stopReason, error: message, usage: input.usage,
    ...(!input.outcomeRejected && input.finalText
      ? { result: truncateSubagentText(input.finalText, MAX_SUBAGENT_RESULT_CHARS) } : {}),
  };
}
