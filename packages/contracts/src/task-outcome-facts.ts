import type { ThreadDetail } from "./workspace-bootstrap-v1.js";
type TaskNarrativeSource = Pick<ThreadDetail, "thread" | "runs" | "plans">;

type Narrative = NonNullable<ThreadDetail["taskNarrative"]>;

/** Derive task facts from existing run, plan and goal records. No ledger mutation. */
export function taskOutcomeFacts(
  source: TaskNarrativeSource,
  narrative: Narrative,
): Pick<Narrative, "execution" | "objective" | "remainingItems"> &
  Partial<Narrative> {
  const run =
    source.runs.find((entry) => entry.id === source.thread.currentRunId) ??
    source.runs.at(-1);
  const openPlans = source.plans.filter(
    (plan) => plan.status === "active" || plan.status === "blocked",
  );
  const remainingItems = openPlans.flatMap((plan) =>
    plan.steps
      .filter(
        (step) => step.status !== "completed" && step.status !== "skipped",
      )
      .map((step) => step.title),
  );
  const goal = source.thread.goal;
  const currentGoal = goal?.lastEvaluatedRunId === run?.id ? goal : undefined;
  const hasProgress = source.plans.some((plan) =>
    plan.steps.some(
      (step) => step.status === "completed" || step.status === "partial",
    ),
  );
  const objective: NonNullable<Narrative["objective"]> = {
    status:
      remainingItems.length > 0 || run?.outcome === "partial"
        ? "partial"
        : currentGoal?.blocker === "missing_evidence"
          ? "indeterminate"
          : "unverified",
    reason:
      remainingItems.length > 0
        ? "Planned work remains unfinished."
        : "Independent objective acceptance has not been recorded.",
    // A goal evaluator reads conversation text. It is a model assessment,
    // not an independent grader; neither it nor an Artifact hash accepts a task.
    evidence: [],
  };
  if (!hasProgress && remainingItems.length > 0 && !run)
    objective.status = "unverified";
  const execution = executionStatus(run, narrative);
  const unfinished = narrative.phase === "ended" && remainingItems.length > 0;
  return {
    execution,
    objective,
    remainingItems,
    ...(unfinished
      ? {
          phase: "ended" as const,
          phaseLabel: "Work remains",
          currentAction: "This run ended; unfinished work remains",
          nextStep: remainingItems[0],
        }
      : {}),
  };
}

function executionStatus(
  run: ThreadDetail["runs"][number] | undefined,
  narrative: Narrative,
): NonNullable<Narrative["execution"]> {
  if (narrative.phase === "working") return "running";
  if (narrative.phase === "waiting") {
    return run?.outcome === "paused_budget" || run?.outcome === "partial"
      ? "paused"
      : "waiting";
  }
  if (run?.status === "queued" || !run) return "queued";
  if (run.status === "failed") return "failed";
  if (run.status === "interrupted") return "paused";
  return "ended";
}
