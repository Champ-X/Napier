import type { RunEvent } from "./execution-core.js";
import type { ThreadDetail } from "./workspace-bootstrap-v1.js";
import {
  applyTaskNarrativeEvent,
  createTaskNarrativeEventState,
  taskRunProgress,
  type TaskNarrativeEventState,
} from "./task-narrative-event-state.js";
import { projectTaskDeliverables } from "./task-deliverables.js";
import { taskOutcomeFacts } from "./task-outcome-facts.js";

type TaskNarrativeProjection = NonNullable<ThreadDetail["taskNarrative"]>;
export type TaskNarrativeSource = Pick<
  ThreadDetail,
  | "thread"
  | "runs"
  | "plans"
  | "automaticRecoveryAssessments"
  | "automaticRecoveryAttempts"
> &
  Partial<Pick<ThreadDetail, "operatorDecisions">>;

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
  source = { ...source, runs: source.runs.filter((run) => run.source !== "subagent") };
  const narrative = narrativeView(source, eventState);
  const facts = taskOutcomeFacts(source, narrative);
  const runId = source.thread.currentRunId ?? source.runs.at(-1)?.id ?? "";
  const references = eventState.outputReferencesByRun[runId] ?? [];
  const declared = projectTaskDeliverables(source.plans, {
    preferredPaths: references,
  });
  const message = eventState.outputMessageByRun[runId];
  const candidates: NonNullable<TaskNarrativeProjection["deliverables"]> =
    message
      ? references
          .filter((path) => !declared.some((entry) => entry.path === path))
          .map((path, index) => ({
            path,
            source: "final_reference",
            sourceEventId: message.id,
            accessibility: "unchecked",
            verification: "unverified",
            previousVersions: [],
            artifact: {
              id: `${message.id}:reference:${index}`,
              path,
              kind: "file",
              status: "candidate",
              description:
                "Explicit output reference; not yet verified as a deliverable.",
              evidence:
                "Reference in the recorded assistant response; creation by this Run is not established.",
              sourceRunId: runId,
              createdAt: message.createdAt,
              updatedAt: message.createdAt,
            },
          }))
      : [];
  return {
    ...narrative,
    ...facts,
    deliverables: [...declared, ...candidates],
    processItems: taskRunProgress(eventState, narrative.metricRunId)
      .completedItems,
  };
}

function narrativeView(
  source: TaskNarrativeSource,
  eventState: TaskNarrativeEventState,
): TaskNarrativeProjection {
  const projectedDecision = Object.values(eventState.decisions)
    .filter((decision) => decision.status !== "closed")
    .sort((left, right) => left.seq - right.seq)
    .at(-1);
  const openDecision =
    projectedDecision ??
    source.operatorDecisions?.findLast(
      (decision) =>
        decision.status === "pending" || decision.status === "answered",
    );
  const plan = source.plans.findLast(
    (candidate) =>
      candidate.status === "active" || candidate.status === "blocked",
  );
  const runningStep = plan?.steps.find((step) => step.status === "running");
  const blockedStep = plan?.steps.find((step) => step.status === "blocked");
  const nextStep = plan?.steps.find(
    (step) => step.status === "ready" || step.status === "pending",
  );
  const resultPlan = plan ?? source.plans.at(-1);
  const planCompletedItems =
    resultPlan?.steps
      .filter((step) => step.status === "completed")
      .slice(-3)
      .map((step) => step.title) ?? [];
  const narrativeRunId = source.thread.currentRunId ?? source.runs.at(-1)?.id;
  const runProgress = taskRunProgress(eventState, narrativeRunId);
  const completedItems = planCompletedItems;
  if (openDecision) {
    return {
      phase: "waiting",
      phaseLabel: "Waiting",
      currentAction: openDecision.header,
      completedItems,
      metricRunId: openDecision.runId,
      blocker:
        "The run has ended. Record an answer to unlock a linked continuation.",
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }
  const activeRun = source.runs.find(
    (run) => run.id === source.thread.currentRunId && run.status === "running",
  );
  if (activeRun) {
    const recovery = recoveryNarrative(source, completedItems);
    if (recovery?.phase === "working" && recovery.metricRunId === activeRun.id)
      return recovery;
  }
  if (activeRun)
    return inactiveNarrative(
      source,
      runProgress,
      completedItems,
      undefined,
      runningStep,
      nextStep,
    );
  const settlement = settlementNarrative(source, completedItems);
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
  const latestRun = source.runs.at(-1);
  if (latestRun?.status === "running")
    return {
      phase: "working",
      phaseLabel: "Working",
      currentAction:
        runProgress.currentAction ?? "Model is preparing the next action",
      completedItems,
      metricRunId: latestRun.id,
    };
  if (latestRun && latestRun.status !== "queued") {
    return {
      phase: latestRun.status === "failed" ? "failed" : "ended",
      phaseLabel: latestRun.status === "failed" ? "Needs review" : "Run ended",
      currentAction: "Run ended; objective acceptance is unverified",
      completedItems,
      metricRunId: latestRun.id,
      nextStep:
        nextStep?.title ?? "Inspect the result and its verification evidence.",
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
  completedItems: string[],
): TaskNarrativeProjection | undefined {
  const run = source.runs.at(-1);
  if (run?.outcome === "paused_budget" || run?.outcome === "partial") {
    const partial = run.outcome === "partial";
    return {
      phase: "waiting",
      phaseLabel: partial ? "Partial" : "Paused",
      ...(partial && run.error ? { blocker: run.error } : {}),
      currentAction: partial
        ? "Partial result preserved after the run stopped"
        : "Run paused at its budget boundary",
      completedItems,
      metricRunId: run.id,
      nextStep: partial
        ? "Continue from preserved artifacts and open work."
        : "Continue from the recorded progress.",
    };
  }
  return recoveryNarrative(source, completedItems);
}

function recoveryNarrative(
  source: TaskNarrativeSource,
  completedItems: string[],
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
  const recoveredItems = completedItems;
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
      phase: "ended",
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
