import type { ThreadDetail } from "@napier/contracts";
import { taskRunProgress } from "./task-run-progress";

export type TaskNarrativePhase =
  | "ready"
  | "working"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed";

export interface TaskNarrative {
  phase: TaskNarrativePhase;
  phaseLabel: string;
  currentAction: string;
  completedItems: string[];
  metrics?: string;
  nextStep?: string;
  blocker?: string;
}

export function taskNarrative(
  detail:
    | Pick<
        ThreadDetail,
        | "thread"
        | "runs"
        | "plans"
        | "events"
        | "operatorDecisions"
        | "automaticRecoveryAssessments"
        | "automaticRecoveryAttempts"
      >
    | undefined,
  now = Date.now(),
): TaskNarrative {
  if (!detail)
    return baseNarrative("ready", "Ready", "Choose or create a ledger");
  const openDecision = detail.operatorDecisions.findLast(
    (decision) =>
      decision.status === "pending" || decision.status === "answered",
  );
  const plan = detail.plans.findLast(
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
  const narrativeRunId = detail.thread.currentRunId ?? detail.runs.at(-1)?.id;
  const runProgress = taskRunProgress(detail.events, narrativeRunId);
  const completedItems = completedNarrativeItems(
    planCompletedItems,
    runProgress.completedItems,
  );
  if (openDecision)
    return operatorDecisionNarrative(
      detail.runs,
      openDecision,
      completedItems,
      nextStep?.title,
      now,
    );
  const recovery = recoveryNarrative(
    detail,
    completedItems,
    planCompletedItems.length > 0,
    now,
  );
  if (recovery) return recovery;
  if (blockedStep || detail.thread.status === "failed") {
    const failedRun = detail.runs.findLast((run) => run.status === "failed");
    const blocker =
      blockedStep?.blocker ||
      failedRun?.error ||
      "The latest run needs review.";
    return {
      phase: detail.thread.status === "failed" ? "failed" : "blocked",
      phaseLabel:
        detail.thread.status === "failed" ? "Needs review" : "Blocked",
      currentAction: blockedStep?.title ?? "Review the failed run",
      completedItems,
      ...(failedRun ? { metrics: runMetrics(failedRun, now) } : {}),
      blocker,
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }

  const running = detail.runs.find(
    (run) => run.id === detail.thread.currentRunId && run.status === "running",
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
      metrics: runMetrics(running, now),
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }

  const completedPlan = detail.plans.findLast(
    (candidate) => candidate.status === "completed",
  );
  const completedRun = detail.runs.findLast(
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
      ...(completedRun ? { metrics: runMetrics(completedRun, now) } : {}),
      nextStep: "Start a follow-up task or inspect the evidence.",
    };
  }
  return baseNarrative(
    "ready",
    "Ready",
    nextStep
      ? `Ready to start: ${nextStep.title}`
      : "Describe the task to begin",
  );
}

function operatorDecisionNarrative(
  runs: ThreadDetail["runs"],
  decision: ThreadDetail["operatorDecisions"][number],
  completedItems: string[],
  nextStep: string | undefined,
  now: number,
): TaskNarrative {
  const run = runs.find((candidate) => candidate.id === decision.runId);
  return {
    phase: "waiting",
    phaseLabel: "Waiting",
    currentAction: decision.header,
    completedItems,
    ...(run ? { metrics: runMetrics(run, now) } : {}),
    blocker: "Operator input is required before the run can continue.",
    ...(nextStep ? { nextStep } : {}),
  };
}

function recoveryNarrative(
  detail: Pick<
    ThreadDetail,
    | "thread"
    | "runs"
    | "automaticRecoveryAssessments"
    | "automaticRecoveryAttempts"
    | "events"
  >,
  completedItems: string[],
  planItemsAreAuthoritative: boolean,
  now: number,
): TaskNarrative | undefined {
  const interrupted = detail.runs.findLast(
    (run) => run.status === "interrupted",
  );
  if (!interrupted) return undefined;
  const assessment = detail.automaticRecoveryAssessments.findLast(
    (candidate) => candidate.runId === interrupted.id,
  );
  const attempt = assessment
    ? detail.automaticRecoveryAttempts.findLast(
        (candidate) => candidate.assessmentSha256 === assessment.contentSha256,
      )
    : undefined;
  const recoveredItems = planItemsAreAuthoritative
    ? completedItems
    : mergeCompletedItems(
        taskRunProgress(detail.events, interrupted.id).completedItems,
        completedItems,
      );
  const latestRunId = detail.runs.at(-1)?.id;
  if (
    attempt?.recoveryRunId
      ? latestRunId !== attempt.recoveryRunId
      : latestRunId !== interrupted.id
  ) {
    return undefined;
  }
  if (!assessment && detail.thread.status === "waiting") {
    return {
      phase: "waiting",
      phaseLabel: "Recovering",
      currentAction: "Assessing the interrupted run",
      completedItems: recoveredItems,
      metrics: runMetrics(interrupted, now),
      blocker: "Recovery safety evidence is being evaluated.",
    };
  }
  if (assessment && !assessment.eligible) {
    return {
      phase: "blocked",
      phaseLabel: "Recovery blocked",
      currentAction: "Automatic recovery stopped safely",
      completedItems: recoveredItems,
      metrics: runMetrics(interrupted, now),
      blocker: `${assessment.blockReasons.length} safety condition${
        assessment.blockReasons.length === 1 ? "" : "s"
      } ${assessment.blockReasons.length === 1 ? "requires" : "require"} review.`,
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  if (assessment?.eligible && !attempt && detail.thread.status === "waiting") {
    return {
      phase: "waiting",
      phaseLabel: "Recovering",
      currentAction: "Waiting for a recovery claim",
      completedItems: recoveredItems,
      metrics: runMetrics(interrupted, now),
      blocker: "The verified retry is waiting for its recovery worker.",
    };
  }
  if (attempt?.status === "claimed" || attempt?.status === "running") {
    const recoveryRun = attempt.recoveryRunId
      ? detail.runs.find((run) => run.id === attempt.recoveryRunId)
      : undefined;
    return {
      phase: "working",
      phaseLabel: "Recovering",
      currentAction:
        attempt.status === "claimed"
          ? "Claiming the interrupted run"
          : "Restoring from verified read-only evidence",
      completedItems: recoveredItems,
      metrics: runMetrics(recoveryRun ?? interrupted, now),
      nextStep: `Attempt ${attempt.attempt}/${attempt.maxAttempts} is in progress.`,
    };
  }
  if (attempt?.status === "completed") {
    const recoveryRun = attempt.recoveryRunId
      ? detail.runs.find((run) => run.id === attempt.recoveryRunId)
      : undefined;
    return {
      phase: "completed",
      phaseLabel: "Recovered",
      currentAction: "Interrupted work recovered",
      completedItems: recoveredItems,
      metrics: runMetrics(recoveryRun ?? interrupted, now),
      nextStep: "Inspect the recovered output or start a follow-up task.",
    };
  }
  if (
    attempt &&
    ["failed", "cancelled", "interrupted", "abandoned"].includes(attempt.status)
  ) {
    return {
      phase: "failed",
      phaseLabel: "Recovery failed",
      currentAction: "Review the recovery attempt",
      completedItems: recoveredItems,
      metrics: runMetrics(interrupted, now),
      blocker: `Attempt ${attempt.attempt}/${attempt.maxAttempts} ${attempt.status}.`,
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  return undefined;
}

function baseNarrative(
  phase: TaskNarrativePhase,
  phaseLabel: string,
  currentAction: string,
): TaskNarrative {
  return { phase, phaseLabel, currentAction, completedItems: [] };
}

function mergeCompletedItems(...sets: string[][]): string[] {
  return [...new Set(sets.flat())].slice(-3);
}

function completedNarrativeItems(
  planItems: string[],
  runItems: string[],
): string[] {
  return planItems.length > 0 ? planItems : runItems;
}

function runMetrics(run: ThreadDetail["runs"][number], now: number): string {
  const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsedMs = Math.max(0, finishedAt - Date.parse(run.startedAt));
  const tokens = run.usage.inputTokens + run.usage.outputTokens;
  return [
    run.limits
      ? `${formatDuration(elapsedMs)} / ${formatDuration(run.limits.timeoutMs)}`
      : formatDuration(elapsedMs),
    run.limits
      ? `${tokens.toLocaleString()} / ${run.limits.maxTotalTokens.toLocaleString()} tokens`
      : `${tokens.toLocaleString()} tokens`,
    run.limits
      ? `$${run.usage.costUsd.toFixed(4)} / $${run.limits.maxCostUsd.toFixed(2)}`
      : `$${run.usage.costUsd.toFixed(4)}`,
  ].join(" · ");
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
