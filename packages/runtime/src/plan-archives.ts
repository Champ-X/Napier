import {
  NAPIER_API_VERSION,
  type ExecutionPlan,
  type ExecutionPlanArchive,
  type ExecutionPlanArchiveVerification,
  type PlanStep,
  type RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertPlanArtifactEventBindings,
  refreshPlanProjection,
} from "./plans.js";
import {
  assertArtifactReceiptEventBoundary,
  isArtifactReceiptEvent,
} from "./artifact-receipts.js";
import { hashEventStream } from "./run-replay.js";
import type { PlanArchiveStorePort } from "./store-port.js";

export const MAX_EXECUTION_PLAN_ARCHIVE_BYTES = 10 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,80}$/;
const MAX_ARCHIVE_PLAN_EVENTS = 10_000;
const PLAN_STATUSES = new Set<string>([
  "active",
  "completed",
  "blocked",
  "cancelled",
]);
const PLAN_STEP_STATUSES = new Set<string>([
  "pending",
  "ready",
  "running",
  "completed",
  "blocked",
  "skipped",
]);
const ARTIFACT_STATUSES = new Set<string>([
  "expected",
  "produced",
  "verified",
  "missing",
  "superseded",
]);
const ARTIFACT_KINDS = new Set<string>(["file", "directory", "url", "other"]);
const REPLAN_STRATEGIES = new Set<string>([
  "recover_blocked",
  "scope_change",
  "artifact_drift",
]);

export type ExecutionPlanArchiveContent = Omit<
  ExecutionPlanArchive,
  "generatedAt" | "contentSha256"
>;

export async function createExecutionPlanArchive(
  store: PlanArchiveStorePort,
  threadId: string,
  planId: string,
): Promise<ExecutionPlanArchive> {
  store.getThread(threadId);
  const plan = store.getPlan(planId);
  if (plan.threadId !== threadId) {
    throw new Error("Plan does not belong to thread");
  }
  const events = (await store.listEvents(threadId))
    .filter((event) => eventPlanId(event) === planId)
    .sort((left, right) => left.seq - right.seq);
  const content: ExecutionPlanArchiveContent = {
    kind: "napier.execution-plan-archive",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    threadId,
    plan,
    events,
    eventStreamSha256: hashEventStream(events),
  };
  return {
    ...content,
    generatedAt: new Date().toISOString(),
    contentSha256: hashExecutionPlanArchiveContent(content),
  };
}

export function verifyExecutionPlanArchive(
  input: unknown,
): ExecutionPlanArchiveVerification {
  try {
    const archive = validateExecutionPlanArchive(input);
    return {
      status: "valid",
      diagnostics: [],
      threadId: archive.threadId,
      planId: archive.plan.id,
      revision: archive.plan.revision,
      contentSha256: archive.contentSha256,
      eventStreamSha256: archive.eventStreamSha256,
      eventCount: archive.events.length,
      stepCount: archive.plan.steps.length,
      artifactCount: archive.plan.artifacts.length,
      replanCount: archive.plan.replans.length,
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [executionPlanArchiveDiagnostic(error)],
      eventCount: 0,
      stepCount: 0,
      artifactCount: 0,
      replanCount: 0,
    };
  }
}

export function validateExecutionPlanArchive(
  input: unknown,
): ExecutionPlanArchive {
  const record = recordField({ archive: input }, "archive");
  const allowedKeys = new Set([
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "threadId",
    "plan",
    "events",
    "eventStreamSha256",
    "contentSha256",
  ]);
  for (const key of allowedKeys) {
    if (!(key in record)) {
      throw new Error(`Execution plan archive is missing field: ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Execution plan archive has unsupported field: ${key}`);
    }
  }
  if (record["kind"] !== "napier.execution-plan-archive") {
    throw new Error("Execution plan archive kind is invalid");
  }
  if (record["schemaVersion"] !== 1) {
    throw new Error("Execution plan archive schemaVersion is unsupported");
  }
  if (record["apiVersion"] !== NAPIER_API_VERSION) {
    throw new Error("Execution plan archive API version is unsupported");
  }
  assertIsoString(record["generatedAt"], "generatedAt");
  const threadId = stringField(record, "threadId");
  const plan = assertArchivePlan(recordField(record, "plan"), threadId);
  const events = arrayField(record, "events");
  if (events.length > MAX_ARCHIVE_PLAN_EVENTS) {
    throw new Error("Execution plan archive events exceeds maximum length");
  }
  let previousSeq = 0;
  for (const event of events) {
    assertArchivePlanEvent(event, threadId, plan.id, previousSeq);
    previousSeq = (event as RunEvent).seq;
  }
  const eventStreamSha256 = stringField(record, "eventStreamSha256");
  assertSha256(eventStreamSha256, "eventStreamSha256");
  if (eventStreamSha256 !== hashEventStream(events as RunEvent[])) {
    throw new Error("Execution plan archive event stream hash mismatch");
  }
  assertPlanArtifactEventBindings({
    plans: [plan],
    events: events as RunEvent[],
    label: "Execution plan archive",
  });
  const contentSha256 = stringField(record, "contentSha256");
  assertSha256(contentSha256, "contentSha256");
  const archive = input as ExecutionPlanArchive;
  const computedContentSha256 = hashExecutionPlanArchiveContent(
    executionPlanArchiveContent(archive),
  );
  if (contentSha256 !== computedContentSha256) {
    throw new Error("Execution plan archive content hash mismatch");
  }
  return structuredClone(archive);
}

export function hashExecutionPlanArchiveContent(
  content: ExecutionPlanArchiveContent,
): string {
  return sha256(canonicalJson(content));
}

function executionPlanArchiveContent(
  archive: ExecutionPlanArchive,
): ExecutionPlanArchiveContent {
  return {
    kind: archive.kind,
    schemaVersion: archive.schemaVersion,
    apiVersion: archive.apiVersion,
    threadId: archive.threadId,
    plan: archive.plan,
    events: archive.events,
    eventStreamSha256: archive.eventStreamSha256,
  };
}

function assertArchivePlan(
  record: Record<string, unknown>,
  threadId: string,
): ExecutionPlan {
  const id = stringField(record, "id");
  if (!RESOURCE_ID.test(id) || stringField(record, "threadId") !== threadId) {
    throw new Error("Execution plan archive plan ownership is invalid");
  }
  const status = record["status"];
  if (typeof status !== "string" || !PLAN_STATUSES.has(status)) {
    throw new Error("Execution plan archive plan status is invalid");
  }
  if (!boundedString(record["objective"], 1, 4_000)) {
    throw new Error("Execution plan archive objective is invalid");
  }
  const revision = record["revision"];
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new Error("Execution plan archive revision is invalid");
  }
  assertIsoString(record["createdAt"], "plan.createdAt");
  assertIsoString(record["updatedAt"], "plan.updatedAt");
  const steps = arrayField(record, "steps");
  const artifacts = arrayField(record, "artifacts");
  const replans = arrayField(record, "replans");
  if (steps.length < 1 || steps.length > 30) {
    throw new Error("Execution plan archive steps is invalid");
  }
  if (artifacts.length > 30 || replans.length > 20) {
    throw new Error("Execution plan archive plan length is invalid");
  }
  const stepIds = new Set<string>();
  for (const step of steps) {
    const stepId = assertArchiveStep(step);
    if (stepIds.has(stepId)) {
      throw new Error("Execution plan archive duplicate step ID");
    }
    stepIds.add(stepId);
  }
  for (const step of steps as PlanStep[]) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        throw new Error("Execution plan archive dependency is invalid");
      }
    }
  }
  const artifactIds = new Set<string>();
  for (const artifact of artifacts) {
    const artifactId = assertArchiveArtifact(artifact);
    if (artifactIds.has(artifactId)) {
      throw new Error("Execution plan archive duplicate artifact ID");
    }
    artifactIds.add(artifactId);
  }
  for (const replan of replans) {
    assertArchiveReplan(replan, revision);
  }
  const criticalPathStepIds = stringArrayField(record, "criticalPathStepIds");
  const readyStepIds = stringArrayField(record, "readyStepIds");
  const blockedStepIds = stringArrayField(record, "blockedStepIds");
  for (const stepId of [
    ...criticalPathStepIds,
    ...readyStepIds,
    ...blockedStepIds,
  ]) {
    if (!stepIds.has(stepId)) {
      throw new Error("Execution plan archive projection is invalid");
    }
  }
  assertArchivePhaseProjection(record);
  const recommendation = record["replanRecommendation"];
  if (recommendation !== null) {
    const recommendationRecord = recordField(
      { replanRecommendation: recommendation },
      "replanRecommendation",
    );
    const recommendationSha256 = recommendationRecord["recommendationSha256"];
    if (
      typeof recommendationSha256 !== "string" ||
      !SHA256.test(recommendationSha256)
    ) {
      throw new Error("Execution plan archive recommendation is invalid");
    }
  }
  return record as unknown as ExecutionPlan;
}

function assertArchivePhaseProjection(record: Record<string, unknown>): void {
  const phaseFields = [
    "phaseWaves",
    "activePhaseIndex",
    "parallelReadyStepIds",
    "phaseProjectionSha256",
  ];
  const hasAnyPhaseField = phaseFields.some((field) => field in record);
  if (!hasAnyPhaseField) return;
  if (phaseFields.some((field) => !(field in record))) {
    throw new Error("Execution plan archive phase projection is invalid");
  }
  const projected = refreshPlanProjection(
    structuredClone(record) as unknown as ExecutionPlan,
  );
  if (
    JSON.stringify(projected.phaseWaves) !==
      JSON.stringify(record["phaseWaves"]) ||
    projected.activePhaseIndex !== record["activePhaseIndex"] ||
    JSON.stringify(projected.parallelReadyStepIds) !==
      JSON.stringify(record["parallelReadyStepIds"]) ||
    projected.phaseProjectionSha256 !== record["phaseProjectionSha256"]
  ) {
    throw new Error("Execution plan archive phase projection is invalid");
  }
}

function assertArchiveStep(value: unknown): string {
  const record = recordField({ step: value }, "step");
  const id = stringField(record, "id");
  const status = record["status"];
  if (
    !RESOURCE_ID.test(id) ||
    !boundedString(record["title"], 1, 120) ||
    !boundedString(record["description"], 1, 1_500) ||
    !boundedString(record["verification"], 1, 1_000) ||
    typeof status !== "string" ||
    !PLAN_STEP_STATUSES.has(status)
  ) {
    throw new Error("Execution plan archive step is invalid");
  }
  stringArrayField(record, "dependsOn");
  if (!boundedString(record["evidence"], 0, 2_000)) {
    throw new Error("Execution plan archive step evidence is invalid");
  }
  if (
    record["blocker"] !== undefined &&
    !boundedString(record["blocker"], 1, 1_000)
  ) {
    throw new Error("Execution plan archive step blocker is invalid");
  }
  if (record["runId"] !== undefined) stringField(record, "runId");
  if (record["startedAt"] !== undefined) {
    assertIsoString(record["startedAt"], "step.startedAt");
  }
  if (record["finishedAt"] !== undefined) {
    assertIsoString(record["finishedAt"], "step.finishedAt");
  }
  assertIsoString(record["createdAt"], "step.createdAt");
  assertIsoString(record["updatedAt"], "step.updatedAt");
  return id;
}

function assertArchiveArtifact(value: unknown): string {
  const record = recordField({ artifact: value }, "artifact");
  const id = stringField(record, "id");
  const kind = record["kind"];
  const status = record["status"];
  if (
    !RESOURCE_ID.test(id) ||
    !boundedString(record["path"], 1, 500) ||
    typeof kind !== "string" ||
    !ARTIFACT_KINDS.has(kind) ||
    !boundedString(record["description"], 1, 1_000) ||
    typeof status !== "string" ||
    !ARTIFACT_STATUSES.has(status) ||
    !boundedString(record["evidence"], 0, 2_000)
  ) {
    throw new Error("Execution plan archive artifact is invalid");
  }
  if (record["sha256"] !== undefined) {
    assertSha256(stringField(record, "sha256"), "artifact.sha256");
  }
  const sizeBytes = record["sizeBytes"];
  if (
    sizeBytes !== undefined &&
    (typeof sizeBytes !== "number" ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 0)
  ) {
    throw new Error("Execution plan archive artifact size is invalid");
  }
  if (record["sourceRunId"] !== undefined) stringField(record, "sourceRunId");
  assertIsoString(record["createdAt"], "artifact.createdAt");
  assertIsoString(record["updatedAt"], "artifact.updatedAt");
  return id;
}

function assertArchiveReplan(value: unknown, planRevision: number): void {
  const record = recordField({ replan: value }, "replan");
  stringField(record, "id");
  const strategy = record["strategy"];
  if (typeof strategy !== "string" || !REPLAN_STRATEGIES.has(strategy)) {
    throw new Error("Execution plan archive replan strategy is invalid");
  }
  if (
    !boundedString(record["reason"], 1, 1_000) ||
    !boundedString(record["evidence"], 1, 2_000)
  ) {
    throw new Error("Execution plan archive replan evidence is invalid");
  }
  for (const field of [
    "supersededStepIds",
    "supersededArtifactIds",
    "dependencyUpdatedStepIds",
    "addedStepIds",
    "addedArtifactIds",
  ]) {
    stringArrayField(record, field);
  }
  for (const field of [
    "addedStepsSha256",
    "addedArtifactsSha256",
    "dependencyUpdatesSha256",
    "replanSha256",
  ]) {
    assertSha256(stringField(record, field), field);
  }
  const fromRevision = record["fromRevision"];
  const toRevision = record["toRevision"];
  if (
    typeof fromRevision !== "number" ||
    typeof toRevision !== "number" ||
    !Number.isSafeInteger(fromRevision) ||
    !Number.isSafeInteger(toRevision) ||
    fromRevision < 1 ||
    toRevision !== fromRevision + 1 ||
    toRevision > planRevision
  ) {
    throw new Error("Execution plan archive replan revision is invalid");
  }
  assertIsoString(record["createdAt"], "replan.createdAt");
}

function assertArchivePlanEvent(
  value: unknown,
  threadId: string,
  planId: string,
  previousSeq: number,
): asserts value is RunEvent {
  const record = recordField({ event: value }, "event");
  const payload = recordField(record, "payload");
  if (
    typeof record["id"] !== "string" ||
    record["threadId"] !== threadId ||
    typeof record["runId"] !== "string" ||
    typeof record["seq"] !== "number" ||
    !Number.isSafeInteger(record["seq"]) ||
    record["seq"] <= previousSeq ||
    typeof record["type"] !== "string" ||
    (record["category"] !== "plan" &&
      !isArchiveArtifactEvidenceEvent(record)) ||
    typeof record["visibility"] !== "string" ||
    typeof record["createdAt"] !== "string" ||
    Number.isNaN(Date.parse(record["createdAt"])) ||
    payload["planId"] !== planId
  ) {
    throw new Error("Execution plan archive event is invalid");
  }
}

function isArchiveArtifactEvidenceEvent(
  event: Record<string, unknown>,
): boolean {
  if (!isArtifactReceiptEvent(event)) {
    return false;
  }
  try {
    assertArtifactReceiptEventBoundary(
      event,
      "Execution plan archive artifact receipt",
    );
    return true;
  } catch {
    return false;
  }
}

function eventPlanId(event: RunEvent): string | undefined {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const planId = (event.payload as Record<string, unknown>)["planId"];
  return typeof planId === "string" ? planId : undefined;
}

function executionPlanArchiveDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("exceeds")) return "too_large";
  if (message.includes("missing field")) return "missing_field";
  if (message.includes("unsupported field")) return "unsupported_field";
  if (message.includes("kind is invalid")) return "invalid_kind";
  if (message.includes("schemaVersion")) return "unsupported_schema_version";
  if (message.includes("API version")) return "unsupported_api_version";
  if (message.includes("ownership")) return "ownership_mismatch";
  if (message.includes("duplicate")) return "duplicate_resource_id";
  if (message.includes("event stream hash mismatch")) return "hash_mismatch";
  if (message.includes("content hash mismatch")) return "hash_mismatch";
  if (message.includes("event binding mismatch")) {
    return "event_binding_mismatch";
  }
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_archive";
}

function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value;
}

function stringArrayField(
  record: Record<string, unknown>,
  field: string,
): string[] {
  const values = arrayField(record, field);
  if (
    values.length > 30 ||
    !values.every((value) => typeof value === "string" && value.length > 0)
  ) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return values as string[];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value;
}

function assertSha256(value: string, field: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`Execution plan archive ${field} hash is invalid`);
  }
}

function assertIsoString(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
}

function boundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}
