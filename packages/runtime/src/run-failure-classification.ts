import type { RunRecord } from "@napier/contracts";

import type {
  RunBudgetExhaustion,
  RunFinalizationReserve,
} from "./run-budget.js";
import type { ModelTurnWatchdogEvidence } from "./model-turn-deadline.js";
import type { RunNoProgressEvidence } from "./run-no-progress-policy.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import {
  failureSourceMessage,
  runFailureSource,
} from "./run-failure-source.js";
import type { ToolDeadlineEvidence } from "./tool-deadline-policy.js";

export interface RunFailureClassification {
  budgetExhaustion: RunBudgetExhaustion | undefined;
  finalizationReserve: RunFinalizationReserve | undefined;
  modelWatchdog: ModelTurnWatchdogEvidence | undefined;
  toolDeadline: ToolDeadlineEvidence | undefined;
  noProgress: RunNoProgressEvidence | undefined;
  thinkingLoop: ModelThinkingLoopEvidence | undefined;
  cancelled: boolean;
  blocksGoal: boolean;
  message: string;
  status: Extract<RunRecord["status"], "cancelled" | "failed">;
  eventType: "run.cancelled" | "run.failed";
  outcome?: NonNullable<RunRecord["outcome"]>;
  payload: {
    status: Extract<RunRecord["status"], "cancelled" | "failed">;
    outcome?: NonNullable<RunRecord["outcome"]>;
    message: string;
  };
}

export function classifyFailure(
  signalAborted: boolean,
  workflowInvocation: boolean,
  trackedExhaustion: RunBudgetExhaustion | undefined,
  error: unknown,
): RunFailureClassification {
  const source = runFailureSource(trackedExhaustion, error);
  const cancelled = signalAborted && !source.resumable;
  const message =
    failureSourceMessage(source) ??
    (error instanceof Error ? error.message : String(error));
  const status = cancelled ? "cancelled" : "failed";
  const outcome = source.resumable ? "paused_budget" : undefined;
  return {
    ...source,
    cancelled,
    blocksGoal: !cancelled && !workflowInvocation && !source.resumable,
    message,
    status,
    eventType: cancelled ? "run.cancelled" : "run.failed",
    ...(outcome ? { outcome } : {}),
    payload: { status, ...(outcome ? { outcome } : {}), message },
  };
}

export function withSettlementOutcome(
  failure: RunFailureClassification,
  outcome: Extract<
    NonNullable<RunRecord["outcome"]>,
    "partial" | "paused_budget"
  >,
): RunFailureClassification {
  if (
    !failure.budgetExhaustion &&
    !failure.finalizationReserve &&
    !failure.modelWatchdog &&
    !failure.toolDeadline &&
    !failure.noProgress &&
    !failure.thinkingLoop
  ) {
    return failure;
  }
  return {
    ...failure,
    outcome,
    payload: { ...failure.payload, outcome },
  };
}
