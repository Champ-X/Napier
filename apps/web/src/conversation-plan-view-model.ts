import type { ExecutionPlan, PlanStep, RunEvent } from "@napier/contracts";

export interface ConversationPlan {
  id: string;
  seq: number;
  createdAt: string;
  plan: ExecutionPlan;
  completedStepCount: number;
  settledStepCount: number;
  runningStep?: PlanStep;
  blockedStep?: PlanStep;
  nextStep?: PlanStep;
  verifiedArtifactCount: number;
  producedArtifactCount: number;
  missingArtifactCount: number;
}

const PLAN_TIMELINE_EVENT =
  /^plan\.(created|replanned|step\.(started|completed|blocked|skipped|reopened))$/u;

export function conversationPlans(
  events: RunEvent[],
  plans: ExecutionPlan[],
  limit = 4,
): ConversationPlan[] {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const latestByPlan = new Map<string, ConversationPlan>();
  for (const event of events) {
    const planId = conversationPlanEventId(event);
    if (!planId) continue;
    const plan = plansById.get(planId);
    if (!plan) continue;
    latestByPlan.set(planId, projectConversationPlan(event, plan));
  }
  return [...latestByPlan.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationPlanEventId(event: RunEvent): string | undefined {
  if (
    event.visibility !== "user" ||
    !PLAN_TIMELINE_EVENT.test(event.type) ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const planId = event.payload["planId"];
  return typeof planId === "string" && /^plan_[a-z0-9]{8,80}$/u.test(planId)
    ? planId
    : undefined;
}

function projectConversationPlan(
  event: RunEvent,
  plan: ExecutionPlan,
): ConversationPlan {
  return {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    plan,
    completedStepCount: plan.steps.filter(
      (step) => step.status === "completed",
    ).length,
    settledStepCount: plan.steps.filter(
      (step) => step.status === "completed" || step.status === "skipped",
    ).length,
    ...optionalStep(
      "runningStep",
      plan.steps.find((step) => step.status === "running"),
    ),
    ...optionalStep(
      "blockedStep",
      plan.steps.find((step) => step.status === "blocked"),
    ),
    ...optionalStep(
      "nextStep",
      plan.steps.find((step) => step.status === "ready"),
    ),
    verifiedArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "verified",
    ).length,
    producedArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "produced",
    ).length,
    missingArtifactCount: plan.artifacts.filter(
      (artifact) => artifact.status === "missing",
    ).length,
  };
}

function optionalStep<Key extends "runningStep" | "blockedStep" | "nextStep">(
  key: Key,
  step: PlanStep | undefined,
): Partial<Record<Key, PlanStep>> {
  return step ? ({ [key]: step } as Record<Key, PlanStep>) : {};
}
