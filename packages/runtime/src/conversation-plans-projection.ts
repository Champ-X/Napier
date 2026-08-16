import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadDetail,
} from "@napier/contracts";

import { projectRunIntents } from "./run-intents.js";

export type ConversationPlan = NonNullable<
  ThreadDetail["conversationPlans"]
>[number];

interface PlanEventBinding {
  id: string;
  seq: number;
  createdAt: string;
  runId: string;
  planId: string;
}

export interface ConversationPlanEventState {
  latest: Record<string, PlanEventBinding>;
  intentIds: Record<string, string>;
  latestRunId?: string;
}

const PLAN_TIMELINE_EVENT =
  /^plan\.(created|replanned|step\.(started|completed|blocked|skipped|reopened))$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const MAX_PLANS = 4;
const MAX_INTENTS = 256;

export function createConversationPlanEventState(): ConversationPlanEventState {
  return { latest: {}, intentIds: {} };
}

export function applyConversationPlanEvent(
  source: ConversationPlanEventState,
  event: RunEvent,
): ConversationPlanEventState {
  const state = structuredClone(source);
  state.latestRunId = event.runId;
  const intentId = projectRunIntents([event]).get(event.runId);
  if (intentId) {
    delete state.intentIds[event.runId];
    state.intentIds[event.runId] = intentId;
    const runIds = Object.keys(state.intentIds);
    for (const runId of runIds.slice(0, -MAX_INTENTS)) {
      delete state.intentIds[runId];
    }
  }
  const planId = conversationPlanEventId(event);
  if (!planId) return state;
  state.latest[planId] = {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    runId: event.runId,
    planId,
  };
  const retained = Object.values(state.latest)
    .sort((left, right) => left.seq - right.seq)
    .slice(-MAX_PLANS);
  state.latest = Object.fromEntries(
    retained.map((binding) => [binding.planId, binding]),
  );
  return state;
}

export function projectConversationPlans(
  plans: readonly ExecutionPlan[],
  runs: readonly RunRecord[],
  state: ConversationPlanEventState,
  activePlan?: ThreadDetail["activePlan"],
): ConversationPlan[] {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const currentRunId = runs.at(-1)?.id ?? state.latestRunId;
  const currentIntentId = currentRunId
    ? state.intentIds[currentRunId]
    : undefined;
  return Object.values(state.latest)
    .flatMap((binding): ConversationPlan[] => {
      const plan = plansById.get(binding.planId);
      if (!plan) return [];
      const runIds = [
        binding.runId,
        ...plan.steps.flatMap((step) => (step.runId ? [step.runId] : [])),
        ...plan.artifacts.flatMap((artifact) =>
          artifact.sourceRunId ? [artifact.sourceRunId] : [],
        ),
      ];
      const current = runIds.some(
        (runId) =>
          runId === currentRunId ||
          (currentIntentId !== undefined &&
            state.intentIds[runId] === currentIntentId),
      );
      return [
        planView(
          binding,
          plan,
          current ? "current" : "previous",
          plan.id === activePlan?.planId ? activePlan : undefined,
        ),
      ];
    })
    .sort((left, right) => left.seq - right.seq);
}

export function conversationPlanEventId(event: RunEvent): string | undefined {
  if (
    event.visibility !== "user" ||
    !PLAN_TIMELINE_EVENT.test(event.type) ||
    !record(event.payload)
  ) {
    return undefined;
  }
  const planId = event.payload["planId"];
  return typeof planId === "string" && PLAN_ID.test(planId)
    ? planId
    : undefined;
}

function planView(
  binding: PlanEventBinding,
  plan: ExecutionPlan,
  attemptScope: ConversationPlan["attemptScope"],
  projected?: ThreadDetail["activePlan"],
): ConversationPlan {
  return {
    id: binding.id,
    seq: binding.seq,
    createdAt: binding.createdAt,
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
    ...step(
      "runningStep",
      projected?.runningStep ??
        plan.steps.find((candidate) => candidate.status === "running"),
    ),
    ...step(
      "blockedStep",
      projected?.blockedStep ??
        plan.steps.find((candidate) => candidate.status === "blocked"),
    ),
    ...step(
      "nextStep",
      projected?.nextStep ??
        plan.steps.find((candidate) => candidate.status === "ready"),
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

function step<Key extends "runningStep" | "blockedStep" | "nextStep">(
  key: Key,
  value: ExecutionPlan["steps"][number] | undefined,
): Partial<Record<Key, ConversationPlan[Key]>> {
  return value
    ? ({ [key]: stepView(value) } as Record<Key, ConversationPlan[Key]>)
    : {};
}

function stepView(
  value: ExecutionPlan["steps"][number],
): ConversationPlan["plan"]["steps"][number] {
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    evidenceRecorded: Boolean(value.evidence),
    ...(value.blocker ? { blocker: value.blocker } : {}),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
