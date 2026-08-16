import type { ExecutionPlan, RunEvent, ThreadDetail } from "@napier/contracts";

export type ActivePlanProjection = NonNullable<ThreadDetail["activePlan"]>;

export function projectActivePlan(
  plans: readonly ExecutionPlan[],
  eventWatermark: number,
): ActivePlanProjection | undefined {
  const plan =
    plans.findLast((candidate) => candidate.status === "active") ??
    plans.findLast((candidate) => candidate.status === "blocked") ??
    plans.findLast((candidate) => candidate.status === "completed");
  if (!plan) return undefined;
  const outputPaths = plan.artifacts
    .filter(
      (artifact) =>
        artifact.kind === "file" &&
        (artifact.status === "produced" || artifact.status === "verified"),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 2)
    .map((artifact) => artifact.path);
  return {
    planId: plan.id,
    revision: plan.revision,
    status: plan.status,
    objective: plan.objective,
    completedStepCount: plan.steps.filter((step) => step.status === "completed")
      .length,
    settledStepCount: plan.steps.filter(
      (step) => step.status === "completed" || step.status === "skipped",
    ).length,
    stepCount: plan.steps.length,
    ...step("runningStep", plan, "running"),
    ...step("blockedStep", plan, "blocked"),
    ...step("nextStep", plan, "ready"),
    verifiedArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "verified",
    ).length,
    producedArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "produced",
    ).length,
    missingArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "missing",
    ).length,
    outputPaths,
    activePhaseIndex: plan.activePhaseIndex,
    phaseCount: plan.phaseWaves.length,
    eventWatermark,
  };
}

export function activePlanEventWatermark(
  current: number,
  event: RunEvent,
): number {
  return event.type.startsWith("plan.") ? event.seq : current;
}

export function projectActivePlanEventWatermark(
  events: readonly RunEvent[],
): number {
  return events.reduce(activePlanEventWatermark, 0);
}

function step<
  Key extends "runningStep" | "blockedStep" | "nextStep",
  Status extends "running" | "blocked" | "ready",
>(
  key: Key,
  plan: ExecutionPlan,
  status: Status,
): Partial<Record<Key, ExecutionPlan["steps"][number]>> {
  const value = plan.steps.find((candidate) => candidate.status === status);
  return value
    ? ({ [key]: structuredClone(value) } as Record<
        Key,
        ExecutionPlan["steps"][number]
      >)
    : {};
}
