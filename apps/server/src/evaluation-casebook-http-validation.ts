import type {
  CreateEvaluationCasebookRequest,
  CurateEvaluationCaseRequest,
  ExecuteEvaluationCasebookRequest,
  RemoveEvaluationCaseRequest,
  UpdateEvaluationCasebookRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseCreateEvaluationCasebookRequest(
  input: unknown,
): CreateEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "name", "description"]);
  if (
    !record ||
    !nonEmptyText(record["threadId"]) ||
    !validCasebookName(record["name"]) ||
    !validCasebookDescription(record["description"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    name: record["name"],
    ...(typeof record["description"] === "string"
      ? { description: record["description"] }
      : {}),
  };
}

export function parseUpdateEvaluationCasebookRequest(
  input: unknown,
): UpdateEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "name", "description"]);
  if (
    !record ||
    !nonEmptyText(record["threadId"]) ||
    (record["name"] !== undefined && !validCasebookName(record["name"])) ||
    !validCasebookDescription(record["description"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    ...(typeof record["name"] === "string" ? { name: record["name"] } : {}),
    ...(typeof record["description"] === "string"
      ? { description: record["description"] }
      : {}),
  };
}

export function parseCurateEvaluationCaseRequest(
  input: unknown,
): CurateEvaluationCaseRequest | undefined {
  const record = requestRecord(input, ["threadId", "evaluationId"]);
  return record &&
    nonEmptyText(record["threadId"]) &&
    nonEmptyText(record["evaluationId"])
    ? {
        threadId: record["threadId"],
        evaluationId: record["evaluationId"],
      }
    : undefined;
}

export function parseRemoveEvaluationCaseRequest(
  input: unknown,
): RemoveEvaluationCaseRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  return record && nonEmptyText(record["threadId"])
    ? { threadId: record["threadId"] }
    : undefined;
}

export function parseExecuteEvaluationCasebookRequest(
  input: unknown,
): ExecuteEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "model", "gate"]);
  const model = requestRecord(record?.["model"], ["provider", "id"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : requestRecord(record["gate"], [
          "minimumAgreementRate",
          "allowInconclusive",
        ]);
  const minimumAgreementRate = gate?.["minimumAgreementRate"];
  const allowInconclusive = gate?.["allowInconclusive"];
  if (
    !record ||
    !nonEmptyText(record["threadId"]) ||
    !model ||
    !nonEmptyText(model["provider"]) ||
    !nonEmptyText(model["id"]) ||
    (record["gate"] !== undefined && !gate) ||
    (minimumAgreementRate !== undefined &&
      (typeof minimumAgreementRate !== "number" ||
        !Number.isFinite(minimumAgreementRate) ||
        minimumAgreementRate < 0 ||
        minimumAgreementRate > 1)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    model: {
      provider: model["provider"],
      id: model["id"],
    },
    ...(gate
      ? {
          gate: {
            ...(typeof minimumAgreementRate === "number"
              ? { minimumAgreementRate }
              : {}),
            ...(typeof allowInconclusive === "boolean"
              ? { allowInconclusive }
              : {}),
          },
        }
      : {}),
  };
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function validCasebookName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= 100;
}

function validCasebookDescription(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.replace(/\s+/g, " ").trim().length <= 1_000)
  );
}
