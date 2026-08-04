import type {
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  VerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
} from "@napier/contracts";

import { isSha256String, requestRecord } from "./http-request-validation.js";

export function parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return { history: record["history"] };
}

export function parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest | undefined {
  const record = requestRecord(input, ["outcomes"]);
  if (!record || record["outcomes"] === undefined) return undefined;
  return { outcomes: record["outcomes"] };
}

export function parseVerifyExecutionPlanBlueprintRecordReplayEventRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayEventRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "eventId",
    "seq",
    "eventSha256",
  ]);
  if (
    !record ||
    !boundedString(record["threadId"], 1, 100) ||
    !boundedString(record["eventId"], 1, 100) ||
    typeof record["seq"] !== "number" ||
    !Number.isSafeInteger(record["seq"]) ||
    record["seq"] < 1 ||
    !isSha256String(record["eventSha256"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    eventId: record["eventId"],
    seq: record["seq"],
    eventSha256: record["eventSha256"],
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
