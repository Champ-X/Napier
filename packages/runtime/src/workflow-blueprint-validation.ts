import {
  NAPIER_API_VERSION,
  type CreateExecutionPlanRequest,
  type ExecutionPlanBlueprint,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createExecutionPlan } from "./plans.js";

export type ExecutionPlanBlueprintContent = Omit<
  ExecutionPlanBlueprint,
  "generatedAt" | "contentSha256"
>;

export function hashExecutionPlanBlueprintContent(
  content: ExecutionPlanBlueprintContent,
): string {
  return sha256(canonicalJson(content));
}

export const SHA256 = /^[a-f0-9]{64}$/;

export const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

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

export function executionPlanBlueprintContent(
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

export function assertBlueprintSource(record: Record<string, unknown>): void {
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

export function parseBlueprintSteps(
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

export function parseBlueprintArtifacts(
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

export function parseOptionalStringArray(input: unknown): string[] | undefined {
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

export function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
}

export function executionPlanBlueprintDiagnostic(error: unknown): string {
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

export function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

export function stringField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
  }
  return value;
}

export function assertSha256(value: string, field: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`Execution plan blueprint ${field} hash is invalid`);
  }
}

export function assertIsoString(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Execution plan blueprint ${field} is invalid`);
  }
}

export function boundedString(
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
