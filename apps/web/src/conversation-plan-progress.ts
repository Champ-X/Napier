import type { ThreadDetail } from "@napier/contracts";

export type ConversationPlanProgressStep = NonNullable<
  ThreadDetail["conversationPlans"]
>[number]["plan"]["steps"][number] & { current: boolean };

export interface ConversationPlanProgress {
  planId: string;
  objective: string;
  currentStepNumber: number;
  stepCount: number;
  settledStepCount: number;
  steps: ConversationPlanProgressStep[];
}

type PlanProgressDetail = Pick<
  ThreadDetail,
  "activePlan" | "plans" | "conversationPlans"
>;

export function conversationPlanProgress(
  detail: PlanProgressDetail | undefined,
  isRunning: boolean,
): ConversationPlanProgress | undefined {
  const active = detail?.activePlan;
  if (!isRunning || !active || active.stepCount < 1) return undefined;
  const canonicalPlan = detail.plans.find(
    (candidate) => candidate.id === active.planId,
  );
  const projectedPlan = detail.conversationPlans
    ?.filter((candidate) => candidate.plan.id === active.planId)
    .at(-1);
  // Stream projections advance on every Plan event, while detail.plans is
  // refreshed only by snapshots. Prefer the projection for live status.
  const sourceSteps = projectedPlan?.plan.steps ?? canonicalPlan?.steps ?? [];
  const currentStepId =
    active.runningStep?.id ??
    active.blockedStep?.id ??
    active.nextStep?.id ??
    sourceSteps.find((step) => step.status === "running")?.id ??
    sourceSteps.find((step) => step.status === "blocked")?.id ??
    sourceSteps.find((step) => step.status === "ready")?.id;
  const sourceIndex = currentStepId
    ? sourceSteps.findIndex((step) => step.id === currentStepId)
    : -1;
  const fallbackIndex =
    active.status === "completed"
      ? active.stepCount - 1
      : Math.min(active.settledStepCount, active.stepCount - 1);
  const currentIndex = sourceIndex >= 0 ? sourceIndex : fallbackIndex;
  const steps = sourceSteps.map((step, index) => ({
    id: step.id,
    title: step.title,
    status: step.status,
    evidenceRecorded: Boolean(
      "evidence" in step ? step.evidence : step.evidenceRecorded,
    ),
    ...(step.blocker ? { blocker: step.blocker } : {}),
    current: index === currentIndex,
  }));

  return {
    planId: active.planId,
    objective: active.objective,
    currentStepNumber: currentIndex + 1,
    stepCount: active.stepCount,
    settledStepCount: active.settledStepCount,
    steps,
  };
}
