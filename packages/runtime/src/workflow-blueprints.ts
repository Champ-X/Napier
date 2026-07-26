import {
  NAPIER_API_VERSION,
  type CreateExecutionPlanRequest,
  type ExecutionPlanArchive,
  type ExecutionPlanBlueprint,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordStatus,
  type ExecutionPlanBlueprintSource,
  type ExecutionPlanBlueprintVerification,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createExecutionPlanArchive } from "./plan-archives.js";
import { createExecutionPlan } from "./plans.js";
import type { LocalStore } from "./store.js";

export const MAX_EXECUTION_PLAN_BLUEPRINT_BYTES = 2 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export type ExecutionPlanBlueprintContent = Omit<
  ExecutionPlanBlueprint,
  "generatedAt" | "contentSha256"
>;

export async function createExecutionPlanBlueprint(
  store: LocalStore,
  threadId: string,
  planId: string,
): Promise<ExecutionPlanBlueprint> {
  const archive = await createExecutionPlanArchive(store, threadId, planId);
  return createExecutionPlanBlueprintFromArchive(archive);
}

export function createExecutionPlanBlueprintFromArchive(
  archive: ExecutionPlanArchive,
): ExecutionPlanBlueprint {
  const request = executionPlanRequestFromArchive(archive);
  const source: ExecutionPlanBlueprintSource = {
    type: "plan",
    threadId: archive.threadId,
    planId: archive.plan.id,
    planRevision: archive.plan.revision,
    planArchiveSha256: archive.contentSha256,
    eventStreamSha256: archive.eventStreamSha256,
  };
  const content: ExecutionPlanBlueprintContent = {
    kind: "napier.execution-plan-blueprint",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    title: normalizeTitle(archive.plan.objective),
    objective: request.objective,
    source,
    steps: request.steps,
    ...(request.artifacts && request.artifacts.length > 0
      ? { artifacts: request.artifacts }
      : {}),
    stepCount: request.steps.length,
    artifactCount: request.artifacts?.length ?? 0,
  };
  return validateExecutionPlanBlueprint({
    ...content,
    generatedAt: new Date().toISOString(),
    contentSha256: hashExecutionPlanBlueprintContent(content),
  });
}

export function verifyExecutionPlanBlueprint(
  input: unknown,
): ExecutionPlanBlueprintVerification {
  try {
    const blueprint = validateExecutionPlanBlueprint(input);
    return {
      status: "valid",
      diagnostics: [],
      contentSha256: blueprint.contentSha256,
      sourceThreadId: blueprint.source.threadId,
      sourcePlanId: blueprint.source.planId,
      sourcePlanRevision: blueprint.source.planRevision,
      sourcePlanArchiveSha256: blueprint.source.planArchiveSha256,
      sourceEventStreamSha256: blueprint.source.eventStreamSha256,
      stepCount: blueprint.steps.length,
      artifactCount: blueprint.artifacts?.length ?? 0,
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [executionPlanBlueprintDiagnostic(error)],
      stepCount: 0,
      artifactCount: 0,
    };
  }
}

export function validateExecutionPlanBlueprint(
  input: unknown,
): ExecutionPlanBlueprint {
  const record = recordField({ blueprint: input }, "blueprint");
  const allowedKeys = new Set([
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "title",
    "objective",
    "source",
    "steps",
    "artifacts",
    "stepCount",
    "artifactCount",
    "contentSha256",
  ]);
  for (const key of [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "title",
    "objective",
    "source",
    "steps",
    "stepCount",
    "artifactCount",
    "contentSha256",
  ]) {
    if (!(key in record)) {
      throw new Error(`Execution plan blueprint is missing field: ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Execution plan blueprint has unsupported field: ${key}`);
    }
  }
  if (record["kind"] !== "napier.execution-plan-blueprint") {
    throw new Error("Execution plan blueprint kind is invalid");
  }
  if (record["schemaVersion"] !== 1) {
    throw new Error("Execution plan blueprint schemaVersion is unsupported");
  }
  if (record["apiVersion"] !== NAPIER_API_VERSION) {
    throw new Error("Execution plan blueprint API version is unsupported");
  }
  assertIsoString(record["generatedAt"], "generatedAt");
  if (!boundedString(record["title"], 1, 120)) {
    throw new Error("Execution plan blueprint title is invalid");
  }
  if (!boundedString(record["objective"], 1, 4_000)) {
    throw new Error("Execution plan blueprint objective is invalid");
  }
  assertBlueprintSource(recordField(record, "source"));
  const steps = parseBlueprintSteps(record["steps"]);
  const artifacts =
    record["artifacts"] === undefined
      ? undefined
      : parseBlueprintArtifacts(record["artifacts"]);
  const stepCount = record["stepCount"];
  const artifactCount = record["artifactCount"];
  if (
    typeof stepCount !== "number" ||
    !Number.isSafeInteger(stepCount) ||
    stepCount !== steps.length ||
    typeof artifactCount !== "number" ||
    !Number.isSafeInteger(artifactCount) ||
    artifactCount !== (artifacts?.length ?? 0)
  ) {
    throw new Error("Execution plan blueprint counts are invalid");
  }
  createExecutionPlan("thread_blueprint_validation", {
    objective: record["objective"],
    steps,
    ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
  });
  const contentSha256 = stringField(record, "contentSha256");
  assertSha256(contentSha256, "contentSha256");
  const blueprint = input as ExecutionPlanBlueprint;
  const computed = hashExecutionPlanBlueprintContent(
    executionPlanBlueprintContent(blueprint),
  );
  if (computed !== contentSha256) {
    throw new Error("Execution plan blueprint content hash mismatch");
  }
  return structuredClone(blueprint);
}

export function executionPlanRequestFromBlueprint(
  blueprint: ExecutionPlanBlueprint,
  objectiveOverride?: string,
): CreateExecutionPlanRequest {
  const validated = validateExecutionPlanBlueprint(blueprint);
  const objective =
    objectiveOverride === undefined
      ? validated.objective
      : normalizeObjectiveOverride(objectiveOverride);
  return {
    objective,
    steps: structuredClone(validated.steps),
    ...(validated.artifacts && validated.artifacts.length > 0
      ? { artifacts: structuredClone(validated.artifacts) }
      : {}),
  };
}

export function createExecutionPlanBlueprintRecord(input: {
  id: string;
  name?: string;
  description?: string;
  blueprint: ExecutionPlanBlueprint;
  createdByThreadId: string;
  createdAt?: string;
}): ExecutionPlanBlueprintRecord {
  const blueprint = validateExecutionPlanBlueprint(input.blueprint);
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertIsoString(createdAt, "record.createdAt");
  const content: ExecutionPlanBlueprintRecord = {
    id: normalizeRecordId(input.id),
    name: normalizeRecordName(input.name ?? blueprint.title),
    description: normalizeRecordDescription(input.description),
    status: "active",
    blueprint,
    blueprintSha256: blueprint.contentSha256,
    sourceThreadId: blueprint.source.threadId,
    sourcePlanId: blueprint.source.planId,
    sourcePlanRevision: blueprint.source.planRevision,
    sourcePlanArchiveSha256: blueprint.source.planArchiveSha256,
    sourceEventStreamSha256: blueprint.source.eventStreamSha256,
    createdByThreadId: normalizeThreadId(input.createdByThreadId),
    createdAt,
    updatedAt: createdAt,
  };
  return validateExecutionPlanBlueprintRecord(content);
}

export function setExecutionPlanBlueprintRecordStatus(
  record: ExecutionPlanBlueprintRecord,
  status: ExecutionPlanBlueprintRecordStatus,
  updatedAt = new Date().toISOString(),
): ExecutionPlanBlueprintRecord {
  const current = validateExecutionPlanBlueprintRecord(record);
  if (status !== "active" && status !== "archived") {
    throw new Error("Execution plan blueprint record status is invalid");
  }
  assertIsoString(updatedAt, "record.updatedAt");
  const { archivedAt: _archivedAt, ...base } = current;
  return validateExecutionPlanBlueprintRecord({
    ...base,
    status,
    updatedAt,
    ...(status === "archived" ? { archivedAt: updatedAt } : {}),
  });
}

export function validateExecutionPlanBlueprintRecord(
  input: unknown,
): ExecutionPlanBlueprintRecord {
  const record = recordField({ record: input }, "record");
  const allowedKeys = new Set([
    "id",
    "name",
    "description",
    "status",
    "blueprint",
    "blueprintSha256",
    "sourceThreadId",
    "sourcePlanId",
    "sourcePlanRevision",
    "sourcePlanArchiveSha256",
    "sourceEventStreamSha256",
    "createdByThreadId",
    "createdAt",
    "updatedAt",
    "archivedAt",
  ]);
  for (const key of [
    "id",
    "name",
    "description",
    "status",
    "blueprint",
    "blueprintSha256",
    "sourceThreadId",
    "sourcePlanId",
    "sourcePlanRevision",
    "sourcePlanArchiveSha256",
    "sourceEventStreamSha256",
    "createdByThreadId",
    "createdAt",
    "updatedAt",
  ]) {
    if (!(key in record)) {
      throw new Error(
        `Execution plan blueprint record is missing field: ${key}`,
      );
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Execution plan blueprint record has unsupported field: ${key}`,
      );
    }
  }
  const blueprint = validateExecutionPlanBlueprint(record["blueprint"]);
  const status = record["status"];
  if (status !== "active" && status !== "archived") {
    throw new Error("Execution plan blueprint record status is invalid");
  }
  const blueprintSha256 = stringField(record, "blueprintSha256");
  if (blueprintSha256 !== blueprint.contentSha256) {
    throw new Error("Execution plan blueprint record hash mismatch");
  }
  if (
    stringField(record, "sourceThreadId") !== blueprint.source.threadId ||
    stringField(record, "sourcePlanId") !== blueprint.source.planId ||
    record["sourcePlanRevision"] !== blueprint.source.planRevision ||
    stringField(record, "sourcePlanArchiveSha256") !==
      blueprint.source.planArchiveSha256 ||
    stringField(record, "sourceEventStreamSha256") !==
      blueprint.source.eventStreamSha256
  ) {
    throw new Error("Execution plan blueprint record source is invalid");
  }
  normalizeRecordId(stringField(record, "id"));
  normalizeRecordName(stringField(record, "name"));
  normalizeRecordDescription(stringField(record, "description"));
  normalizeThreadId(stringField(record, "createdByThreadId"));
  assertIsoString(record["createdAt"], "record.createdAt");
  assertIsoString(record["updatedAt"], "record.updatedAt");
  if (record["archivedAt"] !== undefined) {
    assertIsoString(record["archivedAt"], "record.archivedAt");
  }
  if (status === "active" && record["archivedAt"] !== undefined) {
    throw new Error("Execution plan blueprint record archive state is invalid");
  }
  if (status === "archived" && record["archivedAt"] === undefined) {
    throw new Error("Execution plan blueprint record archive state is invalid");
  }
  return structuredClone(input as ExecutionPlanBlueprintRecord);
}

export async function qualifyExecutionPlanBlueprintRecord(
  store: LocalStore,
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordQualification> {
  const qualifiedAt = new Date().toISOString();
  try {
    const record = validateExecutionPlanBlueprintRecord(
      store.getExecutionPlanBlueprintRecord(recordId),
    );
    const base = executionPlanBlueprintRecordQualificationBase(
      record,
      qualifiedAt,
    );
    if (record.status === "archived") {
      return {
        ...base,
        status: "archived",
        diagnostics: ["record_archived"],
      };
    }
    let archive: ExecutionPlanArchive;
    try {
      archive = await createExecutionPlanArchive(
        store,
        record.sourceThreadId,
        record.sourcePlanId,
      );
    } catch {
      return {
        ...base,
        status: "source_missing",
        diagnostics: ["source_missing"],
      };
    }
    const drifted =
      archive.plan.revision !== record.sourcePlanRevision ||
      archive.contentSha256 !== record.sourcePlanArchiveSha256 ||
      archive.eventStreamSha256 !== record.sourceEventStreamSha256;
    return {
      ...base,
      status: drifted ? "source_drift" : "qualified",
      diagnostics: drifted ? ["source_drift"] : [],
      actualSourcePlanRevision: archive.plan.revision,
      actualPlanArchiveSha256: archive.contentSha256,
      actualEventStreamSha256: archive.eventStreamSha256,
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [executionPlanBlueprintRecordQualificationDiagnostic(error)],
      recordId,
      stepCount: 0,
      artifactCount: 0,
      qualifiedAt,
    };
  }
}

export function hashExecutionPlanBlueprintContent(
  content: ExecutionPlanBlueprintContent,
): string {
  return sha256(canonicalJson(content));
}

function executionPlanBlueprintContent(
  blueprint: ExecutionPlanBlueprint,
): ExecutionPlanBlueprintContent {
  return {
    kind: blueprint.kind,
    schemaVersion: blueprint.schemaVersion,
    apiVersion: blueprint.apiVersion,
    title: blueprint.title,
    objective: blueprint.objective,
    source: blueprint.source,
    steps: blueprint.steps,
    ...(blueprint.artifacts && blueprint.artifacts.length > 0
      ? { artifacts: blueprint.artifacts }
      : {}),
    stepCount: blueprint.stepCount,
    artifactCount: blueprint.artifactCount,
  };
}

function executionPlanRequestFromArchive(
  archive: ExecutionPlanArchive,
): CreateExecutionPlanRequest {
  const activeStepIds = new Set(
    archive.plan.steps
      .filter((step) => step.status !== "skipped")
      .map((step) => step.id),
  );
  const steps = archive.plan.steps
    .filter((step) => activeStepIds.has(step.id))
    .map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      verification: step.verification,
      dependsOn: step.dependsOn.filter((stepId) => activeStepIds.has(stepId)),
    }));
  const artifacts = archive.plan.artifacts
    .filter((artifact) => artifact.status !== "superseded")
    .map((artifact) => ({
      id: artifact.id,
      path: artifact.path,
      kind: artifact.kind,
      description: artifact.description,
    }));
  return {
    objective: archive.plan.objective,
    steps,
    ...(artifacts.length > 0 ? { artifacts } : {}),
  };
}

function assertBlueprintSource(record: Record<string, unknown>): void {
  const allowedKeys = new Set([
    "type",
    "threadId",
    "planId",
    "planRevision",
    "planArchiveSha256",
    "eventStreamSha256",
  ]);
  for (const key of allowedKeys) {
    if (!(key in record)) {
      throw new Error(
        `Execution plan blueprint source is missing field: ${key}`,
      );
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Execution plan blueprint source has unsupported field: ${key}`,
      );
    }
  }
  if (
    record["type"] !== "plan" ||
    !boundedString(record["threadId"], 1, 100) ||
    !boundedString(record["planId"], 1, 100)
  ) {
    throw new Error("Execution plan blueprint source is invalid");
  }
  const planRevision = record["planRevision"];
  if (
    typeof planRevision !== "number" ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1
  ) {
    throw new Error("Execution plan blueprint source revision is invalid");
  }
  assertSha256(stringField(record, "planArchiveSha256"), "planArchiveSha256");
  assertSha256(stringField(record, "eventStreamSha256"), "eventStreamSha256");
}

function parseBlueprintSteps(
  input: unknown,
): CreateExecutionPlanRequest["steps"] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    throw new Error("Execution plan blueprint steps are invalid");
  }
  return input.map((value) => {
    const record = recordField({ step: value }, "step");
    const id = stringField(record, "id");
    if (
      !RESOURCE_ID.test(id) ||
      !boundedString(record["title"], 1, 120) ||
      !boundedString(record["description"], 1, 1_500) ||
      !boundedString(record["verification"], 1, 1_000)
    ) {
      throw new Error("Execution plan blueprint step is invalid");
    }
    const dependsOn = parseOptionalStringArray(record["dependsOn"]);
    return {
      id,
      title: record["title"],
      description: record["description"],
      verification: record["verification"],
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    };
  });
}

function parseBlueprintArtifacts(
  input: unknown,
): NonNullable<CreateExecutionPlanRequest["artifacts"]> {
  if (!Array.isArray(input) || input.length > 30) {
    throw new Error("Execution plan blueprint artifacts are invalid");
  }
  return input.map((value) => {
    const record = recordField({ artifact: value }, "artifact");
    const id = stringField(record, "id");
    const kind = record["kind"];
    if (
      !RESOURCE_ID.test(id) ||
      !boundedString(record["path"], 1, 500) ||
      !boundedString(record["description"], 1, 1_000) ||
      (kind !== undefined &&
        kind !== "file" &&
        kind !== "directory" &&
        kind !== "url" &&
        kind !== "other")
    ) {
      throw new Error("Execution plan blueprint artifact is invalid");
    }
    return {
      id,
      path: record["path"],
      description: record["description"],
      ...(typeof kind === "string" ? { kind } : {}),
    };
  });
}

function parseOptionalStringArray(input: unknown): string[] | undefined {
  if (input === undefined) return undefined;
  if (
    !Array.isArray(input) ||
    input.length > 30 ||
    !input.every((item) => typeof item === "string" && RESOURCE_ID.test(item))
  ) {
    throw new Error("Execution plan blueprint dependency list is invalid");
  }
  return [...new Set(input)];
}

function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
}

function normalizeObjectiveOverride(value: string): string {
  const normalized = value.trim();
  if (!boundedString(normalized, 1, 4_000)) {
    throw new Error("Execution plan blueprint objective override is invalid");
  }
  return normalized;
}

function normalizeRecordId(value: string): string {
  if (!/^blueprint_[a-z0-9]{8,80}$/.test(value)) {
    throw new Error("Execution plan blueprint record ID is invalid");
  }
  return value;
}

function normalizeThreadId(value: string): string {
  if (!/^thread_[a-z0-9]{8,80}$/.test(value)) {
    throw new Error("Execution plan blueprint record Thread ID is invalid");
  }
  return value;
}

function normalizeRecordName(value: string): string {
  const normalized = visibleText(value, 120, true);
  if (!normalized) {
    throw new Error("Execution plan blueprint record name is required");
  }
  return normalized;
}

function normalizeRecordDescription(value: string | undefined): string {
  return visibleText(value ?? "", 1_000, false);
}

function visibleText(
  value: string,
  maxLength: number,
  required: boolean,
): string {
  if (typeof value !== "string") {
    throw new Error("Execution plan blueprint record text is invalid");
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (required && !normalized) {
    throw new Error("Execution plan blueprint record text is required");
  }
  if (
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f<>]/.test(normalized)
  ) {
    throw new Error("Execution plan blueprint record text is invalid");
  }
  return normalized;
}

function executionPlanBlueprintDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("missing field")) return "missing_field";
  if (message.includes("unsupported field")) return "unsupported_field";
  if (message.includes("kind is invalid")) return "invalid_kind";
  if (message.includes("schemaVersion")) return "unsupported_schema_version";
  if (message.includes("API version")) return "unsupported_api_version";
  if (message.includes("content hash mismatch")) return "hash_mismatch";
  if (message.includes("Duplicate")) return "duplicate_resource_id";
  if (message.includes("dependency")) return "invalid_dependency";
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_blueprint";
}

function executionPlanBlueprintRecordQualificationBase(
  record: ExecutionPlanBlueprintRecord,
  qualifiedAt: string,
): Omit<ExecutionPlanBlueprintRecordQualification, "status" | "diagnostics"> {
  return {
    recordId: record.id,
    recordStatus: record.status,
    blueprintSha256: record.blueprintSha256,
    sourceThreadId: record.sourceThreadId,
    sourcePlanId: record.sourcePlanId,
    sourcePlanRevision: record.sourcePlanRevision,
    expectedPlanArchiveSha256: record.sourcePlanArchiveSha256,
    expectedEventStreamSha256: record.sourceEventStreamSha256,
    stepCount: record.blueprint.stepCount,
    artifactCount: record.blueprint.artifactCount,
    qualifiedAt,
  };
}

function executionPlanBlueprintRecordQualificationDiagnostic(
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not found")) return "record_missing";
  if (message.includes("hash mismatch")) return "record_hash_mismatch";
  if (message.includes("source is invalid")) return "record_source_invalid";
  if (message.includes("archive state is invalid")) {
    return "record_archive_state_invalid";
  }
  return "invalid_record";
}

function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
  }
  return value;
}

function assertSha256(value: string, field: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`Execution plan blueprint ${field} hash is invalid`);
  }
}

function assertIsoString(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
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
