import {
  RunBudgetExceededError,
  RunFinalizationReservedError,
  type RunBudgetExhaustion,
  type RunFinalizationReserve,
} from "./run-budget.js";
import {
  isModelTurnWatchdogError,
  type ModelTurnWatchdogEvidence,
} from "./model-turn-deadline.js";
import {
  ToolDeadlineError,
  type ToolDeadlineEvidence,
} from "./tool-deadline-policy.js";
import {
  RunNoProgressError,
  type RunNoProgressEvidence,
} from "./run-no-progress-policy.js";
import {
  ModelThinkingLoopError,
  type ModelThinkingLoopEvidence,
} from "./model-thinking-loop-policy.js";

export interface RunFailureSource {
  budgetExhaustion: RunBudgetExhaustion | undefined;
  finalizationReserve: RunFinalizationReserve | undefined;
  modelWatchdog: ModelTurnWatchdogEvidence | undefined;
  toolDeadline: ToolDeadlineEvidence | undefined;
  noProgress: RunNoProgressEvidence | undefined;
  thinkingLoop: ModelThinkingLoopEvidence | undefined;
  resumable: boolean;
}

export function runFailureSource(
  trackedExhaustion: RunBudgetExhaustion | undefined,
  error: unknown,
): RunFailureSource {
  const budgetExhaustion =
    trackedExhaustion ??
    (error instanceof RunBudgetExceededError ? error.exhaustion : undefined);
  const finalizationReserve =
    error instanceof RunFinalizationReservedError ? error.reserve : undefined;
  const modelWatchdog = isModelTurnWatchdogError(error)
    ? error.evidence
    : undefined;
  const toolDeadline =
    error instanceof ToolDeadlineError ? error.evidence : undefined;
  const noProgress =
    error instanceof RunNoProgressError ? error.evidence : undefined;
  const thinkingLoop =
    error instanceof ModelThinkingLoopError ? error.evidence : undefined;
  return {
    budgetExhaustion,
    finalizationReserve,
    modelWatchdog,
    toolDeadline,
    noProgress,
    thinkingLoop,
    resumable: Boolean(
      budgetExhaustion ||
      finalizationReserve ||
      modelWatchdog ||
      toolDeadline ||
      noProgress ||
      thinkingLoop,
    ),
  };
}

export function failureSourceMessage(
  source: RunFailureSource,
): string | undefined {
  if (source.budgetExhaustion) return source.budgetExhaustion.message;
  if (source.finalizationReserve) return source.finalizationReserve.message;
  if (source.modelWatchdog) {
    return `Model turn watchdog triggered deterministic finalization: ${source.modelWatchdog.reason}.`;
  }
  if (source.toolDeadline) {
    return `Tool deadline triggered deterministic finalization: ${source.toolDeadline.toolName} ${source.toolDeadline.state}.`;
  }
  if (source.noProgress) {
    return `Run made no measurable progress after one reroute: ${source.noProgress.reason}.`;
  }
  if (source.thinkingLoop) {
    return `Model thinking-loop guard triggered deterministic finalization: ${source.thinkingLoop.reason}.`;
  }
  return undefined;
}
