import type { ThreadDetail } from "@napier/contracts";

const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const PLAN_STATUS = /^(active|completed|blocked|cancelled)$/u;
const STEP_STATUS =
  /^(pending|ready|running|partial|completed|blocked|skipped)$/u;

export function isConversationPlans(
  value: unknown,
): value is NonNullable<ThreadDetail["conversationPlans"]> {
  return (
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every((item) => valid(item))
  );
}

function valid(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    exact(
      value,
      [
        "id",
        "seq",
        "createdAt",
        "attemptScope",
        "plan",
        "completedStepCount",
        "settledStepCount",
        "verifiedArtifactCount",
        "producedArtifactCount",
        "missingArtifactCount",
      ],
      ["runningStep", "blockedStep", "nextStep"],
    ) &&
    text(value.id) &&
    integer(value.seq, 1) &&
    text(value.createdAt) &&
    (value.attemptScope === "current" || value.attemptScope === "previous") &&
    plan(value.plan) &&
    integer(value.completedStepCount, 0) &&
    integer(value.settledStepCount, Number(value.completedStepCount)) &&
    optionalStep(value.runningStep) &&
    optionalStep(value.blockedStep) &&
    optionalStep(value.nextStep) &&
    [
      value.verifiedArtifactCount,
      value.producedArtifactCount,
      value.missingArtifactCount,
    ].every((count) => integer(count, 0))
  );
}

function plan(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    exact(value, [
      "id",
      "status",
      "revision",
      "objective",
      "steps",
      "activePhaseIndex",
      "phaseCount",
    ]) &&
    typeof value.id === "string" &&
    PLAN_ID.test(value.id) &&
    typeof value.status === "string" &&
    PLAN_STATUS.test(value.status) &&
    integer(value.revision, 1) &&
    text(value.objective) &&
    Array.isArray(value.steps) &&
    value.steps.every(step) &&
    (value.activePhaseIndex === null || integer(value.activePhaseIndex, 0)) &&
    integer(value.phaseCount, 0)
  );
}

function optionalStep(value: unknown): boolean {
  return value === undefined || step(value);
}

function step(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    exact(value, ["id", "title", "status", "evidenceRecorded"], ["blocker"]) &&
    text(value.id) &&
    text(value.title) &&
    typeof value.status === "string" &&
    STEP_STATUS.test(value.status) &&
    typeof value.evidenceRecorded === "boolean" &&
    (value.blocker === undefined || text(value.blocker))
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
