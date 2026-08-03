import type {
  CreateEvaluationSuiteRequest,
  CreateRunEvaluationRequest,
  UpdateEvaluationSuiteRequest,
} from "@napier/contracts";

import {
  normalizeBoundedText,
  parseModelRef,
  requestRecord,
} from "./http-request-validation.js";

export function parseCreateRunEvaluationRequest(
  input: unknown,
): CreateRunEvaluationRequest | undefined {
  const record = requestRecord(input, [
    "leftRunId",
    "rightRunId",
    "rubric",
    "model",
  ]);
  const leftRunId = record?.["leftRunId"];
  const rightRunId = record?.["rightRunId"];
  const rubric =
    record?.["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  if (
    !record ||
    !validRunId(leftRunId) ||
    !validRunId(rightRunId) ||
    leftRunId === rightRunId ||
    (record["rubric"] !== undefined && !rubric) ||
    (record["model"] !== undefined && !model)
  ) {
    return undefined;
  }
  return {
    leftRunId,
    rightRunId,
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
  };
}

export function parseCreateEvaluationSuiteRequest(
  input: unknown,
): CreateEvaluationSuiteRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "baselineRunId",
    "candidateRunIds",
    "rubric",
    "model",
    "gate",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 100);
  const baselineRunId = record?.["baselineRunId"];
  const candidateRunIds = parseRunIdArray(record?.["candidateRunIds"], 1, 8);
  const rubric =
    record?.["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : parseEvaluationSuiteGate(record["gate"]);
  if (
    !record ||
    !name ||
    !validRunId(baselineRunId) ||
    !candidateRunIds ||
    candidateRunIds.includes(baselineRunId) ||
    (record["rubric"] !== undefined && !rubric) ||
    (record["model"] !== undefined && !model) ||
    (record["gate"] !== undefined && !gate)
  ) {
    return undefined;
  }
  return {
    name,
    baselineRunId,
    candidateRunIds,
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
    ...(gate ? { gate } : {}),
  };
}

export function parseUpdateEvaluationSuiteRequest(
  input: unknown,
): UpdateEvaluationSuiteRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "baselineRunId",
    "candidateRunIds",
    "rubric",
    "model",
    "gate",
  ]);
  if (!record) return undefined;
  const name =
    record["name"] === undefined
      ? undefined
      : normalizeBoundedText(record["name"], 1, 100);
  const baselineRunId = record["baselineRunId"];
  const candidateRunIds =
    record["candidateRunIds"] === undefined
      ? undefined
      : parseRunIdArray(record["candidateRunIds"], 1, 8);
  const rubric =
    record["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  const gate =
    record["gate"] === undefined
      ? undefined
      : parseEvaluationSuiteGate(record["gate"]);
  if (
    !validSuiteUpdateRuns(record, name, baselineRunId, candidateRunIds) ||
    !validSuiteUpdateOptions(record, rubric, model, gate)
  ) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(typeof baselineRunId === "string" ? { baselineRunId } : {}),
    ...(candidateRunIds ? { candidateRunIds } : {}),
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
    ...(gate ? { gate } : {}),
  };
}

function validSuiteUpdateRuns(
  record: Record<string, unknown>,
  name: string | undefined,
  baselineRunId: unknown,
  candidateRunIds: string[] | undefined,
): boolean {
  return (
    (record["name"] === undefined || Boolean(name)) &&
    (baselineRunId === undefined || validRunId(baselineRunId)) &&
    (record["candidateRunIds"] === undefined || Boolean(candidateRunIds)) &&
    !(
      typeof baselineRunId === "string" &&
      candidateRunIds?.includes(baselineRunId)
    )
  );
}

function validSuiteUpdateOptions(
  record: Record<string, unknown>,
  rubric: unknown,
  model: unknown,
  gate: unknown,
): boolean {
  return (
    (record["rubric"] === undefined || Boolean(rubric)) &&
    (record["model"] === undefined || Boolean(model)) &&
    (record["gate"] === undefined || Boolean(gate))
  );
}

function parseEvaluationRubric(
  input: unknown,
): NonNullable<CreateRunEvaluationRequest["rubric"]> | undefined {
  const record = requestRecord(input, ["name", "criteria"]);
  const name = normalizeBoundedText(record?.["name"], 1, 80);
  const criteria = record
    ? parseEvaluationCriteria(record["criteria"])
    : undefined;
  return record && name && criteria ? { name, criteria } : undefined;
}

function parseEvaluationCriteria(
  input: unknown,
): NonNullable<CreateRunEvaluationRequest["rubric"]>["criteria"] | undefined {
  if (!Array.isArray(input) || input.length < 2 || input.length > 6) {
    return undefined;
  }
  const output: NonNullable<CreateRunEvaluationRequest["rubric"]>["criteria"] =
    [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const value of input) {
    const record = requestRecord(value, ["id", "name", "description"]);
    const id =
      typeof record?.["id"] === "string"
        ? record["id"].trim().toLowerCase()
        : undefined;
    const name = normalizeBoundedText(record?.["name"], 1, 80);
    const description = normalizeBoundedText(record?.["description"], 1, 300);
    const normalizedName = name?.toLowerCase();
    if (
      !record ||
      !id ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(id) ||
      !name ||
      !description ||
      !normalizedName ||
      seenIds.has(id) ||
      seenNames.has(normalizedName)
    ) {
      return undefined;
    }
    seenIds.add(id);
    seenNames.add(normalizedName);
    output.push({ id, name, description });
  }
  return output;
}

function parseEvaluationSuiteGate(
  input: unknown,
): NonNullable<CreateEvaluationSuiteRequest["gate"]> | undefined {
  const record = requestRecord(input, [
    "minimumPassRate",
    "minimumCandidateScore",
    "allowInconclusive",
  ]);
  const minimumPassRate = record?.["minimumPassRate"];
  const minimumCandidateScore = record?.["minimumCandidateScore"];
  const allowInconclusive = record?.["allowInconclusive"];
  if (
    !record ||
    (minimumPassRate !== undefined &&
      (typeof minimumPassRate !== "number" ||
        !Number.isFinite(minimumPassRate) ||
        minimumPassRate < 0 ||
        minimumPassRate > 1)) ||
    (minimumCandidateScore !== undefined &&
      (typeof minimumCandidateScore !== "number" ||
        !Number.isFinite(minimumCandidateScore) ||
        minimumCandidateScore < 1 ||
        minimumCandidateScore > 5)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  return {
    ...(typeof minimumPassRate === "number" ? { minimumPassRate } : {}),
    ...(typeof minimumCandidateScore === "number"
      ? { minimumCandidateScore }
      : {}),
    ...(typeof allowInconclusive === "boolean" ? { allowInconclusive } : {}),
  };
}

function parseRunIdArray(
  input: unknown,
  minItems: number,
  maxItems: number,
): string[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < minItems ||
    input.length > maxItems ||
    !input.every((value) => validRunId(value))
  ) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length ? [...unique] : undefined;
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^run_[a-z0-9]{8,80}$/.test(value);
}
