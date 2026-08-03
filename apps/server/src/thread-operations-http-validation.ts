import type { ReviewSubagentOutcomeRequest } from "@napier/contracts";

import { parseModelRef, requestRecord } from "./http-request-validation.js";

export function parseReviewSubagentOutcomeRequest(
  input: unknown,
): ReviewSubagentOutcomeRequest | undefined {
  const record = requestRecord(input, ["model"]);
  const model = parseModelRef(record?.["model"]);
  return record && model ? { model } : undefined;
}

export function validWorkspaceTrashId(value: unknown): value is string {
  return typeof value === "string" && /^trash_[a-z0-9]{8,80}$/u.test(value);
}
