import type {
  JsonValue,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessSession,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspaceProcessSessionInput } from "./workspace-process-event-model.js";
import { validWorkspaceProcessTerminalFields } from "./workspace-process-resize-events.js";
import {
  validWorkspaceProcessSessionBase,
  workspaceProcessStatus,
} from "./workspace-process-session-base-validation.js";
import {
  EMPTY_SHA256,
  record,
  validRecoveryFields,
  validSchemaFields,
  validSettlementFields,
  validStdinFields,
  validWorkspaceAccessFields,
  validWorkspaceDelta,
  validWorkspaceProcessInputReceiptFields,
} from "./workspace-process-session-validation.js";

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
    ...(schemaVersion >= 6 && session.workspaceAccess === "scoped_write"
      ? { workspaceRollbackAvailable: false }
      : {}),
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

export function parseWorkspaceProcessInputReceipt(
  value: unknown,
): WorkspaceProcessInputReceipt | undefined {
  if (!record(value)) return undefined;
  if (!validWorkspaceProcessInputReceiptFields(value)) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessInputReceipt;
}

export function parseWorkspaceProcessSession(
  value: unknown,
): WorkspaceProcessSession | undefined {
  if (!record(value)) return undefined;
  const status = workspaceProcessStatus(value["status"]);
  if (!status || !validWorkspaceProcessSessionBase(value, status))
    return undefined;
  const schemaVersion = Number(value["schemaVersion"]);
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
  if (
    !validSchemaFields(
      value,
      schemaVersion,
      workspaceFields,
      stdinFields,
      writeFields,
      recoveryFields,
      compensationFields,
    ) ||
    !validStdinFields(value, schemaVersion, status, stdinFields)
  ) {
    return undefined;
  }
  if (schemaVersion >= 4 && !validWorkspaceProcessTerminalFields(value)) {
    return undefined;
  }
  if (
    !validWorkspaceAccessFields(
      value,
      schemaVersion,
      status,
      writeFields,
      recoveryFields,
      compensationFields,
    ) ||
    !validRecoveryFields(
      value,
      schemaVersion,
      recoveryFields,
      compensationFields,
    )
  ) {
    return undefined;
  }
  if (!validSettlementFields(value)) return undefined;
  const hasWorkspaceDelta =
    value["workspaceAfterSha256"] !== undefined ||
    value["workspaceAfterTruncated"] !== undefined ||
    value["workspaceDeltaStatus"] !== undefined ||
    value["workspaceChangedFileCount"] !== undefined ||
    value["workspaceChangedPathSetSha256"] !== undefined;
  if (!validWorkspaceDelta(value, schemaVersion, status, hasWorkspaceDelta)) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessSession;
}

export function applyWorkspaceProcessInputReceipt(
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
