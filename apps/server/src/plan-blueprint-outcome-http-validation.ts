import type {
  ExecutionPlanBlueprintOutcomeReviewCriteria,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  ReviewExecutionPlanBlueprintRecordOutcomesRequest,
} from "@napier/contracts";

import { parseModelRef, requestRecord } from "./http-request-validation.js";

export function parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest(
  input: unknown,
): PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest | undefined {
  const record = requestRecord(input, [
    "outcomes",
    "policy",
    "review",
    "reviewGate",
  ]);
  if (!record || record["outcomes"] === undefined) return undefined;
  const policy = parseOutcomeBaselinePolicy(record["policy"]);
  if (record["policy"] !== undefined && !policy) return undefined;
  const reviewGate =
    record["reviewGate"] === undefined
      ? undefined
      : parseOutcomeBaselineReviewGate(record["reviewGate"]);
  if (record["reviewGate"] !== undefined && !reviewGate) return undefined;
  if (record["reviewGate"] !== undefined && record["review"] === undefined) {
    return undefined;
  }
  return {
    outcomes: record["outcomes"],
    ...(policy ? { policy } : {}),
    ...(record["review"] !== undefined ? { review: record["review"] } : {}),
    ...(reviewGate ? { reviewGate } : {}),
  };
}

export function parseReviewExecutionPlanBlueprintRecordOutcomesRequest(
  input: unknown,
): ReviewExecutionPlanBlueprintRecordOutcomesRequest | undefined {
  const record = requestRecord(input, ["model", "criteria"]);
  const model = parseModelRef(record?.["model"]);
  if (!record || !model) return undefined;
  const criteria =
    record["criteria"] === undefined
      ? undefined
      : parseOutcomeReviewCriteria(record["criteria"]);
  if (record["criteria"] !== undefined && !criteria) return undefined;
  return {
    model,
    ...(criteria ? { criteria } : {}),
  };
}

function parseOutcomeReviewCriteria(
  input: unknown,
): ExecutionPlanBlueprintOutcomeReviewCriteria | undefined {
  const record = requestRecord(input, ["name", "criteria"]);
  if (!record || !boundedString(record["name"], 1, 100)) return undefined;
  const criteria = record["criteria"];
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 6) {
    return undefined;
  }
  const parsedCriteria = criteria.map((value) => {
    const item = requestRecord(value, ["id", "name", "description"]);
    if (
      !item ||
      !boundedString(item["id"], 1, 64) ||
      !/^[a-z][a-z0-9_-]{0,63}$/u.test(item["id"]) ||
      !boundedString(item["name"], 1, 80) ||
      !boundedString(item["description"], 1, 300)
    ) {
      return undefined;
    }
    return {
      id: item["id"].trim().toLowerCase(),
      name: item["name"].trim(),
      description: item["description"].trim(),
    };
  });
  if (parsedCriteria.some((criterion) => !criterion)) return undefined;
  const ids = new Set(parsedCriteria.map((criterion) => criterion!.id));
  if (ids.size !== parsedCriteria.length) return undefined;
  return {
    name: record["name"].trim(),
    criteria:
      parsedCriteria as ExecutionPlanBlueprintOutcomeReviewCriteria["criteria"],
  };
}

function parseOutcomeBaselinePolicy(
  input: unknown,
):
  | PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["policy"]
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "minReplayCount",
    "minCompletionRateBps",
    "maxBlockedCount",
    "maxInvalidCount",
  ]);
  if (!record) return undefined;
  const values = {
    minReplayCount: optionalBoundedInteger(record["minReplayCount"], 1, 10_000),
    minCompletionRateBps: optionalBoundedInteger(
      record["minCompletionRateBps"],
      0,
      10_000,
    ),
    maxBlockedCount: optionalBoundedInteger(
      record["maxBlockedCount"],
      0,
      10_000,
    ),
    maxInvalidCount: optionalBoundedInteger(
      record["maxInvalidCount"],
      0,
      10_000,
    ),
  };
  if (Object.values(values).includes(false)) return undefined;
  const policy: NonNullable<
    PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["policy"]
  > = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number") {
      policy[key as keyof typeof policy] = value;
    }
  }
  return policy;
}

function parseOutcomeBaselineReviewGate(
  input: unknown,
):
  | PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["reviewGate"]
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["minScore", "maxRisk"]);
  if (!record) return undefined;
  const minScore = optionalBoundedInteger(record["minScore"], 0, 100);
  const maxRisk = record["maxRisk"];
  if (
    minScore === false ||
    (maxRisk !== undefined &&
      maxRisk !== "low" &&
      maxRisk !== "medium" &&
      maxRisk !== "high")
  ) {
    return undefined;
  }
  return {
    ...(typeof minScore === "number" ? { minScore } : {}),
    ...(maxRisk ? { maxRisk } : {}),
  };
}

function optionalBoundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : false;
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
