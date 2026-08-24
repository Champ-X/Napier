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

import { createExecutionPlanArchive } from "./plan-archives.js";
import type { WorkflowBlueprintStorePort } from "./store-port.js";
import {
  assertIsoString,
  boundedString,
  executionPlanBlueprintDiagnostic,
  hashExecutionPlanBlueprintContent,
  normalizeTitle,
  recordField,
  stringField,
  validateExecutionPlanBlueprint,
  type ExecutionPlanBlueprintContent,
} from "./workflow-blueprint-validation.js";

export {
  hashExecutionPlanBlueprintContent,
  validateExecutionPlanBlueprint,
  type ExecutionPlanBlueprintContent,
} from "./workflow-blueprint-validation.js";

export const MAX_EXECUTION_PLAN_BLUEPRINT_BYTES = 2 * 1024 * 1024;

export async function createExecutionPlanBlueprint(
  store: import("./store-port.js").PlanArchiveStorePort,
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
  store: WorkflowBlueprintStorePort,
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
