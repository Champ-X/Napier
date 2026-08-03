import type {
  CreateExecutionPlanRequest,
  ExecutionPlanArchive,
  ExecutionPlanBlueprint,
  ReplanExecutionPlanRequest,
  ReviewExecutionPlanReplanDraftRequest,
  VerifyExecutionPlanArchiveRequest,
  VerifyExecutionPlanBlueprintRequest,
} from "@napier/contracts";

import { parseModelRef, requestRecord } from "./http-request-validation.js";

export function parseCreateExecutionPlanRequest(
  input: unknown,
): CreateExecutionPlanRequest | undefined {
  const record = requestRecord(input, ["objective", "steps", "artifacts"]);
  if (!record || !boundedString(record["objective"], 1, 4_000)) {
    return undefined;
  }
  const steps = parsePlanStepInputs(record["steps"]);
  if (!steps) return undefined;
  const artifacts =
    record["artifacts"] === undefined
      ? undefined
      : parsePlanArtifactInputs(record["artifacts"]);
  if (record["artifacts"] !== undefined && !artifacts) return undefined;
  return {
    objective: record["objective"],
    steps,
    ...(artifacts ? { artifacts } : {}),
  };
}

export function parseReplanExecutionPlanRequest(
  input: unknown,
): ReplanExecutionPlanRequest | undefined {
  const record = requestRecord(input, [
    "expectedRevision",
    "strategy",
    "reason",
    "evidence",
    "supersedeStepIds",
    "supersedeArtifactIds",
    "dependencyUpdates",
    "addSteps",
    "addArtifacts",
  ]);
  if (!record) return undefined;
  const core = parseReplanCore(record);
  const mutations = parseReplanMutations(record);
  return core && mutations ? { ...core, ...mutations } : undefined;
}

type ReplanCore = Pick<
  ReplanExecutionPlanRequest,
  "expectedRevision" | "strategy" | "reason" | "evidence"
>;

type ReplanMutations = Pick<
  ReplanExecutionPlanRequest,
  | "supersedeStepIds"
  | "supersedeArtifactIds"
  | "dependencyUpdates"
  | "addSteps"
  | "addArtifacts"
>;

function parseReplanCore(
  record: Record<string, unknown>,
): ReplanCore | undefined {
  const expectedRevision = record["expectedRevision"];
  const strategy = record["strategy"];
  const reason = record["reason"];
  const evidence = record["evidence"];
  if (
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    !validReplanStrategy(strategy) ||
    !boundedString(reason, 1, 1_000) ||
    !boundedString(evidence, 1, 2_000)
  ) {
    return undefined;
  }
  return { expectedRevision, strategy, reason, evidence };
}

function parseReplanMutations(
  record: Record<string, unknown>,
): ReplanMutations | undefined {
  const supersedeStepIds = parseOptionalArray(
    record,
    "supersedeStepIds",
    (value) => parseBoundedStringArray(value, 30, 1, 64),
  );
  const supersedeArtifactIds = parseOptionalArray(
    record,
    "supersedeArtifactIds",
    (value) => parseBoundedStringArray(value, 30, 1, 64),
  );
  const dependencyUpdates = parseOptionalArray(
    record,
    "dependencyUpdates",
    parsePlanDependencyUpdates,
  );
  const addSteps = parseOptionalArray(record, "addSteps", parsePlanStepInputs);
  const addArtifacts = parseOptionalArray(
    record,
    "addArtifacts",
    parsePlanArtifactInputs,
    true,
  );
  const parsed = [
    supersedeStepIds,
    supersedeArtifactIds,
    dependencyUpdates,
    addSteps,
    addArtifacts,
  ];
  if (parsed.some((field) => !field.valid)) return undefined;
  const mutations: ReplanMutations = {};
  if (supersedeStepIds.value?.length) {
    mutations.supersedeStepIds = supersedeStepIds.value;
  }
  if (supersedeArtifactIds.value?.length) {
    mutations.supersedeArtifactIds = supersedeArtifactIds.value;
  }
  if (dependencyUpdates.value?.length) {
    mutations.dependencyUpdates = dependencyUpdates.value;
  }
  if (addSteps.value) mutations.addSteps = addSteps.value;
  if (addArtifacts.value?.length) mutations.addArtifacts = addArtifacts.value;
  return Object.keys(mutations).length > 0 ? mutations : undefined;
}

function parseOptionalArray<T extends readonly unknown[]>(
  record: Record<string, unknown>,
  key: string,
  parse: (input: unknown) => T | undefined,
  requireNonEmpty = false,
): { valid: boolean; value?: T } {
  const input = record[key];
  if (input === undefined) return { valid: true };
  const value = parse(input);
  if (!value || (requireNonEmpty && value.length === 0)) {
    return { valid: false };
  }
  return { valid: true, value };
}

function validReplanStrategy(
  value: unknown,
): value is ReplanExecutionPlanRequest["strategy"] {
  return (
    value === "recover_blocked" ||
    value === "scope_change" ||
    value === "artifact_drift"
  );
}

export function parseReviewExecutionPlanReplanDraftRequest(
  input: unknown,
): ReviewExecutionPlanReplanDraftRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["model"]);
  if (!record) return undefined;
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return { ...(model ? { model } : {}) };
}

export function parseVerifyExecutionPlanArchiveRequest(
  input: unknown,
): VerifyExecutionPlanArchiveRequest | undefined {
  const record = requestRecord(input, ["archive"]);
  if (!record || record["archive"] === undefined) return undefined;
  return { archive: record["archive"] as ExecutionPlanArchive };
}

export function parseVerifyExecutionPlanBlueprintRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  return { blueprint: record["blueprint"] as ExecutionPlanBlueprint };
}

function parsePlanStepInputs(
  input: unknown,
): CreateExecutionPlanRequest["steps"] | undefined {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    return undefined;
  }
  const output: CreateExecutionPlanRequest["steps"] = [];
  for (const value of input) {
    const record = requestRecord(value, [
      "id",
      "title",
      "description",
      "verification",
      "dependsOn",
    ]);
    if (
      !record ||
      !boundedString(record["id"], 1, 64) ||
      !boundedString(record["title"], 1, 120) ||
      !boundedString(record["description"], 1, 1_500) ||
      !boundedString(record["verification"], 1, 1_000)
    ) {
      return undefined;
    }
    const dependsOn =
      record["dependsOn"] === undefined
        ? undefined
        : parseBoundedStringArray(record["dependsOn"], 30, 1, 64);
    if (record["dependsOn"] !== undefined && !dependsOn) return undefined;
    output.push({
      id: record["id"],
      title: record["title"],
      description: record["description"],
      verification: record["verification"],
      ...(dependsOn ? { dependsOn } : {}),
    });
  }
  return output;
}

function parsePlanDependencyUpdates(
  input: unknown,
): ReplanExecutionPlanRequest["dependencyUpdates"] | undefined {
  if (!Array.isArray(input) || input.length > 30) return undefined;
  const output: NonNullable<ReplanExecutionPlanRequest["dependencyUpdates"]> =
    [];
  for (const value of input) {
    const record = requestRecord(value, ["stepId", "dependsOn"]);
    if (!record || !boundedString(record["stepId"], 1, 64)) {
      return undefined;
    }
    const dependsOn = parseBoundedStringArray(record["dependsOn"], 30, 1, 64);
    if (!dependsOn) return undefined;
    output.push({ stepId: record["stepId"], dependsOn });
  }
  return output;
}

function parsePlanArtifactInputs(
  input: unknown,
): CreateExecutionPlanRequest["artifacts"] | undefined {
  if (!Array.isArray(input) || input.length > 30) return undefined;
  const output: NonNullable<CreateExecutionPlanRequest["artifacts"]> = [];
  for (const value of input) {
    const record = requestRecord(value, ["id", "path", "kind", "description"]);
    const kind = record?.["kind"];
    if (
      !record ||
      !boundedString(record["id"], 1, 64) ||
      !boundedString(record["path"], 1, 500) ||
      !boundedString(record["description"], 1, 1_000) ||
      (kind !== undefined &&
        kind !== "file" &&
        kind !== "directory" &&
        kind !== "url" &&
        kind !== "other")
    ) {
      return undefined;
    }
    output.push({
      id: record["id"],
      path: record["path"],
      description: record["description"],
      ...(typeof kind === "string" ? { kind } : {}),
    });
  }
  return output;
}

function parseBoundedStringArray(
  input: unknown,
  maxItems: number,
  minLength: number,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  return input.every((value) => boundedString(value, minLength, maxLength))
    ? input
    : undefined;
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
