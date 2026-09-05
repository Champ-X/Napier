import path from "node:path";

import type {
  ArtifactManifestEntry,
  CreateExecutionPlanRequest,
  ExecutionPlan,
  ExecutionPlanPhaseWave,
  ExecutionPlanReplanDraftEvaluation,
  ExecutionPlanReplanDraftEvaluationCheck,
  ExecutionPlanReplanPolicyPosture,
  ExecutionPlanReplanRecommendation,
  ExecutionPlanReplanRecord,
  JsonValue,
  PlanStep,
  ReplanExecutionPlanRequest,
  RunEvent,
  UpdateArtifactManifestRequest,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import {
  isPlanArtifactProjectionPayloadValid,
  PLAN_ARTIFACT_EVENT_PROJECTION_KEYS,
} from "./plan-artifact-event-projection.js";
import { runPlanProgressEventPayload } from "./run-progress-plan-state.js";
import { artifactRequiresEvidence } from "./artifact-status.js";
import {
  applyPlanStepTransition,
  type InternalPlanStepRequest,
} from "./plan-step-transition.js";
export type { InternalPlanStepRequest } from "./plan-step-transition.js";

const MAX_PLAN_STEPS = 30;
const MAX_PLAN_ARTIFACTS = 30;
const MAX_PLAN_REPLANS = 20;
const PLAN_REPLAN_DRAFT_POLICY_ID = "napier.plan-replan-draft.v1";
type PlanProjectionInput = Omit<
  ExecutionPlan,
  | "replans"
  | "replanRecommendation"
  | "criticalPathStepIds"
  | "readyStepIds"
  | "blockedStepIds"
  | "phaseWaves"
  | "activePhaseIndex"
  | "parallelReadyStepIds"
  | "phaseProjectionSha256"
> &
  Partial<
    Pick<
      ExecutionPlan,
      | "replans"
      | "replanRecommendation"
      | "criticalPathStepIds"
      | "readyStepIds"
      | "blockedStepIds"
      | "phaseWaves"
      | "activePhaseIndex"
      | "parallelReadyStepIds"
      | "phaseProjectionSha256"
    >
  >;

export function createExecutionPlan(
  threadId: string,
  request: CreateExecutionPlanRequest,
): ExecutionPlan {
  const objective = normalizeText(request.objective, 4_000);
  if (!objective) throw new Error("Plan objective is required");
  if (request.steps.length < 1 || request.steps.length > MAX_PLAN_STEPS) {
    throw new Error(`Plans require 1 to ${MAX_PLAN_STEPS} steps`);
  }
  const timestamp = nowIso();
  const ids = new Set<string>();
  const steps = request.steps.map((input): PlanStep => {
    const id = normalizeEntityId(input.id, "step");
    if (ids.has(id)) throw new Error(`Duplicate plan step ID: ${id}`);
    ids.add(id);
    const title = normalizeText(input.title, 120);
    const description = normalizeText(input.description, 1_500);
    const verification = normalizeText(input.verification, 1_000);
    if (!title || !description || !verification) {
      throw new Error(
        "Plan steps require title, description, and verification",
      );
    }
    return {
      id,
      title,
      description,
      verification,
      dependsOn: [...new Set(input.dependsOn ?? [])],
      status: "pending",
      evidence: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  validateStepDependencies(steps);
  for (const step of steps) {
    if (step.dependsOn.length === 0) step.status = "ready";
  }

  const artifactIds = new Set<string>();
  const rawArtifacts = request.artifacts ?? [];
  if (rawArtifacts.length > MAX_PLAN_ARTIFACTS) {
    throw new Error(`Plans allow at most ${MAX_PLAN_ARTIFACTS} artifacts`);
  }
  const artifacts = rawArtifacts.map((input): ArtifactManifestEntry => {
    const id = normalizeEntityId(input.id, "artifact");
    if (artifactIds.has(id)) {
      throw new Error(`Duplicate artifact ID: ${id}`);
    }
    artifactIds.add(id);
    const kind = input.kind ?? "file";
    const artifactPath = normalizeArtifactPath(input.path, kind);
    const description = normalizeText(input.description, 1_000);
    if (!description) throw new Error("Artifact description is required");
    return {
      id,
      path: artifactPath,
      kind,
      description,
      status: "expected",
      evidence: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  return refreshPlanProjection({
    id: createId("plan"),
    threadId,
    objective,
    status: "active",
    steps,
    artifacts,
    replans: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function replanExecutionPlan(
  plan: ExecutionPlan,
  request: ReplanExecutionPlanRequest,
): ExecutionPlan {
  if (plan.status === "cancelled" || plan.status === "completed") {
    throw new Error(`Cannot replan a ${plan.status} plan`);
  }
  if (request.expectedRevision !== plan.revision) {
    throw new Error(
      `Plan revision mismatch: expected ${request.expectedRevision}, current ${plan.revision}`,
    );
  }
  const strategy = request.strategy;
  if (
    strategy !== "recover_blocked" &&
    strategy !== "scope_change" &&
    strategy !== "artifact_drift"
  ) {
    throw new Error("Unknown replan strategy");
  }
  const reason = normalizeText(request.reason, 1_000);
  const evidence = normalizeText(request.evidence, 2_000);
  if (!reason || !evidence) {
    throw new Error("Replanning requires reason and evidence");
  }
  const supersedeStepIds = normalizeEntityIdList(
    request.supersedeStepIds,
    "step",
    MAX_PLAN_STEPS,
  );
  const supersedeArtifactIds = normalizeEntityIdList(
    request.supersedeArtifactIds,
    "artifact",
    MAX_PLAN_ARTIFACTS,
  );
  const dependencyUpdates = normalizeDependencyUpdates(
    request.dependencyUpdates,
  );
  const addSteps = request.addSteps ?? [];
  const addArtifacts = request.addArtifacts ?? [];
  if (
    supersedeStepIds.length === 0 &&
    supersedeArtifactIds.length === 0 &&
    dependencyUpdates.length === 0 &&
    addSteps.length === 0 &&
    addArtifacts.length === 0
  ) {
    throw new Error("Replanning requires at least one plan change");
  }

  const next = structuredClone(plan);
  if (!Array.isArray(next.replans)) next.replans = [];
  if (next.replans.length >= MAX_PLAN_REPLANS) {
    throw new Error(`Plans keep at most ${MAX_PLAN_REPLANS} replans`);
  }
  const timestamp = nowIso();
  const replanEvidence = `Replanned (${strategy}): ${evidence}`;

  for (const stepId of supersedeStepIds) {
    const step = next.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`Plan step not found: ${stepId}`);
    if (
      step.status === "running" ||
      step.status === "completed" ||
      step.status === "skipped"
    ) {
      throw new Error(`Cannot supersede plan step in ${step.status} state`);
    }
    step.status = "skipped";
    step.evidence = replanEvidence;
    delete step.blocker;
    delete step.runId;
    delete step.startedAt;
    step.finishedAt = timestamp;
    step.updatedAt = timestamp;
  }

  const existingStepIds = new Set(next.steps.map((step) => step.id));
  if (next.steps.length + addSteps.length > MAX_PLAN_STEPS) {
    throw new Error(`Plans allow at most ${MAX_PLAN_STEPS} steps`);
  }
  const addedStepIds = new Set<string>();
  const newSteps = addSteps.map((input): PlanStep => {
    const id = normalizeEntityId(input.id, "step");
    if (existingStepIds.has(id) || addedStepIds.has(id)) {
      throw new Error(`Duplicate plan step ID: ${id}`);
    }
    addedStepIds.add(id);
    const title = normalizeText(input.title, 120);
    const description = normalizeText(input.description, 1_500);
    const verification = normalizeText(input.verification, 1_000);
    if (!title || !description || !verification) {
      throw new Error(
        "Plan steps require title, description, and verification",
      );
    }
    return {
      id,
      title,
      description,
      verification,
      dependsOn: [...new Set(input.dependsOn ?? [])],
      status: "pending",
      evidence: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  next.steps.push(...newSteps);

  for (const update of dependencyUpdates) {
    const step = next.steps.find((candidate) => candidate.id === update.stepId);
    if (!step) throw new Error(`Plan step not found: ${update.stepId}`);
    if (step.status === "completed" || step.status === "running") {
      throw new Error(`Cannot update dependencies for ${step.status} step`);
    }
    step.dependsOn = update.dependsOn;
    if (step.status === "ready") step.status = "pending";
    step.updatedAt = timestamp;
  }
  validateStepDependencies(next.steps);

  for (const step of next.steps) {
    if (step.status === "ready") step.status = "pending";
  }
  settleReadySteps(next);

  for (const artifactId of supersedeArtifactIds) {
    const artifact = next.artifacts.find(
      (candidate) => candidate.id === artifactId,
    );
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    assertArtifactTransition(artifact.status, "superseded");
    artifact.status = "superseded";
    artifact.evidence = replanEvidence;
    artifact.updatedAt = timestamp;
  }

  const existingArtifactIds = new Set(
    next.artifacts.map((artifact) => artifact.id),
  );
  if (next.artifacts.length + addArtifacts.length > MAX_PLAN_ARTIFACTS) {
    throw new Error(`Plans allow at most ${MAX_PLAN_ARTIFACTS} artifacts`);
  }
  const addedArtifactIds = new Set<string>();
  const newArtifacts = addArtifacts.map((input): ArtifactManifestEntry => {
    const id = normalizeEntityId(input.id, "artifact");
    if (existingArtifactIds.has(id) || addedArtifactIds.has(id)) {
      throw new Error(`Duplicate artifact ID: ${id}`);
    }
    addedArtifactIds.add(id);
    const kind = input.kind ?? "file";
    const artifactPath = normalizeArtifactPath(input.path, kind);
    const description = normalizeText(input.description, 1_000);
    if (!description) throw new Error("Artifact description is required");
    return {
      id,
      path: artifactPath,
      kind,
      description,
      status: "expected",
      evidence: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  next.artifacts.push(...newArtifacts);

  const fromRevision = plan.revision;
  const toRevision = fromRevision + 1;
  const addedStepsSha256 = sha256(
    canonicalJson(newSteps.map((step) => replanStepDigestInput(step))),
  );
  const addedArtifactsSha256 = sha256(
    canonicalJson(
      newArtifacts.map((artifact) => replanArtifactDigestInput(artifact)),
    ),
  );
  const dependencyUpdatesSha256 = sha256(canonicalJson(dependencyUpdates));
  const replanSha256 = sha256(
    canonicalJson({
      planId: plan.id,
      threadId: plan.threadId,
      strategy,
      reason,
      evidence,
      supersedeStepIds,
      supersedeArtifactIds,
      dependencyUpdates,
      addedSteps: newSteps.map((step) => replanStepDigestInput(step)),
      addedArtifacts: newArtifacts.map((artifact) =>
        replanArtifactDigestInput(artifact),
      ),
      fromRevision,
      toRevision,
    }),
  );
  const record: ExecutionPlanReplanRecord = {
    id: createId("replan"),
    strategy,
    reason,
    evidence,
    supersededStepIds: supersedeStepIds,
    supersededArtifactIds: supersedeArtifactIds,
    dependencyUpdatedStepIds: dependencyUpdates.map((update) => update.stepId),
    addedStepIds: newSteps.map((step) => step.id),
    addedArtifactIds: newArtifacts.map((artifact) => artifact.id),
    addedStepsSha256,
    addedArtifactsSha256,
    dependencyUpdatesSha256,
    fromRevision,
    toRevision,
    replanSha256,
    createdAt: timestamp,
  };
  next.replans.push(record);
  next.status = derivePlanStatus(next);
  next.revision = toRevision;
  next.updatedAt = timestamp;
  refreshPlanProjection(next);
  return next;
}

export function transitionPlanStep(
  plan: ExecutionPlan,
  stepId: string,
  request: InternalPlanStepRequest,
): ExecutionPlan {
  const next = applyPlanStepTransition(plan, stepId, request);
  if (next === plan) return plan;
  const timestamp = nowIso();
  const step = next.steps.find((candidate) => candidate.id === stepId)!;
  step.updatedAt = timestamp;
  settleReadySteps(next);
  next.status = derivePlanStatus(next);
  next.revision += 1;
  next.updatedAt = timestamp;
  refreshPlanProjection(next);
  return next;
}

export function recoverCompletedPlanStep(
  plan: ExecutionPlan,
  stepId: string,
  runId: string,
  evidenceInput: string,
): ExecutionPlan {
  if (plan.status === "cancelled") {
    throw new Error("Cancelled plans cannot recover a completed step");
  }
  const next = structuredClone(plan);
  const step = next.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Plan step not found: ${stepId}`);
  if (step.status !== "blocked" || step.runId !== runId) {
    throw new Error("Only the same blocked Plan Run can recover completion");
  }
  const evidence = normalizeText(evidenceInput, 2_000);
  if (!evidence) {
    throw new Error("Recovered plan steps require evidence");
  }
  if (!dependenciesSatisfied(next, step)) {
    throw new Error("Recovered plan step dependencies are incomplete");
  }
  const timestamp = nowIso();
  step.status = "completed";
  step.evidence = evidence;
  delete step.blocker;
  step.finishedAt = timestamp;
  step.updatedAt = timestamp;
  settleReadySteps(next);
  next.status = derivePlanStatus(next);
  next.revision += 1;
  next.updatedAt = timestamp;
  refreshPlanProjection(next);
  return next;
}

export function interruptPlanRun(
  plan: ExecutionPlan,
  runId: string,
  reason = "The owning run ended before this step reached a terminal state.",
): ExecutionPlan {
  const next = structuredClone(plan);
  const timestamp = nowIso();
  let changed = false;
  for (const step of next.steps) {
    if (step.status !== "running" || step.runId !== runId) continue;
    step.status = "blocked";
    step.blocker = normalizeText(reason, 1_000);
    step.evidence =
      "The step outcome is unknown and must be verified before reopening.";
    step.finishedAt = timestamp;
    step.updatedAt = timestamp;
    changed = true;
  }
  if (!changed) return next;
  next.status = derivePlanStatus(next);
  next.revision += 1;
  next.updatedAt = timestamp;
  refreshPlanProjection(next);
  return next;
}

export function updateArtifactManifest(
  plan: ExecutionPlan,
  artifactId: string,
  request: UpdateArtifactManifestRequest,
): ExecutionPlan {
  const next = structuredClone(plan);
  const artifact = next.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  if (artifact.status === "superseded") {
    return next;
  }
  if (artifact.status === "verified" && request.status !== "verified") {
    if (request.status !== "missing" || request.confirmedDrift !== true) {
      return next;
    }
  }
  assertArtifactTransition(artifact.status, request.status);
  const evidence = normalizeText(request.evidence, 2_000);
  if (artifactRequiresEvidence(request.status) && !evidence) {
    throw new Error(`${request.status} artifacts require evidence`);
  }
  if (
    request.status === "verified" &&
    (!request.sha256 || !/^[a-f0-9]{64}$/.test(request.sha256))
  ) {
    throw new Error("Verified artifacts require a SHA-256 digest");
  }
  if (
    request.sizeBytes !== undefined &&
    (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes < 0)
  ) {
    throw new Error("Artifact sizeBytes must be a non-negative integer");
  }
  artifact.status = request.status;
  artifact.evidence = evidence;
  if (request.sha256) artifact.sha256 = request.sha256;
  if (request.sizeBytes !== undefined) artifact.sizeBytes = request.sizeBytes;
  if (request.sourceRunId) artifact.sourceRunId = request.sourceRunId;
  artifact.updatedAt = nowIso();
  next.status = derivePlanStatus(next);
  next.revision += 1;
  next.updatedAt = artifact.updatedAt;
  refreshPlanProjection(next);
  return next;
}

export function createPlanArtifactEventPayload(
  plan: ExecutionPlan,
  artifact: ArtifactManifestEntry,
): { [key: string]: JsonValue } {
  const payload: { [key: string]: JsonValue } = {
    planId: plan.id,
    artifactId: artifact.id,
    path: artifact.path,
    pathSha256: sha256(artifact.path),
    status: artifact.status,
    evidence: artifact.evidence,
    evidenceSha256: sha256(artifact.evidence),
    criticalPathStepIds: plan.criticalPathStepIds,
    readyStepIds: plan.readyStepIds,
    blockedStepIds: plan.blockedStepIds,
    activePhaseIndex: plan.activePhaseIndex,
    parallelReadyStepIds: plan.parallelReadyStepIds,
    phaseWaveCount: plan.phaseWaves.length,
    phaseProjectionSha256: plan.phaseProjectionSha256,
    ...runPlanProgressEventPayload(plan),
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    ...(artifact.sizeBytes !== undefined
      ? { sizeBytes: artifact.sizeBytes }
      : {}),
    ...(artifact.sourceRunId ? { sourceRunId: artifact.sourceRunId } : {}),
  };
  return payload;
}

export function assertPlanArtifactEventBindings({
  plans,
  events,
  label,
}: {
  plans: readonly ExecutionPlan[];
  events: readonly RunEvent[];
  label: string;
}): void {
  const plansById = new Map(plans.map((plan) => [plan.id, plan] as const));
  const latestArtifactEvents = new Map<string, RunEvent>();
  for (const event of events) {
    if (!event.type.startsWith("plan.artifact.")) continue;
    const payload = objectPayload(event.payload);
    const planId = payloadString(payload, "planId");
    const artifactId = payloadString(payload, "artifactId");
    const status = payloadString(payload, "status");
    if (
      !payload ||
      !planId ||
      !artifactId ||
      !status ||
      event.category !== "plan" ||
      event.visibility !== "user" ||
      event.type !== `plan.artifact.${status}` ||
      hasUnsupportedArtifactEventPayloadKey(payload) ||
      (payload.sourceRunId !== undefined && payload.sourceRunId !== event.runId)
    ) {
      throw new Error(`${label} plan.artifact event binding mismatch`);
    }
    const key = `${planId}:${artifactId}`;
    const current = latestArtifactEvents.get(key);
    if (!current || event.seq > current.seq)
      latestArtifactEvents.set(key, event);
  }
  for (const event of latestArtifactEvents.values()) {
    const payload = objectPayload(event.payload);
    const planId = payloadString(payload, "planId");
    const artifactId = payloadString(payload, "artifactId");
    const plan = planId ? plansById.get(planId) : undefined;
    const artifact = plan?.artifacts.find(
      (candidate) => candidate.id === artifactId,
    );
    if (!payload || !plan || !artifact) {
      throw new Error(`${label} plan.artifact event binding mismatch`);
    }
    if (
      canonicalJson(normalizePlanArtifactEventPayload(payload)) !==
      canonicalJson(
        normalizePlanArtifactEventPayload(
          createPlanArtifactEventPayload(plan, artifact),
        ),
      )
    ) {
      throw new Error(`${label} plan.artifact event binding mismatch`);
    }
    if (!isPlanArtifactProjectionPayloadValid(payload, MAX_PLAN_STEPS)) {
      throw new Error(`${label} plan.artifact event binding mismatch`);
    }
  }
}

const PLAN_ARTIFACT_EVENT_COMMON_KEYS = new Set([
  "planId",
  "artifactId",
  "path",
  "status",
  "evidence",
  "sha256",
  "sizeBytes",
  "sourceRunId",
]);
const PLAN_ARTIFACT_EVENT_BINDING_KEYS = new Set([
  ...PLAN_ARTIFACT_EVENT_COMMON_KEYS,
  "pathSha256",
  "evidenceSha256",
]);
const PLAN_ARTIFACT_EVENT_ALLOWED_KEYS = new Set([
  ...PLAN_ARTIFACT_EVENT_BINDING_KEYS,
  ...PLAN_ARTIFACT_EVENT_PROJECTION_KEYS,
]);

function hasUnsupportedArtifactEventPayloadKey(
  payload: Record<string, unknown>,
): boolean {
  return Object.keys(payload).some(
    (key) => !PLAN_ARTIFACT_EVENT_ALLOWED_KEYS.has(key),
  );
}

function normalizePlanArtifactEventPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    [...PLAN_ARTIFACT_EVENT_BINDING_KEYS]
      .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
      .map((key) => [key, payload[key]]),
  );
}

function objectPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function payloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

export function refreshPlanProjection(
  plan: PlanProjectionInput,
): ExecutionPlan {
  if (!Array.isArray(plan.replans)) plan.replans = [];
  plan.replanRecommendation = null;
  plan.criticalPathStepIds = deriveCriticalPathStepIds(plan);
  plan.readyStepIds = plan.steps
    .filter((step) => step.status === "ready")
    .map((step) => step.id)
    .sort();
  plan.blockedStepIds = plan.steps
    .filter((step) => step.status === "blocked")
    .map((step) => step.id)
    .sort();
  const phaseProjection = derivePhaseProjection(plan);
  plan.phaseWaves = phaseProjection.phaseWaves;
  plan.activePhaseIndex = phaseProjection.activePhaseIndex;
  plan.parallelReadyStepIds = phaseProjection.parallelReadyStepIds;
  plan.phaseProjectionSha256 = phaseProjection.phaseProjectionSha256;
  const projected = plan as ExecutionPlan;
  projected.replanRecommendation = deriveReplanRecommendation(projected);
  return projected;
}

interface PhaseProjection {
  phaseWaves: ExecutionPlanPhaseWave[];
  activePhaseIndex: number | null;
  parallelReadyStepIds: string[];
  phaseProjectionSha256: string;
}

function derivePhaseProjection(
  plan: Pick<ExecutionPlan, "steps">,
): PhaseProjection {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const memo = new Map<string, number>();
  const waveIndexFor = (stepId: string): number => {
    const cached = memo.get(stepId);
    if (cached !== undefined) return cached;
    const step = byId.get(stepId);
    if (!step || step.dependsOn.length === 0) {
      memo.set(stepId, 0);
      return 0;
    }
    const index =
      Math.max(
        ...step.dependsOn.map((dependencyId) => waveIndexFor(dependencyId)),
      ) + 1;
    memo.set(stepId, index);
    return index;
  };
  for (const step of plan.steps) waveIndexFor(step.id);
  const stepIdsByWave = new Map<number, string[]>();
  for (const step of plan.steps) {
    const index = waveIndexFor(step.id);
    const list = stepIdsByWave.get(index) ?? [];
    list.push(step.id);
    stepIdsByWave.set(index, list);
  }
  const waves = [...stepIdsByWave.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, stepIds]): ExecutionPlanPhaseWave => {
      const sortedStepIds = stepIds.sort();
      const steps = sortedStepIds.map((stepId) => byId.get(stepId)!);
      const pendingStepIds = steps
        .filter((step) => step.status === "pending")
        .map((step) => step.id)
        .sort();
      const readyStepIds = steps
        .filter((step) => step.status === "ready")
        .map((step) => step.id)
        .sort();
      const runningStepIds = steps
        .filter((step) => step.status === "running")
        .map((step) => step.id)
        .sort();
      const blockedStepIds = steps
        .filter((step) => step.status === "blocked")
        .map((step) => step.id)
        .sort();
      const terminalStepIds = steps
        .filter(
          (step) => step.status === "completed" || step.status === "skipped",
        )
        .map((step) => step.id)
        .sort();
      const content = {
        schemaVersion: 1,
        index,
        stepIds: sortedStepIds,
        pendingStepIds,
        readyStepIds,
        runningStepIds,
        blockedStepIds,
        terminalStepIds,
      };
      return {
        ...content,
        waveSha256: sha256(canonicalJson(content)),
      };
    });
  const activeWave =
    waves.find((wave) => wave.terminalStepIds.length !== wave.stepIds.length) ??
    null;
  const activePhaseIndex = activeWave?.index ?? null;
  const parallelReadyStepIds = activeWave?.readyStepIds ?? [];
  const content = {
    schemaVersion: 1,
    activePhaseIndex,
    parallelReadyStepIds,
    waves,
  };
  return {
    phaseWaves: waves,
    activePhaseIndex,
    parallelReadyStepIds,
    phaseProjectionSha256: sha256(canonicalJson(content)),
  };
}

function deriveCriticalPathStepIds(
  plan: Pick<ExecutionPlan, "steps">,
): string[] {
  const dependents = new Map<string, string[]>();
  for (const step of plan.steps) {
    for (const dependency of step.dependsOn) {
      const list = dependents.get(dependency) ?? [];
      list.push(step.id);
      dependents.set(dependency, list);
    }
  }
  for (const list of dependents.values()) list.sort();
  const remaining = new Set(
    plan.steps
      .filter(
        (step) => step.status !== "completed" && step.status !== "skipped",
      )
      .map((step) => step.id),
  );
  const memo = new Map<string, string[]>();
  const bestFrom = (stepId: string): string[] => {
    const cached = memo.get(stepId);
    if (cached) return cached;
    const tails = (dependents.get(stepId) ?? [])
      .filter((candidate) => remaining.has(candidate))
      .map(bestFrom);
    const bestTail = tails.sort(compareCriticalPath)[0] ?? [];
    const path = [stepId, ...bestTail];
    memo.set(stepId, path);
    return path;
  };
  return [...remaining].map(bestFrom).sort(compareCriticalPath)[0] ?? [];
}

function compareCriticalPath(left: string[], right: string[]): number {
  if (left.length !== right.length) return right.length - left.length;
  return left.join("\u0000").localeCompare(right.join("\u0000"));
}

function deriveReplanRecommendation(
  plan: Pick<
    ExecutionPlan,
    | "id"
    | "threadId"
    | "revision"
    | "status"
    | "steps"
    | "artifacts"
    | "criticalPathStepIds"
    | "readyStepIds"
  >,
): ExecutionPlanReplanRecommendation | null {
  if (plan.status === "completed" || plan.status === "cancelled") return null;
  const hasRunningStep = plan.steps.some((step) => step.status === "running");
  if (hasRunningStep || plan.readyStepIds.length > 0) return null;
  const missingArtifacts = plan.artifacts
    .filter((artifact) => artifact.status === "missing")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (missingArtifacts.length > 0) {
    return createReplanRecommendation(plan, {
      strategy: "artifact_drift",
      reason:
        "A required artifact is missing and no plan step is currently schedulable.",
      evidence: joinRecommendationEvidence(
        missingArtifacts.map(
          (artifact) =>
            `${artifact.id}: ${artifact.evidence || "Artifact is marked missing."}`,
        ),
      ),
      supersedeStepIds: [],
      supersedeArtifactIds: missingArtifacts.map((artifact) => artifact.id),
      affectedStepIds: plan.criticalPathStepIds,
      affectedArtifactIds: missingArtifacts.map((artifact) => artifact.id),
    });
  }

  const stepsById = new Map(plan.steps.map((step) => [step.id, step]));
  const blockedCriticalSteps = plan.criticalPathStepIds
    .map((stepId) => stepsById.get(stepId))
    .filter((step): step is PlanStep => step?.status === "blocked");
  if (blockedCriticalSteps.length === 0) return null;
  return createReplanRecommendation(plan, {
    strategy: "recover_blocked",
    reason:
      "The critical path is blocked and no plan step is currently schedulable.",
    evidence: joinRecommendationEvidence(
      blockedCriticalSteps.map(
        (step) =>
          `${step.id}: ${step.blocker || step.evidence || "Step is blocked."}`,
      ),
    ),
    supersedeStepIds: blockedCriticalSteps.map((step) => step.id),
    supersedeArtifactIds: [],
    affectedStepIds: plan.criticalPathStepIds,
    affectedArtifactIds: [],
  });
}

function createReplanRecommendation(
  plan: Pick<
    ExecutionPlan,
    "id" | "threadId" | "revision" | "steps" | "artifacts"
  >,
  input: Omit<
    ExecutionPlanReplanRecommendation,
    "expectedRevision" | "draft" | "recommendationSha256"
  >,
): ExecutionPlanReplanRecommendation {
  const expectedRevision = plan.revision;
  const draftRequest = createReplanDraft(plan, input, expectedRevision);
  const evaluation = evaluateReplanDraft(plan, input, draftRequest, "balanced");
  const draft = {
    policyId: PLAN_REPLAN_DRAFT_POLICY_ID,
    request: draftRequest,
    draftSha256: sha256(canonicalJson(draftRequest)),
    evaluation,
  };
  const recommendationSha256 = sha256(
    canonicalJson({
      planId: plan.id,
      threadId: plan.threadId,
      expectedRevision,
      ...input,
      draftSha256: draft.draftSha256,
      evaluationSha256: evaluation.evaluationSha256,
    }),
  );
  return {
    ...input,
    expectedRevision,
    draft,
    recommendationSha256,
  };
}

function evaluateReplanDraft(
  plan: Pick<ExecutionPlan, "steps" | "artifacts">,
  input: Pick<
    ExecutionPlanReplanRecommendation,
    "strategy" | "supersedeStepIds" | "supersedeArtifactIds"
  >,
  request: ReplanExecutionPlanRequest,
  posture: ExecutionPlanReplanPolicyPosture,
): ExecutionPlanReplanDraftEvaluation {
  const addStepCount = request.addSteps?.length ?? 0;
  const addArtifactCount = request.addArtifacts?.length ?? 0;
  const dependencyUpdateCount = request.dependencyUpdates?.length ?? 0;
  const supersedeStepCount = request.supersedeStepIds?.length ?? 0;
  const supersedeArtifactCount = request.supersedeArtifactIds?.length ?? 0;
  const maxDraftSteps = maxEvaluatedDraftSteps(posture);
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const artifactIds = new Set(plan.artifacts.map((artifact) => artifact.id));
  const checks: ExecutionPlanReplanDraftEvaluationCheck[] = [
    {
      id: "expected_revision_bound",
      severity: "blocking",
      passed:
        Number.isSafeInteger(request.expectedRevision) &&
        request.expectedRevision >= 0,
      detail: `expectedRevision=${request.expectedRevision}`,
    },
    {
      id: "reason_and_evidence_present",
      severity: "blocking",
      passed:
        request.reason.trim().length > 0 && request.evidence.trim().length > 0,
      detail: "Draft carries concrete reason and evidence.",
    },
    {
      id: "supersession_matches_strategy",
      severity: "blocking",
      passed:
        input.strategy === "recover_blocked"
          ? supersedeStepCount > 0 && supersedeArtifactCount === 0
          : input.strategy === "artifact_drift"
            ? supersedeArtifactCount > 0 && supersedeStepCount === 0
            : supersedeStepCount + supersedeArtifactCount > 0,
      detail: `${supersedeStepCount} step supersessions, ${supersedeArtifactCount} artifact supersessions.`,
    },
    {
      id: "superseded_entities_exist",
      severity: "blocking",
      passed:
        (request.supersedeStepIds ?? []).every((stepId) =>
          stepIds.has(stepId),
        ) &&
        (request.supersedeArtifactIds ?? []).every((artifactId) =>
          artifactIds.has(artifactId),
        ),
      detail: "Every superseded entity is present in the source plan.",
    },
    {
      id: "replacement_work_present",
      severity: "blocking",
      passed:
        addStepCount > 0 || addArtifactCount > 0 || dependencyUpdateCount > 0,
      detail: `${addStepCount} new steps, ${addArtifactCount} new artifacts, ${dependencyUpdateCount} dependency rewrites.`,
    },
    {
      id: "draft_size_within_policy",
      severity: "warning",
      passed: addStepCount <= maxDraftSteps,
      detail: `${addStepCount}/${maxDraftSteps} replacement steps for ${posture} posture.`,
    },
    {
      id: "dependency_rewrites_have_targets",
      severity: "warning",
      passed: (request.dependencyUpdates ?? []).every((update) =>
        stepIds.has(update.stepId),
      ),
      detail: `${dependencyUpdateCount} dependency rewrites target existing steps.`,
    },
  ];
  const blockingFailures = checks.filter(
    (check) => !check.passed && check.severity === "blocking",
  ).length;
  const warningFailures = checks.filter(
    (check) => !check.passed && check.severity === "warning",
  ).length;
  const score = Math.max(0, 100 - blockingFailures * 35 - warningFailures * 12);
  const risk =
    blockingFailures > 0 || score < 60
      ? "high"
      : warningFailures > 0 || score < 85
        ? "medium"
        : "low";
  const content = {
    policyId: PLAN_REPLAN_DRAFT_POLICY_ID,
    posture,
    score,
    risk,
    maxDraftSteps,
    addStepCount,
    addArtifactCount,
    dependencyUpdateCount,
    supersedeStepCount,
    supersedeArtifactCount,
    checks,
  } satisfies Omit<ExecutionPlanReplanDraftEvaluation, "evaluationSha256">;
  return {
    ...content,
    evaluationSha256: sha256(canonicalJson(content)),
  };
}

function maxEvaluatedDraftSteps(
  posture: ExecutionPlanReplanPolicyPosture,
): number {
  if (posture === "conservative") return 1;
  if (posture === "balanced") return 2;
  return 4;
}

function createReplanDraft(
  plan: Pick<ExecutionPlan, "steps" | "artifacts">,
  input: Omit<
    ExecutionPlanReplanRecommendation,
    "expectedRevision" | "draft" | "recommendationSha256"
  >,
  expectedRevision: number,
): ReplanExecutionPlanRequest {
  const existingStepIds = new Set(plan.steps.map((step) => step.id));
  const existingArtifactIds = new Set(
    plan.artifacts.map((artifact) => artifact.id),
  );
  const addSteps: NonNullable<ReplanExecutionPlanRequest["addSteps"]> = [];
  const addArtifacts: NonNullable<ReplanExecutionPlanRequest["addArtifacts"]> =
    [];
  const dependencyUpdates: NonNullable<
    ReplanExecutionPlanRequest["dependencyUpdates"]
  > = [];

  if (input.strategy === "recover_blocked") {
    const replacementIds = new Map<string, string>();
    for (const stepId of input.supersedeStepIds) {
      replacementIds.set(
        stepId,
        createAvailableEntityId("recover", stepId, existingStepIds),
      );
    }
    for (const stepId of input.supersedeStepIds) {
      const source = plan.steps.find((step) => step.id === stepId);
      const replacementId = replacementIds.get(stepId);
      if (!source || !replacementId) continue;
      addSteps.push({
        id: replacementId,
        title: normalizeText(`Recover ${source.title}`, 120),
        description: normalizeText(
          `Find and execute a replacement path for: ${source.description}`,
          1_500,
        ),
        verification: source.verification,
        dependsOn: source.dependsOn.map(
          (dependency) => replacementIds.get(dependency) ?? dependency,
        ),
      });
    }
    for (const step of plan.steps) {
      if (
        input.supersedeStepIds.includes(step.id) ||
        step.status === "completed" ||
        step.status === "running" ||
        !step.dependsOn.some((dependency) => replacementIds.has(dependency))
      ) {
        continue;
      }
      dependencyUpdates.push({
        stepId: step.id,
        dependsOn: step.dependsOn.map(
          (dependency) => replacementIds.get(dependency) ?? dependency,
        ),
      });
    }
  } else if (input.strategy === "artifact_drift") {
    for (const artifactId of input.supersedeArtifactIds) {
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === artifactId,
      );
      if (!artifact) continue;
      const stepId = createAvailableEntityId(
        "restore",
        artifact.id,
        existingStepIds,
      );
      const replacementArtifactId = createAvailableEntityId(
        "replacement",
        artifact.id,
        existingArtifactIds,
      );
      addSteps.push({
        id: stepId,
        title: normalizeText(`Restore ${artifact.id}`, 120),
        description: normalizeText(
          `Recreate or replace the missing artifact at ${artifact.path}.`,
          1_500,
        ),
        verification: normalizeText(
          `Produce and verify ${artifact.path} with a runtime-computed SHA-256 digest.`,
          1_000,
        ),
      });
      addArtifacts.push({
        id: replacementArtifactId,
        path: artifact.path,
        kind: artifact.kind,
        description: normalizeText(
          `Replacement for missing artifact ${artifact.id}: ${artifact.description}`,
          1_000,
        ),
      });
    }
  }

  return {
    expectedRevision,
    strategy: input.strategy,
    reason: input.reason,
    evidence: input.evidence,
    ...(input.supersedeStepIds.length > 0
      ? { supersedeStepIds: input.supersedeStepIds }
      : {}),
    ...(input.supersedeArtifactIds.length > 0
      ? { supersedeArtifactIds: input.supersedeArtifactIds }
      : {}),
    ...(dependencyUpdates.length > 0 ? { dependencyUpdates } : {}),
    ...(addSteps.length > 0 ? { addSteps } : {}),
    ...(addArtifacts.length > 0 ? { addArtifacts } : {}),
  };
}

function createAvailableEntityId(
  prefix: string,
  sourceId: string,
  taken: Set<string>,
): string {
  const stem = `${prefix}-${sourceId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "");
  const base = /^[a-z]/.test(stem) ? stem : `${prefix}-${stem}`;
  let candidate = base.slice(0, 64).replace(/[-_]+$/, "");
  if (!candidate) candidate = prefix;
  let suffix = 2;
  while (taken.has(candidate)) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 64 - tail.length)).replace(/[-_]+$/, "")}${tail}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

function joinRecommendationEvidence(items: string[]): string {
  return (
    normalizeText(items.join(" | "), 2_000) || "Replanning is recommended."
  );
}

function validateStepDependencies(steps: PlanStep[]): void {
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) {
        throw new Error(`Plan step cannot depend on itself: ${step.id}`);
      }
      if (!byId.has(dependency)) {
        throw new Error(
          `Plan step ${step.id} has unknown dependency: ${dependency}`,
        );
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (step: PlanStep): void => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) {
      throw new Error(`Plan step dependency cycle includes: ${step.id}`);
    }
    visiting.add(step.id);
    for (const dependency of step.dependsOn) {
      visit(byId.get(dependency)!);
    }
    visiting.delete(step.id);
    visited.add(step.id);
  };
  steps.forEach(visit);
}

function settleReadySteps(plan: ExecutionPlan): void {
  for (const step of plan.steps) {
    if (step.status === "pending" && dependenciesSatisfied(plan, step)) {
      step.status = "ready";
      step.updatedAt = nowIso();
    }
  }
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

function derivePlanStatus(plan: ExecutionPlan): ExecutionPlan["status"] {
  const stepsSettled = plan.steps.every(
    (step) => step.status === "completed" || step.status === "skipped",
  );
  const artifactsSettled = plan.artifacts.every(
    (artifact) =>
      artifact.status === "verified" ||
      artifact.status === "superseded" ||
      (["url", "other"].includes(artifact.kind) &&
        artifact.status === "produced"),
  );
  if (stepsSettled && artifactsSettled) return "completed";
  if (
    (plan.steps.some((step) => step.status === "blocked") ||
      plan.artifacts.some((artifact) => artifact.status === "missing")) &&
    !plan.steps.some(
      (step) => step.status === "ready" || step.status === "running",
    )
  )
    return "blocked";
  return "active";
}

function assertArtifactTransition(
  current: ArtifactManifestEntry["status"],
  next: ArtifactManifestEntry["status"],
): void {
  const allowed: Record<
    ArtifactManifestEntry["status"],
    ArtifactManifestEntry["status"][]
  > = {
    expected: ["candidate", "produced", "missing", "superseded"],
    candidate: ["produced", "verified", "missing", "superseded"],
    produced: ["verified", "missing", "superseded"],
    verified: ["missing"],
    missing: ["produced", "superseded"],
    superseded: [],
  };
  if (current === next) return;
  if (!allowed[current].includes(next)) {
    throw new Error(`Cannot transition artifact from ${current} to ${next}`);
  }
}

function normalizeEntityIdList(
  values: string[] | undefined,
  label: string,
  maxItems: number,
): string[] {
  if (!values) return [];
  if (values.length > maxItems) {
    throw new Error(`Too many ${label} IDs`);
  }
  return [...new Set(values.map((value) => normalizeEntityId(value, label)))];
}

function normalizeDependencyUpdates(
  updates: ReplanExecutionPlanRequest["dependencyUpdates"] | undefined,
): Array<{ stepId: string; dependsOn: string[] }> {
  if (!updates) return [];
  if (updates.length > MAX_PLAN_STEPS) {
    throw new Error(`Plans allow at most ${MAX_PLAN_STEPS} dependency updates`);
  }
  const seen = new Set<string>();
  return updates.map((update) => {
    const stepId = normalizeEntityId(update.stepId, "step");
    if (seen.has(stepId)) {
      throw new Error(`Duplicate dependency update for plan step: ${stepId}`);
    }
    seen.add(stepId);
    return {
      stepId,
      dependsOn: [
        ...new Set(
          update.dependsOn.map((dependency) =>
            normalizeEntityId(dependency, "step"),
          ),
        ),
      ],
    };
  });
}

function replanStepDigestInput(step: PlanStep): {
  id: string;
  title: string;
  description: string;
  verification: string;
  dependsOn: string[];
} {
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    verification: step.verification,
    dependsOn: step.dependsOn,
  };
}

function replanArtifactDigestInput(artifact: ArtifactManifestEntry): {
  id: string;
  path: string;
  kind: ArtifactManifestEntry["kind"];
  description: string;
} {
  return {
    id: artifact.id,
    path: artifact.path,
    kind: artifact.kind,
    description: artifact.description,
  };
}

function normalizeEntityId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`Invalid ${label} ID: ${value}`);
  }
  return normalized;
}

function normalizeArtifactPath(
  value: string,
  kind: ArtifactManifestEntry["kind"],
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Artifact path is required");
  if (kind === "url") {
    const url = new URL(normalized);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      throw new Error("Artifact URLs must be credential-free HTTP(S) URLs");
    }
    return url.toString();
  }
  if (kind === "file" || kind === "directory") {
    if (path.isAbsolute(normalized)) {
      throw new Error("Artifact paths must be workspace-relative");
    }
    const relative = path.normalize(normalized);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      relative === "."
    ) {
      throw new Error("Artifact path escapes the workspace");
    }
    return relative;
  }
  return normalizeText(normalized, 500);
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
