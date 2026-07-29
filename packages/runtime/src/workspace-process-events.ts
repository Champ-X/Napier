import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const WORKSPACE_PROCESS_STARTED_EVENT = "workspace.process.started";
export const WORKSPACE_PROCESS_SETTLED_EVENT = "workspace.process.settled";
export const WORKSPACE_PROCESS_INTERRUPTED_EVENT =
  "workspace.process.interrupted";

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = new Set<WorkspaceProcessStatus>([
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "output_capped",
  "cancelled",
  "interrupted",
]);

export type WorkspaceProcessSessionInput = Omit<
  WorkspaceProcessSession,
  "kind" | "schemaVersion" | "outputAvailable" | "contentSha256"
>;

export function createWorkspaceProcessSession(
  input: WorkspaceProcessSessionInput,
): WorkspaceProcessSession {
  const content = {
    kind: "napier.workspace-process-session" as const,
    schemaVersion: 1 as const,
    ...input,
    outputAvailable: false,
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

export function projectWorkspaceProcessSessions(
  events: RunEvent[],
): WorkspaceProcessSession[] {
  const sessions = new Map<string, WorkspaceProcessSession>();
  for (const event of events
    .slice()
    .sort((left, right) => left.seq - right.seq)) {
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
        ? session.status !== "running"
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

export function workspaceProcessSessionWithRuntimeState(
  session: WorkspaceProcessSession,
  runtime: { nextCursor: number; outputAvailable: boolean },
): WorkspaceProcessSession {
  const { contentSha256: _contentSha256, ...content } = {
    ...session,
    nextCursor: runtime.nextCursor,
    outputAvailable: runtime.outputAvailable,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function parseWorkspaceProcessSession(
  value: unknown,
): WorkspaceProcessSession | undefined {
  if (!record(value)) return undefined;
  const status = value["status"];
  if (
    value["kind"] !== "napier.workspace-process-session" ||
    value["schemaVersion"] !== 1 ||
    typeof status !== "string" ||
    !STATUSES.has(status as WorkspaceProcessStatus) ||
    typeof value["id"] !== "string" ||
    !PROCESS_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    value["runtime"] !== "node" ||
    typeof value["sandbox"] !== "string" ||
    value["workspaceAccess"] !== "read_only" ||
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
    (value["interruptionReason"] !== undefined &&
      typeof value["interruptionReason"] !== "string")
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessSession;
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
