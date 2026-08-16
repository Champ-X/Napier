import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadDetail,
} from "@napier/contracts";
import {
  currentRunAttempt,
  projectRunIntentIds,
  runIdsBelongToCurrentAttempt,
} from "./run-intent-id";

export type ConversationPlan = NonNullable<
  ThreadDetail["conversationPlans"]
>[number];

const PLAN_TIMELINE_EVENT =
  /^plan\.(created|replanned|step\.(started|completed|blocked|skipped|reopened))$/u;

export function conversationPlans(
  events: RunEvent[],
  plans: ExecutionPlan[],
  limit = 4,
  runs: RunRecord[] = [],
  activePlan?: import("@napier/contracts").ThreadDetail["activePlan"],
): ConversationPlan[] {
  const intentIds = projectRunIntentIds(events);
  const attempt = currentRunAttempt(runs, events, intentIds);
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const latestByPlan = new Map<string, ConversationPlan>();
  for (const event of events) {
    const planId = conversationPlanEventId(event);
    if (!planId) continue;
    const plan = plansById.get(planId);
    if (!plan) continue;
    latestByPlan.set(
      planId,
      projectConversationPlan(
        event,
        plan,
        attemptScope(event, plan, attempt, intentIds),
        plan.id === activePlan?.planId ? activePlan : undefined,
      ),
    );
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
  attemptScope: ConversationPlan["attemptScope"],
  projected?: import("@napier/contracts").ThreadDetail["activePlan"],
): ConversationPlan {
  return {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    attemptScope,
    plan: {
      id: plan.id,
      status: plan.status,
      revision: plan.revision,
      objective: plan.objective,
      steps: plan.steps.map(stepView),
      activePhaseIndex: plan.activePhaseIndex,
      phaseCount: plan.phaseWaves.length,
    },
    completedStepCount:
      projected?.completedStepCount ??
      plan.steps.filter((step) => step.status === "completed").length,
    settledStepCount:
      projected?.settledStepCount ??
      plan.steps.filter(
        (step) => step.status === "completed" || step.status === "skipped",
      ).length,
    ...optionalStep(
      "runningStep",
      projected?.runningStep ??
        plan.steps.find((step) => step.status === "running"),
    ),
    ...optionalStep(
      "blockedStep",
      projected?.blockedStep ??
        plan.steps.find((step) => step.status === "blocked"),
    ),
    ...optionalStep(
      "nextStep",
      projected?.nextStep ?? plan.steps.find((step) => step.status === "ready"),
    ),
    verifiedArtifactCount:
      projected?.verifiedArtifactCount ??
      plan.artifacts.filter((artifact) => artifact.status === "verified")
        .length,
    producedArtifactCount:
      projected?.producedArtifactCount ??
      plan.artifacts.filter((artifact) => artifact.status === "produced")
        .length,
    missingArtifactCount:
      projected?.missingArtifactCount ??
      plan.artifacts.filter((artifact) => artifact.status === "missing").length,
  };
}

function attemptScope(
  event: RunEvent,
  plan: ExecutionPlan,
  current: ReturnType<typeof currentRunAttempt>,
  intentIds: ReadonlyMap<string, string>,
): ConversationPlan["attemptScope"] {
  return runIdsBelongToCurrentAttempt(
    [
      event.runId,
      ...plan.steps.flatMap((step) => (step.runId ? [step.runId] : [])),
      ...plan.artifacts.flatMap((artifact) =>
        artifact.sourceRunId ? [artifact.sourceRunId] : [],
      ),
    ],
    current,
    intentIds,
  )
    ? "current"
    : "previous";
}

function optionalStep<Key extends "runningStep" | "blockedStep" | "nextStep">(
  key: Key,
  step: ExecutionPlan["steps"][number] | undefined,
): Partial<Record<Key, ConversationPlan[Key]>> {
  return step
    ? ({ [key]: stepView(step) } as Record<Key, ConversationPlan[Key]>)
    : {};
}

function stepView(
  step: ExecutionPlan["steps"][number],
): ConversationPlan["plan"]["steps"][number] {
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    evidenceRecorded: Boolean(step.evidence),
    ...(step.blocker ? { blocker: step.blocker } : {}),
  };
}
