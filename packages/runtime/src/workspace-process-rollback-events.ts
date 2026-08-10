import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT =
  "workspace.process.rollback_started";
export const WORKSPACE_PROCESS_ROLLED_BACK_EVENT =
  "workspace.process.rolled_back";

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ATTEMPT_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "threadId",
  "runId",
  "processId",
  "initiatedBy",
  "previewSha256",
  "recoverySnapshotSha256",
  "expectedWorkspaceSha256",
  "scopeCount",
  "fileCount",
  "directoryCount",
  "bytes",
  "attemptedAt",
  "contentSha256",
] as const;
const RESULT_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "threadId",
  "runId",
  "processId",
  "initiatedBy",
  "attemptSha256",
  "status",
  "recoverySnapshotSha256",
  "expectedWorkspaceSha256",
  "observedWorkspaceSha256",
  "scopeCount",
  "restoredScopeCount",
  "fileCount",
  "directoryCount",
  "bytes",
  "rollbackAttempted",
  "rollbackVerified",
  "durable",
  "cancellationObserved",
  "appliedAt",
  "contentSha256",
] as const;

export function workspaceProcessRollbackAttemptPayload(
  attempt: WorkspaceProcessRollbackAttempt,
): JsonValue {
  return JSON.parse(JSON.stringify(attempt)) as JsonValue;
}

export function workspaceProcessRollbackResultPayload(
  result: WorkspaceProcessRollbackResult,
): JsonValue {
  return JSON.parse(JSON.stringify(result)) as JsonValue;
}

export function projectWorkspaceProcessRollbackHistory(
  events: RunEvent[],
  parseSession: (value: unknown) => WorkspaceProcessSession | undefined,
): {
  attempts: WorkspaceProcessRollbackAttempt[];
  results: WorkspaceProcessRollbackResult[];
} {
  const sessions = new Map<string, WorkspaceProcessSession>();
  const attempts: WorkspaceProcessRollbackAttempt[] = [];
  const results: WorkspaceProcessRollbackResult[] = [];
  const open = new Map<string, WorkspaceProcessRollbackAttempt>();
  const closed = new Set<string>();
  for (const event of events
    .slice()
    .sort((left, right) => left.seq - right.seq)) {
    if (
      event.type === "workspace.process.started" ||
      event.type === "workspace.process.settled" ||
      event.type === "workspace.process.interrupted"
    ) {
      const session = parseSession(event.payload);
      if (
        session &&
        session.threadId === event.threadId &&
        session.runId === event.runId
      ) {
        sessions.set(session.id, session);
      }
      continue;
    }
    if (event.type === WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT) {
      const attempt = parseWorkspaceProcessRollbackAttempt(event.payload);
      const session = attempt ? sessions.get(attempt.processId) : undefined;
      if (
        !attempt ||
        !session ||
        closed.has(attempt.processId) ||
        open.has(attempt.processId) ||
        !rollbackEvidenceMatchesSession(attempt, session, event)
      ) {
        continue;
      }
      attempts.push(attempt);
      open.set(attempt.processId, attempt);
      continue;
    }
    if (event.type !== WORKSPACE_PROCESS_ROLLED_BACK_EVENT) continue;
    const result = parseWorkspaceProcessRollbackResult(event.payload);
    const attempt = result ? open.get(result.processId) : undefined;
    const session = result ? sessions.get(result.processId) : undefined;
    if (
      !result ||
      !attempt ||
      !session ||
      closed.has(result.processId) ||
      result.id !== attempt.id ||
      result.initiatedBy !== attempt.initiatedBy ||
      result.attemptSha256 !== attempt.contentSha256 ||
      result.scopeCount !== attempt.scopeCount ||
      result.fileCount !== attempt.fileCount ||
      result.directoryCount !== attempt.directoryCount ||
      result.bytes !== attempt.bytes ||
      !rollbackEvidenceMatchesSession(result, session, event)
    ) {
      continue;
    }
    results.push(result);
    open.delete(result.processId);
    if (result.status !== "reverted") closed.add(result.processId);
  }
  return { attempts, results };
}

export function parseWorkspaceProcessRollbackAttempt(
  value: unknown,
): WorkspaceProcessRollbackAttempt | undefined {
  if (!record(value) || !exactKeys(value, ATTEMPT_KEYS)) return undefined;
  if (
    value["kind"] !== "napier.workspace-process-rollback-attempt" ||
    value["schemaVersion"] !== 1 ||
    typeof value["id"] !== "string" ||
    !RESOURCE_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    typeof value["processId"] !== "string" ||
    !PROCESS_ID.test(value["processId"]) ||
    (value["initiatedBy"] !== "operator" &&
      value["initiatedBy"] !== "automatic_compensation") ||
    !hash(value["previewSha256"]) ||
    !hash(value["recoverySnapshotSha256"]) ||
    !hash(value["expectedWorkspaceSha256"]) ||
    !boundedInteger(value["scopeCount"], 1, 8) ||
    !boundedInteger(value["fileCount"], 0, 10_000) ||
    !boundedInteger(value["directoryCount"], 0, 10_000) ||
    Number(value["fileCount"]) + Number(value["directoryCount"]) > 10_000 ||
    !boundedInteger(value["bytes"], 0, 64 * 1024 * 1024) ||
    !isoDate(value["attemptedAt"]) ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessRollbackAttempt;
}

export function parseWorkspaceProcessRollbackResult(
  value: unknown,
): WorkspaceProcessRollbackResult | undefined {
  if (
    !record(value) ||
    !exactKeys(
      value,
      value["errorSha256"] === undefined
        ? RESULT_KEYS
        : [...RESULT_KEYS, "errorSha256"],
    )
  ) {
    return undefined;
  }
  if (
    value["kind"] !== "napier.workspace-process-rollback" ||
    value["schemaVersion"] !== 1 ||
    typeof value["id"] !== "string" ||
    !RESOURCE_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    typeof value["processId"] !== "string" ||
    !PROCESS_ID.test(value["processId"]) ||
    (value["initiatedBy"] !== "operator" &&
      value["initiatedBy"] !== "automatic_compensation") ||
    !hash(value["attemptSha256"]) ||
    (value["status"] !== "restored" &&
      value["status"] !== "reverted" &&
      value["status"] !== "indeterminate") ||
    !hash(value["recoverySnapshotSha256"]) ||
    !hash(value["expectedWorkspaceSha256"]) ||
    !hash(value["observedWorkspaceSha256"]) ||
    !boundedInteger(value["scopeCount"], 1, 8) ||
    !boundedInteger(value["restoredScopeCount"], 0, 8) ||
    Number(value["restoredScopeCount"]) > Number(value["scopeCount"]) ||
    !boundedInteger(value["fileCount"], 0, 10_000) ||
    !boundedInteger(value["directoryCount"], 0, 10_000) ||
    Number(value["fileCount"]) + Number(value["directoryCount"]) > 10_000 ||
    !boundedInteger(value["bytes"], 0, 64 * 1024 * 1024) ||
    value["rollbackAttempted"] !== true ||
    typeof value["rollbackVerified"] !== "boolean" ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !isoDate(value["appliedAt"]) ||
    (value["errorSha256"] !== undefined && !hash(value["errorSha256"])) ||
    !hash(value["contentSha256"]) ||
    (value["status"] === "restored" &&
      (value["rollbackVerified"] !== true ||
        value["restoredScopeCount"] !== value["scopeCount"])) ||
    (value["status"] !== "restored" && value["rollbackVerified"] !== false) ||
    (value["status"] === "reverted" && value["restoredScopeCount"] !== 0) ||
    (value["status"] !== "indeterminate" && value["durable"] !== true) ||
    (value["status"] === "indeterminate" && value["durable"] !== false) ||
    (value["status"] === "restored" && value["errorSha256"] !== undefined) ||
    (value["status"] !== "restored" && value["errorSha256"] === undefined)
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessRollbackResult;
}

function rollbackEvidenceMatchesSession(
  evidence: WorkspaceProcessRollbackAttempt | WorkspaceProcessRollbackResult,
  session: WorkspaceProcessSession,
  event: RunEvent,
): boolean {
  return (
    session.workspaceAccess === "scoped_write" &&
    session.schemaVersion >= 6 &&
    session.status !== "running" &&
    evidence.threadId === event.threadId &&
    evidence.runId === event.runId &&
    evidence.threadId === session.threadId &&
    evidence.runId === session.runId &&
    evidence.recoverySnapshotSha256 === session.recoverySnapshotSha256 &&
    evidence.expectedWorkspaceSha256 === session.workspaceAfterSha256 &&
    (evidence.initiatedBy === "operator" ||
      (session.schemaVersion === 7 &&
        session.failureRecovery === "restore_scopes" &&
        (evidence.kind === "napier.workspace-process-rollback" ||
          evidence.previewSha256 === session.writePreviewSha256)))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
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

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
