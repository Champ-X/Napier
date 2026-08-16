import type {
  ExecutionPlan,
  PlanStep,
  TransitionPlanStepRequest,
} from "@napier/contracts";

import { nowIso } from "./ids.js";

export const PARTIAL_PLAN_STEP: unique symbol = Symbol(
  "napier.partial-plan-step",
);

export type InternalPlanStepRequest =
  | TransitionPlanStepRequest
  | {
      action: typeof PARTIAL_PLAN_STEP;
      runId: string;
      evidence: string;
    };

export const PLAN_STEP_STATUSES = new Set<PlanStep["status"]>([
  "pending",
  "ready",
  "running",
  "partial",
  "completed",
  "blocked",
  "skipped",
]);

const TERMINAL_STEP_STATUSES = new Set<PlanStep["status"]>([
  "partial",
  "completed",
  "blocked",
  "skipped",
]);

export function applyPlanStepTransition(
  plan: ExecutionPlan,
  stepId: string,
  request: InternalPlanStepRequest,
): ExecutionPlan {
  if (plan.status === "cancelled") {
    throw new Error("Cancelled plans cannot transition");
  }
  const current = plan.steps.find((candidate) => candidate.id === stepId);
  if (!current) throw new Error(`Plan step not found: ${stepId}`);
  if (
    TERMINAL_STEP_STATUSES.has(current.status) &&
    request.action !== "reopen"
  ) {
    return plan;
  }
  const next = structuredClone(plan);
  const step = next.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Plan step not found: ${stepId}`);
  const timestamp = nowIso();
  if (request.action === "start") {
    startStep(step, request.runId, timestamp);
  } else if (request.action === "complete") {
    completeStep(step, request.evidence, timestamp);
  } else if (request.action === "block") {
    blockStep(step, request.blocker, request.evidence, timestamp);
  } else if (request.action === "skip") {
    skipStep(step, request.evidence, timestamp);
  } else if (request.action === PARTIAL_PLAN_STEP) {
    partialStep(step, request.runId, request.evidence, timestamp);
  } else {
    reopenStep(next, step);
  }
  step.updatedAt = timestamp;
  return next;
}

function startStep(
  step: PlanStep,
  runId: string | undefined,
  timestamp: string,
): void {
  if (step.status !== "ready") {
    throw new Error(`Cannot start plan step in ${step.status} state`);
  }
  step.status = "running";
  step.startedAt = timestamp;
  if (runId) step.runId = runId;
}

function completeStep(
  step: PlanStep,
  evidenceInput: string | undefined,
  timestamp: string,
): void {
  if (step.status !== "running") {
    throw new Error(`Cannot complete plan step in ${step.status} state`);
  }
  const evidence = text(evidenceInput, 2_000);
  if (!evidence) throw new Error("Completed plan steps require evidence");
  step.status = "completed";
  step.evidence = evidence;
  step.finishedAt = timestamp;
}

function blockStep(
  step: PlanStep,
  blockerInput: string | undefined,
  evidenceInput: string | undefined,
  timestamp: string,
): void {
  if (step.status !== "ready" && step.status !== "running") {
    throw new Error(`Cannot block plan step in ${step.status} state`);
  }
  const blocker = text(blockerInput, 1_000);
  if (!blocker) throw new Error("Blocked plan steps require a blocker");
  step.status = "blocked";
  step.blocker = blocker;
  step.evidence = text(evidenceInput, 2_000);
  step.finishedAt = timestamp;
}

function skipStep(
  step: PlanStep,
  evidenceInput: string | undefined,
  timestamp: string,
): void {
  if (!["pending", "ready", "blocked"].includes(step.status)) {
    throw new Error(`Cannot skip plan step in ${step.status} state`);
  }
  const evidence = text(evidenceInput, 2_000);
  if (!evidence) throw new Error("Skipped plan steps require evidence");
  step.status = "skipped";
  step.evidence = evidence;
  delete step.blocker;
  step.finishedAt = timestamp;
}

function partialStep(
  step: PlanStep,
  runId: string,
  evidenceInput: string,
  timestamp: string,
): void {
  if (step.status !== "running" || step.runId !== runId) {
    throw new Error("Only the owning running Plan step can become partial");
  }
  const evidence = text(evidenceInput, 2_000);
  if (!evidence) throw new Error("Partial plan steps require evidence");
  step.status = "partial";
  step.evidence = evidence;
  delete step.blocker;
  step.finishedAt = timestamp;
}

function reopenStep(plan: ExecutionPlan, step: PlanStep): void {
  if (!TERMINAL_STEP_STATUSES.has(step.status)) {
    throw new Error(`Cannot reopen plan step in ${step.status} state`);
  }
  step.status = dependenciesSatisfied(plan, step) ? "ready" : "pending";
  step.evidence = "";
  delete step.blocker;
  delete step.runId;
  delete step.startedAt;
  delete step.finishedAt;
}

function dependenciesSatisfied(plan: ExecutionPlan, step: PlanStep): boolean {
  return step.dependsOn.every((dependencyId) => {
    const dependency = plan.steps.find(
      (candidate) => candidate.id === dependencyId,
    );
    return (
      dependency?.status === "completed" || dependency?.status === "skipped"
    );
  });
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
