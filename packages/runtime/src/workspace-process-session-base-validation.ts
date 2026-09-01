import type { WorkspaceProcessStatus } from "@napier/contracts";

import {
  MAX_COMMAND_TIMEOUT_MS,
  MIN_COMMAND_TIMEOUT_MS,
} from "./command-execution.js";
import { validWorkspaceProcessLocalServiceFields } from "./workspace-process-local-service-events.js";

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STATUSES = new Set<WorkspaceProcessStatus>([
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "output_capped",
  "cancelled",
  "interrupted",
]);

export function workspaceProcessStatus(
  value: unknown,
): WorkspaceProcessStatus | undefined {
  return typeof value === "string" &&
    STATUSES.has(value as WorkspaceProcessStatus)
    ? (value as WorkspaceProcessStatus)
    : undefined;
}

export function validWorkspaceProcessSessionBase(
  value: Record<string, unknown>,
  status: WorkspaceProcessStatus,
): boolean {
  return (
    validSessionIdentity(value) &&
    validSessionExecution(value) &&
    validWorkspaceProcessLocalServiceFields(value, status)
  );
}

function validSessionIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.workspace-process-session" &&
    validSchemaVersion(value["schemaVersion"]) &&
    typeof value["id"] === "string" &&
    PROCESS_ID.test(value["id"]) &&
    typeof value["threadId"] === "string" &&
    RESOURCE_ID.test(value["threadId"]) &&
    typeof value["runId"] === "string" &&
    RESOURCE_ID.test(value["runId"]) &&
    (value["runtime"] === "node" ||
      value["runtime"] === "python" ||
      value["runtime"] === "shell") &&
    typeof value["sandbox"] === "string" &&
    (value["workspaceAccess"] === "read_only" ||
      value["workspaceAccess"] === "scoped_write")
  );
}

function validSessionExecution(value: Record<string, unknown>): boolean {
  return (
    boundedInteger(value["argumentCount"], 0, 64) &&
    hash(value["commandSha256"]) &&
    hash(value["executableSha256"]) &&
    hash(value["environmentSha256"]) &&
    hash(value["resourceLimitsSha256"]) &&
    hash(value["cwdPathSha256"]) &&
    boundedInteger(
      value["timeoutMs"],
      MIN_COMMAND_TIMEOUT_MS,
      MAX_COMMAND_TIMEOUT_MS,
    ) &&
    boundedInteger(value["outputLimitChars"], 1, 1_000_000) &&
    isoDate(value["startedAt"]) &&
    nonNegativeInteger(value["stdoutChars"]) &&
    nonNegativeInteger(value["stderrChars"]) &&
    typeof value["stdoutTruncated"] === "boolean" &&
    typeof value["stderrTruncated"] === "boolean" &&
    nonNegativeInteger(value["nextCursor"]) &&
    value["outputAvailable"] === false &&
    hash(value["contentSha256"])
  );
}

function validSchemaVersion(value: unknown): boolean {
  return (
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 8
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
