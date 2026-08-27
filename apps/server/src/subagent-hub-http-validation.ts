import type {
  CancelSubagentHubTaskRequestV1,
  ReviveSubagentHubTaskRequestV1,
  SteerSubagentHubTaskRequestV1,
} from "@napier/contracts/subagent-hub";

import { requestRecord } from "./http-request-validation.js";

const MAX_STEERING_CHARACTERS = 8_000;
const MAX_CANCELLATION_REASON_CHARACTERS = 500;
const DISALLOWED_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function parseSteerSubagentHubTaskRequest(
  input: unknown,
): SteerSubagentHubTaskRequestV1 | undefined {
  const record = requestRecord(input, [
    "kind",
    "schemaVersion",
    "expectedTaskRevision",
    "messageKind",
    "text",
  ]);
  const expectedTaskRevision = positiveRevision(
    record?.["expectedTaskRevision"],
  );
  const messageKind = record?.["messageKind"];
  const text = multilineText(record?.["text"], MAX_STEERING_CHARACTERS);
  return record &&
    record["kind"] === "napier.subagent-hub-steer-request" &&
    record["schemaVersion"] === 1 &&
    expectedTaskRevision !== undefined &&
    (messageKind === "steering" || messageKind === "input") &&
    text
    ? {
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision,
        messageKind,
        text,
      }
    : undefined;
}

export function parseCancelSubagentHubTaskRequest(
  input: unknown,
): CancelSubagentHubTaskRequestV1 | undefined {
  const record = requestRecord(input, [
    "kind",
    "schemaVersion",
    "expectedTaskRevision",
    "reason",
  ]);
  const expectedTaskRevision = positiveRevision(
    record?.["expectedTaskRevision"],
  );
  const reason = singleLineText(
    record?.["reason"],
    MAX_CANCELLATION_REASON_CHARACTERS,
  );
  return record &&
    record["kind"] === "napier.subagent-hub-cancel-request" &&
    record["schemaVersion"] === 1 &&
    expectedTaskRevision !== undefined &&
    reason
    ? {
        kind: "napier.subagent-hub-cancel-request",
        schemaVersion: 1,
        expectedTaskRevision,
        reason,
      }
    : undefined;
}

export function parseReviveSubagentHubTaskRequest(
  input: unknown,
): ReviveSubagentHubTaskRequestV1 | undefined {
  const record = requestRecord(input, [
    "kind",
    "schemaVersion",
    "expectedTaskRevision",
  ]);
  const expectedTaskRevision = positiveRevision(
    record?.["expectedTaskRevision"],
  );
  return record &&
    record["kind"] === "napier.subagent-hub-revive-request" &&
    record["schemaVersion"] === 1 &&
    expectedTaskRevision !== undefined
    ? {
        kind: "napier.subagent-hub-revive-request",
        schemaVersion: 1,
        expectedTaskRevision,
      }
    : undefined;
}

function positiveRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

function multilineText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized &&
    normalized.length <= maxLength &&
    !DISALLOWED_CONTROL_CHARACTERS.test(normalized)
    ? normalized
    : undefined;
}

function singleLineText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}
