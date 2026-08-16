import type { RunEvent, ThreadDetail } from "@napier/contracts";
import {
  applyTaskNarrativeEvent,
  createTaskNarrativeEventState,
  taskRunProgress,
  type TaskNarrativeEventState,
} from "./task-narrative-event-state.js";

type TaskNarrativeProjection = NonNullable<ThreadDetail["taskNarrative"]>;
export type TaskNarrativeSource = Pick<
  ThreadDetail,
  | "thread"
  | "runs"
  | "plans"
  | "automaticRecoveryAssessments"
  | "automaticRecoveryAttempts"
>;

export {
  applyTaskNarrativeEvent,
  createTaskNarrativeEventState,
  type TaskNarrativeEventState,
} from "./task-narrative-event-state.js";

export function projectTaskNarrative(
  source: TaskNarrativeSource,
  events: readonly RunEvent[],
): TaskNarrativeProjection {
  let state = createTaskNarrativeEventState();
  for (const event of events) state = applyTaskNarrativeEvent(state, event);
  return taskNarrativeView(source, state);
}

export function taskNarrativeView(
  source: TaskNarrativeSource,
  eventState: TaskNarrativeEventState,
): TaskNarrativeProjection {
  const openDecision = Object.values(eventState.decisions)
    .filter((decision) => decision.status !== "closed")
    .sort((left, right) => left.seq - right.seq)
    .at(-1);
  const plan = source.plans.findLast(
    (candidate) =>
      candidate.status === "active" || candidate.status === "blocked",
  );
  const runningStep = plan?.steps.find((step) => step.status === "running");
  const blockedStep = plan?.steps.find((step) => step.status === "blocked");
  const nextStep = plan?.steps.find((step) => step.status === "ready");
  const planCompletedItems =
    plan?.steps
      .filter((step) => step.status === "completed")
      .slice(-3)
      .map((step) => step.title) ?? [];
  const narrativeRunId = source.thread.currentRunId ?? source.runs.at(-1)?.id;
  const runProgress = taskRunProgress(eventState, narrativeRunId);
  const completedItems =
    planCompletedItems.length > 0
      ? planCompletedItems
      : runProgress.completedItems;
  if (openDecision) {
    return {
      phase: "waiting",
      phaseLabel: "Waiting",
      currentAction: openDecision.header,
      completedItems,
      metricRunId: openDecision.runId,
      blocker: "Operator input is required before the run can continue.",
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }
  const settlement = settlementNarrative(
    source,
    eventState,
    completedItems,
    planCompletedItems.length > 0,
  );
  if (settlement) return settlement;
  return inactiveNarrative(
    source,
    runProgress,
    completedItems,
    blockedStep,
    runningStep,
    nextStep,
  );
}

function inactiveNarrative(
  source: TaskNarrativeSource,
  runProgress: { currentAction?: string; completedItems: string[] },
  completedItems: string[],
  blockedStep:
    | TaskNarrativeSource["plans"][number]["steps"][number]
    | undefined,
  runningStep:
    | TaskNarrativeSource["plans"][number]["steps"][number]
    | undefined,
  nextStep: TaskNarrativeSource["plans"][number]["steps"][number] | undefined,
): TaskNarrativeProjection {
  if (blockedStep || source.thread.status === "failed") {
    const failedRun = source.runs.findLast((run) => run.status === "failed");
    return {
      phase: source.thread.status === "failed" ? "failed" : "blocked",
      phaseLabel:
        source.thread.status === "failed" ? "Needs review" : "Blocked",
      currentAction: blockedStep?.title ?? "Review the failed run",
      completedItems,
      ...(failedRun ? { metricRunId: failedRun.id } : {}),
      blocker:
        blockedStep?.blocker ||
        failedRun?.error ||
        "The latest run needs review.",
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }
  const running = source.runs.find(
    (run) => run.id === source.thread.currentRunId && run.status === "running",
  );
  if (running) {
    return {
      phase: "working",
      phaseLabel: "Working",
      currentAction:
        runningStep?.title ??
        runProgress.currentAction ??
        "Model is preparing the next action",
      completedItems,
      metricRunId: running.id,
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }
  const completedPlan = source.plans.findLast(
    (candidate) => candidate.status === "completed",
  );
  const completedRun = source.runs.findLast(
    (run) => run.status === "completed",
  );
  if (completedPlan || completedRun) {
    return {
      phase: "completed",
      phaseLabel: "Settled",
      currentAction: completedPlan
        ? "Plan completed with recorded evidence"
        : "Latest run completed",
      completedItems:
        completedPlan?.steps
          .filter((step) => step.status === "completed")
          .slice(-3)
          .map((step) => step.title) ?? completedItems,
      ...(completedRun ? { metricRunId: completedRun.id } : {}),
      nextStep: "Start a follow-up task or inspect the evidence.",
    };
  }
  return {
    phase: "ready",
    phaseLabel: "Ready",
    currentAction: nextStep
      ? `Ready to start: ${nextStep.title}`
      : "Describe the task to begin",
    completedItems: [],
  };
}

function settlementNarrative(
  source: TaskNarrativeSource,
  eventState: TaskNarrativeEventState,
  completedItems: string[],
  planItemsAreAuthoritative: boolean,
): TaskNarrativeProjection | undefined {
  const run = source.runs.at(-1);
  if (run?.outcome === "paused_budget" || run?.outcome === "partial") {
    const partial = run.outcome === "partial";
    return {
      phase: "waiting",
      phaseLabel: partial ? "Partial" : "Paused",
      currentAction: partial
        ? "Partial result preserved at the budget boundary"
        : "Run paused at its budget boundary",
      completedItems,
      metricRunId: run.id,
      nextStep: partial
        ? "Continue from preserved artifacts and open work."
        : "Continue from the recorded progress.",
    };
  }
  return recoveryNarrative(
    source,
    eventState,
    completedItems,
    planItemsAreAuthoritative,
  );
}

function recoveryNarrative(
  source: TaskNarrativeSource,
  eventState: TaskNarrativeEventState,
  completedItems: string[],
  planItemsAreAuthoritative: boolean,
): TaskNarrativeProjection | undefined {
  const interrupted = source.runs.findLast(
    (run) => run.status === "interrupted",
  );
  if (!interrupted) return undefined;
  const assessment = source.automaticRecoveryAssessments.findLast(
    (candidate) => candidate.runId === interrupted.id,
  );
  const attempt = assessment
    ? source.automaticRecoveryAttempts.findLast(
        (candidate) => candidate.assessmentSha256 === assessment.contentSha256,
      )
    : undefined;
  const recoveredItems = planItemsAreAuthoritative
    ? completedItems
    : mergeCompletedItems(
        taskRunProgress(eventState, interrupted.id).completedItems,
        completedItems,
      );
  const latestRunId = source.runs.at(-1)?.id;
  if (
    attempt?.recoveryRunId
      ? latestRunId !== attempt.recoveryRunId
      : latestRunId !== interrupted.id
  ) {
    return undefined;
  }
  if (!assessment && source.thread.status === "waiting") {
    return recoveryStatus(
      "waiting",
      "Recovering",
      "Assessing the interrupted run",
      recoveredItems,
      interrupted.id,
      "Recovery safety evidence is being evaluated.",
    );
  }
  if (assessment && !assessment.eligible) {
    const count = assessment.blockReasons.length;
    return {
      ...recoveryStatus(
        "blocked",
        "Recovery blocked",
        "Automatic recovery stopped safely",
        recoveredItems,
        interrupted.id,
        `${String(count)} safety condition${count === 1 ? "" : "s"} ${
          count === 1 ? "requires" : "require"
        } review.`,
      ),
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  if (assessment?.eligible && !attempt && source.thread.status === "waiting") {
    return recoveryStatus(
      "waiting",
      "Recovering",
      "Waiting for a recovery claim",
      recoveredItems,
      interrupted.id,
      "The verified retry is waiting for its recovery worker.",
    );
  }
  if (attempt?.status === "claimed" || attempt?.status === "running") {
    return {
      phase: "working",
      phaseLabel: "Recovering",
      currentAction:
        attempt.status === "claimed"
          ? "Claiming the interrupted run"
          : "Restoring from verified read-only evidence",
      completedItems: recoveredItems,
      metricRunId: attempt.recoveryRunId ?? interrupted.id,
      nextStep: `Attempt ${String(attempt.attempt)}/${String(attempt.maxAttempts)} is in progress.`,
    };
  }
  if (attempt?.status === "completed") {
    return {
      phase: "completed",
      phaseLabel: "Recovered",
      currentAction: "Interrupted work recovered",
      completedItems: recoveredItems,
      metricRunId: attempt.recoveryRunId ?? interrupted.id,
      nextStep: "Inspect the recovered output or start a follow-up task.",
    };
  }
  if (
    attempt &&
    ["failed", "cancelled", "interrupted", "abandoned"].includes(attempt.status)
  ) {
    return {
      ...recoveryStatus(
        "failed",
        "Recovery failed",
        "Review the recovery attempt",
        recoveredItems,
        interrupted.id,
        `Attempt ${String(attempt.attempt)}/${String(attempt.maxAttempts)} ${attempt.status}.`,
      ),
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  return undefined;
}

function recoveryStatus(
  phase: TaskNarrativeProjection["phase"],
  phaseLabel: string,
  currentAction: string,
  completedItems: string[],
  metricRunId: string,
  blocker: string,
): TaskNarrativeProjection {
  return {
    phase,
    phaseLabel,
    currentAction,
    completedItems,
    metricRunId,
    blocker,
  };
}

function mergeCompletedItems(...sets: string[][]): string[] {
  return [...new Set(sets.flat())].slice(-3);
}
