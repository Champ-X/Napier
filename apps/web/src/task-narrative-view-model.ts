import type { RunEvent, ThreadDetail } from "@napier/contracts";

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
  nextStep?: string;
  blocker?: string;
}

export function taskNarrative(
  detail: Pick<
    ThreadDetail,
    "thread" | "runs" | "plans" | "events" | "operatorDecisions"
  > | undefined,
): TaskNarrative {
  if (!detail) return baseNarrative("ready", "Ready", "Choose or create a ledger");
  const openDecision = detail.operatorDecisions.findLast(
    (decision) => decision.status === "pending" || decision.status === "answered",
  );
  const plan = detail.plans.findLast(
    (candidate) => candidate.status === "active" || candidate.status === "blocked",
  );
  const runningStep = plan?.steps.find((step) => step.status === "running");
  const blockedStep = plan?.steps.find((step) => step.status === "blocked");
  const nextStep = plan?.steps.find((step) => step.status === "ready");
  const completedItems =
    plan?.steps
      .filter((step) => step.status === "completed")
      .slice(-3)
      .map((step) => step.title) ?? [];

  if (openDecision) {
    return {
      phase: "waiting",
      phaseLabel: "Waiting",
      currentAction: openDecision.header,
      completedItems,
      blocker: "Operator input is required before the run can continue.",
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }
  if (blockedStep || detail.thread.status === "failed") {
    const blocker =
      blockedStep?.blocker ||
      detail.runs.findLast((run) => run.status === "failed")?.error ||
      "The latest run needs review.";
    return {
      phase: detail.thread.status === "failed" ? "failed" : "blocked",
      phaseLabel: detail.thread.status === "failed" ? "Needs review" : "Blocked",
      currentAction: blockedStep?.title ?? "Review the failed run",
      completedItems,
      blocker,
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }

  const running = detail.runs.find(
    (run) =>
      run.id === detail.thread.currentRunId && run.status === "running",
  );
  if (running) {
    return {
      phase: "working",
      phaseLabel: "Working",
      currentAction:
        runningStep?.title ??
        latestToolAction(detail.events, running.id) ??
        "Model is preparing the next action",
      completedItems,
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
      nextStep: "Start a follow-up task or inspect the evidence.",
    };
  }
  return baseNarrative(
    "ready",
    "Ready",
    nextStep ? `Ready to start: ${nextStep.title}` : "Describe the task to begin",
  );
}

function latestToolAction(
  events: RunEvent[],
  runId: string,
): string | undefined {
  const event = events.findLast(
    (candidate) =>
      candidate.runId === runId &&
      candidate.type === "tool.started" &&
      candidate.visibility !== "hidden",
  );
  const toolName = event ? payloadString(event.payload, "toolName") : undefined;
  return toolName ? `Running ${humanize(toolName)}` : undefined;
}

function baseNarrative(
  phase: TaskNarrativePhase,
  phaseLabel: string,
  currentAction: string,
): TaskNarrative {
  return { phase, phaseLabel, currentAction, completedItems: [] };
}

function payloadString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
