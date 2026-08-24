import type {
  ExecutionPlan,
  ExecutionPlanStatus,
  GoalState,
  PlanStep,
  PlanStepStatus,
  ThreadDetail,
} from "@napier/contracts";

/**
 * A single scannable step in the task overview. The projection keeps only the
 * fields the overview renders so the view stays independent of the full
 * {@link PlanStep} record shape.
 */
export interface TaskOverviewStep {
  id: string;
  title: string;
  description: string;
  status: PlanStepStatus;
  blocker?: string;
}

/**
 * Source-agnostic overview model (design §9.3). Establishes one objective
 * title, a compact progress line, a single expanded current step, and folded
 * completed/upcoming history. Pure: no locale, DOM, or copy access.
 */
export interface TaskOverviewModel {
  objective: string;
  hasObjective: boolean;
  hasPlan: boolean;
  status?: ExecutionPlanStatus;
  completedStepCount: number;
  stepCount: number;
  artifactCount: number;
  currentStep?: TaskOverviewStep;
  completedSteps: TaskOverviewStep[];
  upcomingSteps: TaskOverviewStep[];
  canContinue: boolean;
}

type OverviewDetail = Pick<ThreadDetail, "thread" | "plans" | "activePlan">;

const UPCOMING_STATUSES: ReadonlySet<PlanStepStatus> = new Set([
  "ready",
  "pending",
]);

export function deriveTaskOverview(
  detail: OverviewDetail | undefined,
  goal: GoalState | undefined,
): TaskOverviewModel {
  const plan = activeExecutionPlan(detail);
  const progress = detail?.activePlan;
  const steps = plan?.steps ?? [];
  const objective =
    progress?.objective ||
    plan?.objective ||
    goal?.objective ||
    detail?.thread.title ||
    "";
  const currentStepId =
    progress?.runningStep?.id ??
    progress?.blockedStep?.id ??
    progress?.nextStep?.id ??
    fallbackCurrentStep(steps)?.id;
  const currentStep = resolveCurrentStep(steps, progress, currentStepId);
  const completedSteps = steps
    .filter((step) => step.status === "completed")
    .map(projectStep);
  const upcomingSteps = steps
    .filter(
      (step) =>
        step.id !== currentStepId && UPCOMING_STATUSES.has(step.status),
    )
    .map(projectStep);

  const status = progress?.status ?? plan?.status;

  return {
    objective,
    hasObjective: objective.length > 0,
    hasPlan: Boolean(plan),
    ...(status ? { status } : {}),
    completedStepCount: progress?.completedStepCount ?? completedSteps.length,
    stepCount: progress?.stepCount ?? steps.length,
    artifactCount:
      (progress?.verifiedArtifactCount ?? 0) +
      (progress?.producedArtifactCount ?? 0),
    ...(currentStep ? { currentStep } : {}),
    completedSteps,
    upcomingSteps,
    canContinue: Boolean(progress?.nextStep),
  };
}

function activeExecutionPlan(
  detail: OverviewDetail | undefined,
): ExecutionPlan | undefined {
  return (
    detail?.plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? detail?.plans.at(-1)
  );
}

function fallbackCurrentStep(steps: PlanStep[]): PlanStep | undefined {
  return (
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "blocked") ??
    steps.find((step) => step.status === "ready") ??
    steps.find((step) => step.status === "pending")
  );
}

function resolveCurrentStep(
  steps: PlanStep[],
  progress: OverviewDetail["activePlan"],
  currentStepId: string | undefined,
): TaskOverviewStep | undefined {
  const fromSteps = currentStepId
    ? steps.find((step) => step.id === currentStepId)
    : undefined;
  if (fromSteps) return projectStep(fromSteps);
  const projected =
    progress?.runningStep ?? progress?.blockedStep ?? progress?.nextStep;
  return projected ? projectStep(projected) : undefined;
}

function projectStep(step: PlanStep): TaskOverviewStep {
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    status: step.status,
    ...(step.blocker ? { blocker: step.blocker } : {}),
  };
}
