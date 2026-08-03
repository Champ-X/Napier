import type {
  CreateExecutionPlanFromBlueprintRecordRequest,
  CreateExecutionPlanFromBlueprintRequest,
  ExecutionPlanBlueprint,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseCreateExecutionPlanFromBlueprintRequest(
  input: unknown,
): CreateExecutionPlanFromBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint", "objective"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  const objective =
    record["objective"] === undefined ||
    !boundedString(record["objective"], 1, 4_000)
      ? undefined
      : record["objective"];
  if (record["objective"] !== undefined && !objective) return undefined;
  return {
    blueprint: record["blueprint"] as ExecutionPlanBlueprint,
    ...(objective ? { objective } : {}),
  };
}

export function parseCreateExecutionPlanFromBlueprintRecordRequest(
  input: unknown,
): CreateExecutionPlanFromBlueprintRecordRequest | undefined {
  const record = requestRecord(input, [
    "recordId",
    "objective",
    "expectedPreviewSha256",
  ]);
  if (!record || !boundedString(record["recordId"], 1, 100)) {
    return undefined;
  }
  const objective =
    record["objective"] === undefined ||
    !boundedString(record["objective"], 1, 4_000)
      ? undefined
      : record["objective"];
  if (record["objective"] !== undefined && !objective) return undefined;
  const expectedPreviewSha256 = record["expectedPreviewSha256"];
  if (
    expectedPreviewSha256 !== undefined &&
    (typeof expectedPreviewSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256))
  ) {
    return undefined;
  }
  return {
    recordId: record["recordId"],
    ...(objective ? { objective } : {}),
    ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
  };
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
