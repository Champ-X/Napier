import type {
  ExecutionPlanBlueprint,
  SaveExecutionPlanBlueprintRequest,
  SelectExecutionPlanBlueprintRecordRequest,
  SetExecutionPlanBlueprintRecordStatusRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseSaveExecutionPlanBlueprintRequest(
  input: unknown,
): SaveExecutionPlanBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint", "name", "description"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  const name =
    record["name"] === undefined || !boundedString(record["name"], 1, 120)
      ? undefined
      : record["name"];
  if (record["name"] !== undefined && !name) return undefined;
  const description =
    record["description"] === undefined ||
    !boundedString(record["description"], 0, 1_000)
      ? undefined
      : record["description"];
  if (record["description"] !== undefined && description === undefined) {
    return undefined;
  }
  return {
    blueprint: record["blueprint"] as ExecutionPlanBlueprint,
    ...(name ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

export function parseSelectExecutionPlanBlueprintRecordRequest(
  input: unknown,
): SelectExecutionPlanBlueprintRecordRequest | undefined {
  const record = requestRecord(input, ["objective", "policyTemplate"]);
  if (!record) return undefined;
  const objective =
    record["objective"] === undefined
      ? undefined
      : typeof record["objective"] === "string"
        ? record["objective"].trim()
        : undefined;
  const policyTemplate = record["policyTemplate"];
  if (
    record["objective"] !== undefined &&
    (!objective || !boundedString(objective, 1, 4_000))
  ) {
    return undefined;
  }
  if (
    policyTemplate !== undefined &&
    policyTemplate !== "balanced" &&
    policyTemplate !== "delivery_first" &&
    policyTemplate !== "portfolio_first"
  ) {
    return undefined;
  }
  return {
    ...(objective ? { objective } : {}),
    ...(policyTemplate ? { policyTemplate } : {}),
  };
}

export function parseSetExecutionPlanBlueprintRecordStatusRequest(
  input: unknown,
): SetExecutionPlanBlueprintRecordStatusRequest | undefined {
  const record = requestRecord(input, ["status"]);
  const status = record?.["status"];
  if (!record || (status !== "active" && status !== "archived")) {
    return undefined;
  }
  return { status };
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
