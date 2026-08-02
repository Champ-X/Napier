import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspaceProcessSessionInput } from "./workspace-process-event-model.js";
import {
  applyWorkspaceProcessResizeReceipt,
  parseWorkspaceProcessResizeReceipt,
  validWorkspaceProcessTerminalFields,
  WORKSPACE_PROCESS_TERMINAL_FIELDS,
} from "./workspace-process-resize-events.js";
import { projectWorkspaceProcessRollbackHistory } from "./workspace-process-rollback-events.js";
export { workspaceProcessSessionWithRuntimeState } from "./workspace-process-runtime-session.js";
export type { WorkspaceProcessSessionInput } from "./workspace-process-event-model.js";
export {
  parseWorkspaceProcessRollbackAttempt,
  parseWorkspaceProcessRollbackResult,
  WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT,
  WORKSPACE_PROCESS_ROLLED_BACK_EVENT,
  workspaceProcessRollbackAttemptPayload,
  workspaceProcessRollbackResultPayload,
} from "./workspace-process-rollback-events.js";

export const WORKSPACE_PROCESS_STARTED_EVENT = "workspace.process.started";
export const WORKSPACE_PROCESS_INPUT_EVENT = "workspace.process.input";
export const WORKSPACE_PROCESS_RESIZED_EVENT = "workspace.process.resized";
export const WORKSPACE_PROCESS_SETTLED_EVENT = "workspace.process.settled";
export const WORKSPACE_PROCESS_INTERRUPTED_EVENT =
  "workspace.process.interrupted";

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EMPTY_SHA256 = sha256("");
const STATUSES = new Set<WorkspaceProcessStatus>([
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "output_capped",
  "cancelled",
  "interrupted",
]);

export function createWorkspaceProcessSession(
  input: WorkspaceProcessSessionInput,
): WorkspaceProcessSession {
  const { schemaVersion = 4, ...session } = input;
  const base = {
    kind: "napier.workspace-process-session" as const,
    ...session,
    ...(schemaVersion >= 4 && session.ioMode === undefined
      ? { ioMode: "pipe" as const }
      : {}),
    outputAvailable: false,
  };
  const content = {
    ...base,
    schemaVersion,
    ...(schemaVersion >= 2 ? { workspaceDeltaAvailable: false } : {}),
    ...(schemaVersion >= 6 ? { workspaceRollbackAvailable: false } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function workspaceProcessSessionPayload(
  session: WorkspaceProcessSession,
): JsonValue {
  return JSON.parse(JSON.stringify(session)) as JsonValue;
}

export function workspaceProcessStableSessionInput(
  session: WorkspaceProcessSession,
): Omit<
  WorkspaceProcessSession,
  | "kind"
  | "schemaVersion"
  | "status"
  | "outputAvailable"
  | "workspaceDeltaAvailable"
  | "workspaceRollbackAvailable"
  | "workspaceCompensationStatus"
  | "contentSha256"
> {
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    status: _status,
    outputAvailable: _outputAvailable,
    workspaceDeltaAvailable: _workspaceDeltaAvailable,
    workspaceRollbackAvailable: _workspaceRollbackAvailable,
    workspaceCompensationStatus: _workspaceCompensationStatus,
    contentSha256: _contentSha256,
    ...input
  } = session;
  return input;
}

export function createWorkspaceProcessInputReceipt(
  input: Omit<
    WorkspaceProcessInputReceipt,
    "kind" | "schemaVersion" | "contentSha256"
  >,
): WorkspaceProcessInputReceipt {
  const content = {
    kind: "napier.workspace-process-input" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function workspaceProcessInputReceiptPayload(
  receipt: WorkspaceProcessInputReceipt,
): JsonValue {
  return JSON.parse(JSON.stringify(receipt)) as JsonValue;
}

export function projectWorkspaceProcessSessions(
  events: RunEvent[],
): WorkspaceProcessSession[] {
  const sessions = new Map<string, WorkspaceProcessSession>();
  for (const event of events
    .slice()
    .sort((left, right) => left.seq - right.seq)) {
    if (event.type === WORKSPACE_PROCESS_INPUT_EVENT) {
      const receipt = parseWorkspaceProcessInputReceipt(event.payload);
      const current = receipt ? sessions.get(receipt.processId) : undefined;
      const updated =
        receipt && current
          ? applyWorkspaceProcessInputReceipt(current, receipt)
          : undefined;
      if (
        updated &&
        receipt &&
        receipt.threadId === event.threadId &&
        receipt.runId === event.runId
      ) {
        sessions.set(updated.id, updated);
      }
      continue;
    }
    if (event.type === WORKSPACE_PROCESS_RESIZED_EVENT) {
      const receipt = parseWorkspaceProcessResizeReceipt(event.payload);
      const current = receipt ? sessions.get(receipt.processId) : undefined;
      const updated =
        receipt && current
          ? applyWorkspaceProcessResizeReceipt(
              current,
              receipt,
              createWorkspaceProcessSession,
            )
          : undefined;
      if (
        updated &&
        receipt &&
        receipt.threadId === event.threadId &&
        receipt.runId === event.runId
      ) {
        sessions.set(updated.id, updated);
      }
      continue;
    }
    if (
      event.type !== WORKSPACE_PROCESS_STARTED_EVENT &&
      event.type !== WORKSPACE_PROCESS_SETTLED_EVENT &&
      event.type !== WORKSPACE_PROCESS_INTERRUPTED_EVENT
    ) {
      continue;
    }
    const session = parseWorkspaceProcessSession(event.payload);
    if (
      !session ||
      session.threadId !== event.threadId ||
      session.runId !== event.runId ||
      (event.type === WORKSPACE_PROCESS_STARTED_EVENT
        ? session.status !== "running" ||
          (session.schemaVersion >= 3 &&
            session.stdinMode === "interactive" &&
            (session.stdinOpen !== true ||
              session.stdinWriteCount !== 0 ||
              session.stdinBytes !== 0 ||
              session.stdinSha256 !== EMPTY_SHA256)) ||
          (session.schemaVersion >= 4 &&
            session.ioMode === "pty" &&
            session.terminalResizeCount !== 0)
        : session.status === "running")
    ) {
      continue;
    }
    sessions.set(session.id, session);
  }
  return [...sessions.values()].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
}

export function projectWorkspaceProcessRollbackResults(
  events: RunEvent[],
): WorkspaceProcessRollbackResult[] {
  return projectWorkspaceProcessRollbackHistory(
    events,
    parseWorkspaceProcessSession,
  ).results;
}

export function projectWorkspaceProcessRollbackAttempts(
  events: RunEvent[],
): WorkspaceProcessRollbackAttempt[] {
  return projectWorkspaceProcessRollbackHistory(
    events,
    parseWorkspaceProcessSession,
  ).attempts;
}

export function parseWorkspaceProcessInputReceipt(
  value: unknown,
): WorkspaceProcessInputReceipt | undefined {
  if (!record(value)) return undefined;
  if (
    value["kind"] !== "napier.workspace-process-input" ||
    value["schemaVersion"] !== 1 ||
    typeof value["id"] !== "string" ||
    !RESOURCE_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    typeof value["processId"] !== "string" ||
    !PROCESS_ID.test(value["processId"]) ||
    (value["initiatedBy"] !== "agent" && value["initiatedBy"] !== "operator") ||
    !boundedInteger(value["sequence"], 1, 64) ||
    !boundedInteger(value["inputBytes"], 0, 32 * 1024) ||
    !hash(value["inputSha256"]) ||
    !boundedInteger(value["totalInputBytes"], 0, 256 * 1024) ||
    !hash(value["cumulativeInputSha256"]) ||
    typeof value["stdinClosed"] !== "boolean" ||
    !isoDate(value["writtenAt"]) ||
    !hash(value["sessionSha256"]) ||
    !hash(value["contentSha256"]) ||
    Number(value["totalInputBytes"]) < Number(value["inputBytes"]) ||
    (value["inputBytes"] === 0 &&
      (value["stdinClosed"] !== true || value["inputSha256"] !== EMPTY_SHA256))
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessInputReceipt;
}

function parseWorkspaceProcessSession(
  value: unknown,
): WorkspaceProcessSession | undefined {
  if (!record(value)) return undefined;
  const status = value["status"];
  if (
    value["kind"] !== "napier.workspace-process-session" ||
    (value["schemaVersion"] !== 1 &&
      value["schemaVersion"] !== 2 &&
      value["schemaVersion"] !== 3 &&
      value["schemaVersion"] !== 4 &&
      value["schemaVersion"] !== 5 &&
      value["schemaVersion"] !== 6 &&
      value["schemaVersion"] !== 7) ||
    typeof status !== "string" ||
    !STATUSES.has(status as WorkspaceProcessStatus) ||
    typeof value["id"] !== "string" ||
    !PROCESS_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    (value["runtime"] !== "node" && value["runtime"] !== "python") ||
    typeof value["sandbox"] !== "string" ||
    (value["workspaceAccess"] !== "read_only" &&
      value["workspaceAccess"] !== "scoped_write") ||
    value["networkAccess"] !== "denied" ||
    !boundedInteger(value["argumentCount"], 0, 64) ||
    !hash(value["commandSha256"]) ||
    !hash(value["executableSha256"]) ||
    !hash(value["environmentSha256"]) ||
    !hash(value["resourceLimitsSha256"]) ||
    !hash(value["cwdPathSha256"]) ||
    !boundedInteger(value["timeoutMs"], 1_000, 120_000) ||
    !boundedInteger(value["outputLimitChars"], 1, 1_000_000) ||
    !isoDate(value["startedAt"]) ||
    !nonNegativeInteger(value["stdoutChars"]) ||
    !nonNegativeInteger(value["stderrChars"]) ||
    typeof value["stdoutTruncated"] !== "boolean" ||
    typeof value["stderrTruncated"] !== "boolean" ||
    !nonNegativeInteger(value["nextCursor"]) ||
    value["outputAvailable"] !== false ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  const workspaceFields = [
    "workspaceBeforeSha256",
    "workspaceBeforeTruncated",
    "workspaceAfterSha256",
    "workspaceAfterTruncated",
    "workspaceDeltaStatus",
    "workspaceChangedFileCount",
    "workspaceChangedPathSetSha256",
    "workspaceDeltaAvailable",
  ] as const;
  const stdinFields = [
    "stdinMode",
    "stdinOpen",
    "stdinWriteCount",
    "stdinBytes",
    "stdinSha256",
  ] as const;
  const writeFields = [
    "writePreviewSha256",
    "writeScopeCount",
    "writeScopeSetSha256",
    "workspaceWriteScopeStatus",
  ] as const;
  const recoveryFields = [
    "recoverySnapshotSha256",
    "recoveryScopeCount",
    "recoveryFileCount",
    "recoveryDirectoryCount",
    "recoveryBytes",
    "workspaceRollbackAvailable",
  ] as const;
  const compensationFields = [
    "failureRecovery",
    "workspaceCompensationStatus",
  ] as const;
  if (value["schemaVersion"] === 1) {
    if (
      workspaceFields.some((field) => value[field] !== undefined) ||
      stdinFields.some((field) => value[field] !== undefined) ||
      writeFields.some((field) => value[field] !== undefined) ||
      recoveryFields.some((field) => value[field] !== undefined) ||
      compensationFields.some((field) => value[field] !== undefined) ||
      WORKSPACE_PROCESS_TERMINAL_FIELDS.some(
        (field) => value[field] !== undefined,
      )
    ) {
      return undefined;
    }
  } else if (
    !hash(value["workspaceBeforeSha256"]) ||
    typeof value["workspaceBeforeTruncated"] !== "boolean" ||
    value["workspaceDeltaAvailable"] !== false
  ) {
    return undefined;
  }
  if (
    (value["schemaVersion"] === 2 &&
      (stdinFields.some((field) => value[field] !== undefined) ||
        WORKSPACE_PROCESS_TERMINAL_FIELDS.some(
          (field) => value[field] !== undefined,
        ))) ||
    (value["schemaVersion"] === 3 &&
      WORKSPACE_PROCESS_TERMINAL_FIELDS.some(
        (field) => value[field] !== undefined,
      )) ||
    (value["schemaVersion"] >= 3 &&
      ((value["stdinMode"] !== "closed" &&
        value["stdinMode"] !== "interactive") ||
        typeof value["stdinOpen"] !== "boolean" ||
        !boundedInteger(value["stdinWriteCount"], 0, 64) ||
        !boundedInteger(value["stdinBytes"], 0, 256 * 1024) ||
        !hash(value["stdinSha256"])))
  ) {
    return undefined;
  }
  if (
    value["schemaVersion"] >= 3 &&
    ((value["stdinMode"] === "closed" &&
      (value["stdinOpen"] !== false ||
        value["stdinWriteCount"] !== 0 ||
        value["stdinBytes"] !== 0 ||
        value["stdinSha256"] !== EMPTY_SHA256)) ||
      (value["stdinWriteCount"] === 0 &&
        (value["stdinBytes"] !== 0 || value["stdinSha256"] !== EMPTY_SHA256)) ||
      (value["stdinBytes"] === 0 && value["stdinSha256"] !== EMPTY_SHA256) ||
      (value["stdinBytes"] !== 0 && value["stdinSha256"] === EMPTY_SHA256) ||
      (status !== "running" && value["stdinOpen"] !== false))
  ) {
    return undefined;
  }
  if (
    value["schemaVersion"] >= 4 &&
    !validWorkspaceProcessTerminalFields(value)
  ) {
    return undefined;
  }
  if (
    (value["schemaVersion"] < 5 &&
      (value["workspaceAccess"] !== "read_only" ||
        writeFields.some((field) => value[field] !== undefined) ||
        recoveryFields.some((field) => value[field] !== undefined) ||
        compensationFields.some((field) => value[field] !== undefined))) ||
    (value["schemaVersion"] >= 5 &&
      (value["workspaceAccess"] !== "scoped_write" ||
        !hash(value["writePreviewSha256"]) ||
        !boundedInteger(value["writeScopeCount"], 1, 8) ||
        !hash(value["writeScopeSetSha256"]) ||
        (status === "running"
          ? value["workspaceWriteScopeStatus"] !== undefined
          : value["workspaceWriteScopeStatus"] !== undefined &&
            value["workspaceWriteScopeStatus"] !== "within_scope" &&
            value["workspaceWriteScopeStatus"] !== "outside_scope" &&
            value["workspaceWriteScopeStatus"] !== "indeterminate")))
  ) {
    return undefined;
  }
  if (
    (value["schemaVersion"] === 5 &&
      (recoveryFields.some((field) => value[field] !== undefined) ||
        compensationFields.some((field) => value[field] !== undefined))) ||
    (value["schemaVersion"] >= 6 &&
      (!hash(value["recoverySnapshotSha256"]) ||
        !boundedInteger(value["recoveryScopeCount"], 1, 8) ||
        !boundedInteger(value["recoveryFileCount"], 0, 10_000) ||
        !boundedInteger(value["recoveryDirectoryCount"], 0, 10_000) ||
        Number(value["recoveryFileCount"]) +
          Number(value["recoveryDirectoryCount"]) >
          10_000 ||
        !boundedInteger(value["recoveryBytes"], 0, 64 * 1024 * 1024) ||
        value["workspaceRollbackAvailable"] !== false)) ||
    (value["schemaVersion"] === 6 &&
      compensationFields.some((field) => value[field] !== undefined)) ||
    (value["schemaVersion"] === 7 &&
      (value["failureRecovery"] !== "restore_scopes" ||
        value["workspaceCompensationStatus"] !== undefined))
  ) {
    return undefined;
  }
  if (
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
      !hash(value["workspaceChangedPathSetSha256"])) ||
    (value["interruptionReason"] !== undefined &&
      typeof value["interruptionReason"] !== "string")
  ) {
    return undefined;
  }
  const hasWorkspaceDelta =
    value["workspaceAfterSha256"] !== undefined ||
    value["workspaceAfterTruncated"] !== undefined ||
    value["workspaceDeltaStatus"] !== undefined ||
    value["workspaceChangedFileCount"] !== undefined ||
    value["workspaceChangedPathSetSha256"] !== undefined;
  if (
    hasWorkspaceDelta &&
    (value["workspaceAfterSha256"] === undefined ||
      value["workspaceAfterTruncated"] === undefined ||
      value["workspaceDeltaStatus"] === undefined ||
      value["workspaceChangedFileCount"] === undefined ||
      value["workspaceChangedPathSetSha256"] === undefined)
  ) {
    return undefined;
  }
  if (
    value["schemaVersion"] >= 2 &&
    ((status === "running" && hasWorkspaceDelta) ||
      (status !== "running" && status !== "interrupted" && !hasWorkspaceDelta))
  ) {
    return undefined;
  }
  if (
    value["schemaVersion"] >= 5 &&
    status !== "running" &&
    status !== "interrupted" &&
    value["workspaceWriteScopeStatus"] === undefined
  ) {
    return undefined;
  }
  if (
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
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessSession;
}

function applyWorkspaceProcessInputReceipt(
  session: WorkspaceProcessSession,
  receipt: WorkspaceProcessInputReceipt,
): WorkspaceProcessSession | undefined {
  if (
    session.schemaVersion < 3 ||
    session.status !== "running" ||
    session.stdinMode !== "interactive" ||
    session.stdinOpen !== true ||
    receipt.threadId !== session.threadId ||
    receipt.runId !== session.runId ||
    receipt.processId !== session.id ||
    receipt.sequence !== (session.stdinWriteCount ?? 0) + 1 ||
    receipt.totalInputBytes !==
      (session.stdinBytes ?? 0) + receipt.inputBytes ||
    (receipt.inputBytes === 0 &&
      (receipt.inputSha256 !== EMPTY_SHA256 ||
        receipt.cumulativeInputSha256 !== session.stdinSha256))
  ) {
    return undefined;
  }
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    outputAvailable: _outputAvailable,
    workspaceDeltaAvailable: _workspaceDeltaAvailable,
    contentSha256: _contentSha256,
    ...input
  } = session;
  const updated = createWorkspaceProcessSession({
    ...input,
    schemaVersion: session.schemaVersion,
    stdinOpen: !receipt.stdinClosed,
    stdinWriteCount: receipt.sequence,
    stdinBytes: receipt.totalInputBytes,
    stdinSha256: receipt.cumulativeInputSha256,
  });
  return updated.contentSha256 === receipt.sessionSha256 ? updated : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
