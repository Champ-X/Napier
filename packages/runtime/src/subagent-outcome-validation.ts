import type { SubagentOutcome } from "@napier/contracts";

import {
  buildSubagentOutcome,
  normalizeSubagentModel,
  parseStoredSubagentResult,
  parseSubagentResult,
} from "./subagent-outcome-model.js";
import { isSubagentRole } from "./subagent-role-instructions.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;

export function validateSubagentOutcome(input: unknown): SubagentOutcome {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Subagent outcome must be an object");
  }
  const schemaVersion = (input as Record<string, unknown>)["schemaVersion"];
  const sharedKeys = [
    "kind",
    "schemaVersion",
    "taskId",
    "role",
    "model",
    "summary",
    "items",
    "unknowns",
    "itemCount",
    "unknownCount",
    "promptSha256",
    "instructionsSha256",
    "resultSha256",
    "itemSetSha256",
    "contentSha256",
  ];
  const record = exactRecord(
    input,
    "Subagent outcome",
    schemaVersion === 1
      ? sharedKeys
      : schemaVersion === 2
        ? [...sharedKeys, "evidenceCount", "evidenceSetSha256"]
        : [],
  );
  if (
    record["kind"] !== "napier.subagent-outcome" ||
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    typeof record["taskId"] !== "string" ||
    !RESOURCE_ID.test(record["taskId"]) ||
    !isSubagentRole(record["role"])
  ) {
    throw new Error("Subagent outcome identity is invalid");
  }
  const parsed =
    schemaVersion === 1
      ? parseSubagentResult({
          summary: record["summary"],
          items: record["items"],
          unknowns: record["unknowns"],
        })
      : parseStoredSubagentResult({
          summary: record["summary"],
          items: record["items"],
          unknowns: record["unknowns"],
        });
  const itemCount = nonNegativeInteger(record["itemCount"], "itemCount");
  const unknownCount = nonNegativeInteger(
    record["unknownCount"],
    "unknownCount",
  );
  const evidenceCount =
    schemaVersion === 2
      ? nonNegativeInteger(record["evidenceCount"], "evidenceCount")
      : undefined;
  const promptSha256 = digest(record["promptSha256"], "promptSha256");
  const instructionsSha256 = digest(
    record["instructionsSha256"],
    "instructionsSha256",
  );
  const resultSha256 = digest(record["resultSha256"], "resultSha256");
  const expected = buildSubagentOutcome(
    {
      taskId: record["taskId"],
      role: record["role"],
      model: normalizeSubagentModel(record["model"]),
      promptSha256,
      resultSha256,
      ...parsed,
    },
    schemaVersion,
  );
  if (
    itemCount !== expected.itemCount ||
    unknownCount !== expected.unknownCount ||
    (schemaVersion === 2 && evidenceCount !== expected.evidenceCount) ||
    instructionsSha256 !== expected.instructionsSha256 ||
    record["itemSetSha256"] !== expected.itemSetSha256 ||
    (schemaVersion === 2 &&
      record["evidenceSetSha256"] !== expected.evidenceSetSha256) ||
    record["contentSha256"] !== expected.contentSha256
  ) {
    throw new Error("Subagent outcome hash evidence is invalid");
  }
  return expected;
}

function exactRecord(
  value: unknown,
  label: string,
  keys: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  const missing = keys.find((key) => !(key in record));
  if (unexpected) {
    throw new Error(`${label} has unsupported field: ${unexpected}`);
  }
  if (missing) throw new Error(`${label} is missing ${missing}`);
  return record;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`Subagent outcome ${label} is invalid`);
  }
  return value;
}
