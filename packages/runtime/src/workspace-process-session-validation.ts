import type { WorkspaceProcessSession } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { WORKSPACE_PROCESS_TERMINAL_FIELDS } from "./workspace-process-resize-events.js";

export const PROCESS_ID = /^process_[a-z0-9]{8,80}$/;

export const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;

export const SHA256 = /^[a-f0-9]{64}$/;

export const EMPTY_SHA256 = sha256("");

export function validWorkspaceProcessInputReceiptFields(
  value: Record<string, unknown>,
): boolean {
  const validIdentity =
    value["kind"] === "napier.workspace-process-input" &&
    value["schemaVersion"] === 1 &&
    typeof value["id"] === "string" &&
    RESOURCE_ID.test(value["id"]) &&
    typeof value["threadId"] === "string" &&
    RESOURCE_ID.test(value["threadId"]) &&
    typeof value["runId"] === "string" &&
    RESOURCE_ID.test(value["runId"]) &&
    typeof value["processId"] === "string" &&
    PROCESS_ID.test(value["processId"]) &&
    (value["initiatedBy"] === "agent" || value["initiatedBy"] === "operator");
  if (!validIdentity) return false;
  return (
    boundedInteger(value["sequence"], 1, 64) &&
    boundedInteger(value["inputBytes"], 0, 32 * 1024) &&
    hash(value["inputSha256"]) &&
    boundedInteger(value["totalInputBytes"], 0, 256 * 1024) &&
    hash(value["cumulativeInputSha256"]) &&
    typeof value["stdinClosed"] === "boolean" &&
    isoDate(value["writtenAt"]) &&
    hash(value["sessionSha256"]) &&
    hash(value["contentSha256"]) &&
    Number(value["totalInputBytes"]) >= Number(value["inputBytes"]) &&
    (value["inputBytes"] !== 0 ||
      (value["stdinClosed"] === true && value["inputSha256"] === EMPTY_SHA256))
  );
}

export function validSchemaFields(
  value: Record<string, unknown>,
  schemaVersion: number,
  workspaceFields: readonly string[],
  stdinFields: readonly string[],
  writeFields: readonly string[],
  recoveryFields: readonly string[],
  compensationFields: readonly string[],
): boolean {
  if (schemaVersion === 1) {
    return ![
      ...workspaceFields,
      ...stdinFields,
      ...writeFields,
      ...recoveryFields,
      ...compensationFields,
      ...WORKSPACE_PROCESS_TERMINAL_FIELDS,
    ].some((field) => value[field] !== undefined);
  }
  return (
    hash(value["workspaceBeforeSha256"]) &&
    typeof value["workspaceBeforeTruncated"] === "boolean" &&
    value["workspaceDeltaAvailable"] === false
  );
}

export function validStdinFields(
  value: Record<string, unknown>,
  schemaVersion: number,
  status: WorkspaceProcessSession["status"],
  stdinFields: readonly string[],
): boolean {
  const terminalFieldsPresent = WORKSPACE_PROCESS_TERMINAL_FIELDS.some(
    (field) => value[field] !== undefined,
  );
  if (
    (schemaVersion === 2 &&
      (stdinFields.some((field) => value[field] !== undefined) ||
        terminalFieldsPresent)) ||
    (schemaVersion === 3 && terminalFieldsPresent)
  ) {
    return false;
  }
  if (schemaVersion < 3) return true;
  if (!validStdinShape(value)) return false;
  return validStdinState(value, status);
}

function validStdinShape(value: Record<string, unknown>): boolean {
  return (
    (value["stdinMode"] === "closed" || value["stdinMode"] === "interactive") &&
    typeof value["stdinOpen"] === "boolean" &&
    boundedInteger(value["stdinWriteCount"], 0, 64) &&
    boundedInteger(value["stdinBytes"], 0, 256 * 1024) &&
    hash(value["stdinSha256"])
  );
}

function validStdinState(
  value: Record<string, unknown>,
  status: WorkspaceProcessSession["status"],
): boolean {
  return !(
    (value["stdinMode"] === "closed" &&
      (value["stdinOpen"] !== false ||
        value["stdinWriteCount"] !== 0 ||
        value["stdinBytes"] !== 0 ||
        value["stdinSha256"] !== EMPTY_SHA256)) ||
    (value["stdinWriteCount"] === 0 &&
      (value["stdinBytes"] !== 0 || value["stdinSha256"] !== EMPTY_SHA256)) ||
    (value["stdinBytes"] === 0 && value["stdinSha256"] !== EMPTY_SHA256) ||
    (value["stdinBytes"] !== 0 && value["stdinSha256"] === EMPTY_SHA256) ||
    (status !== "running" && value["stdinOpen"] !== false)
  );
}

export function validWorkspaceAccessFields(
  value: Record<string, unknown>,
  schemaVersion: number,
  status: WorkspaceProcessSession["status"],
  writeFields: readonly string[],
  recoveryFields: readonly string[],
  compensationFields: readonly string[],
): boolean {
  if (schemaVersion < 5 || schemaVersion === 8) {
    return (
      value["workspaceAccess"] === "read_only" &&
      ![...writeFields, ...recoveryFields, ...compensationFields].some(
        (field) => value[field] !== undefined,
      )
    );
  }
  if (schemaVersion > 7) return true;
  const scopeStatus = value["workspaceWriteScopeStatus"];
  return (
    value["workspaceAccess"] === "scoped_write" &&
    hash(value["writePreviewSha256"]) &&
    boundedInteger(value["writeScopeCount"], 1, 8) &&
    hash(value["writeScopeSetSha256"]) &&
    (status === "running"
      ? scopeStatus === undefined
      : scopeStatus === undefined ||
        scopeStatus === "within_scope" ||
        scopeStatus === "outside_scope" ||
        scopeStatus === "indeterminate")
  );
}

export function validRecoveryFields(
  value: Record<string, unknown>,
  schemaVersion: number,
  recoveryFields: readonly string[],
  compensationFields: readonly string[],
): boolean {
  if (schemaVersion === 5) {
    return ![...recoveryFields, ...compensationFields].some(
      (field) => value[field] !== undefined,
    );
  }
  if (schemaVersion !== 6 && schemaVersion !== 7) return true;
  if (
    !hash(value["recoverySnapshotSha256"]) ||
    !boundedInteger(value["recoveryScopeCount"], 1, 8) ||
    !boundedInteger(value["recoveryFileCount"], 0, 10_000) ||
    !boundedInteger(value["recoveryDirectoryCount"], 0, 10_000) ||
    Number(value["recoveryFileCount"]) +
      Number(value["recoveryDirectoryCount"]) >
      10_000 ||
    !boundedInteger(value["recoveryBytes"], 0, 64 * 1024 * 1024) ||
    value["workspaceRollbackAvailable"] !== false
  ) {
    return false;
  }
  return schemaVersion === 6
    ? compensationFields.every((field) => value[field] === undefined)
    : value["failureRecovery"] === "restore_scopes" &&
        value["workspaceCompensationStatus"] === undefined;
}

export function validSettlementFields(value: Record<string, unknown>): boolean {
  return (
    validTerminalSettlementFields(value) &&
    validWorkspaceSettlementFields(value)
  );
}

function validTerminalSettlementFields(
  value: Record<string, unknown>,
): boolean {
  return !(
    (value["settledAt"] !== undefined && !isoDate(value["settledAt"])) ||
    (value["durationMs"] !== undefined &&
      !nonNegativeInteger(value["durationMs"])) ||
    (value["exitCode"] !== undefined &&
      value["exitCode"] !== null &&
      !Number.isSafeInteger(value["exitCode"])) ||
    (value["signal"] !== undefined &&
      value["signal"] !== null &&
      typeof value["signal"] !== "string") ||
    (value["stdoutSha256"] !== undefined && !hash(value["stdoutSha256"])) ||
    (value["stderrSha256"] !== undefined && !hash(value["stderrSha256"])) ||
    (value["interruptionReason"] !== undefined &&
      typeof value["interruptionReason"] !== "string")
  );
}

function validWorkspaceSettlementFields(
  value: Record<string, unknown>,
): boolean {
  return !(
    (value["workspaceAfterSha256"] !== undefined &&
      !hash(value["workspaceAfterSha256"])) ||
    (value["workspaceAfterTruncated"] !== undefined &&
      typeof value["workspaceAfterTruncated"] !== "boolean") ||
    (value["workspaceDeltaStatus"] !== undefined &&
      value["workspaceDeltaStatus"] !== "unchanged" &&
      value["workspaceDeltaStatus"] !== "changed" &&
      value["workspaceDeltaStatus"] !== "indeterminate") ||
    (value["workspaceChangedFileCount"] !== undefined &&
      !nonNegativeInteger(value["workspaceChangedFileCount"])) ||
    (value["workspaceChangedPathSetSha256"] !== undefined &&
      !hash(value["workspaceChangedPathSetSha256"]))
  );
}

export function validWorkspaceDelta(
  value: Record<string, unknown>,
  schemaVersion: number,
  status: WorkspaceProcessSession["status"],
  hasWorkspaceDelta: boolean,
): boolean {
  if (
    hasWorkspaceDelta &&
    [
      "workspaceAfterSha256",
      "workspaceAfterTruncated",
      "workspaceDeltaStatus",
      "workspaceChangedFileCount",
      "workspaceChangedPathSetSha256",
    ].some((field) => value[field] === undefined)
  ) {
    return false;
  }
  if (
    schemaVersion >= 2 &&
    ((status === "running" && hasWorkspaceDelta) ||
      (status !== "running" && status !== "interrupted" && !hasWorkspaceDelta))
  ) {
    return false;
  }
  if (
    schemaVersion >= 5 &&
    schemaVersion <= 7 &&
    status !== "running" &&
    status !== "interrupted" &&
    value["workspaceWriteScopeStatus"] === undefined
  ) {
    return false;
  }
  return !(
    hasWorkspaceDelta &&
    ((value["workspaceDeltaStatus"] === "unchanged" &&
      value["workspaceChangedFileCount"] !== 0) ||
      (value["workspaceDeltaStatus"] === "changed" &&
        value["workspaceChangedFileCount"] === 0) ||
      (value["workspaceDeltaStatus"] !== "indeterminate" &&
        (value["workspaceBeforeTruncated"] === true ||
          value["workspaceAfterTruncated"] === true)) ||
      (value["workspaceDeltaStatus"] === "indeterminate" &&
        value["workspaceBeforeTruncated"] !== true &&
        value["workspaceAfterTruncated"] !== true))
  );
}

export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
