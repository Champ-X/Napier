import type {
  JsonValue,
  WorkspaceProcessResizeReceipt,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspaceProcessSessionInput } from "./workspace-process-event-model.js";

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const WORKSPACE_PROCESS_TERMINAL_FIELDS = [
  "ioMode",
  "terminalType",
  "terminalColumns",
  "terminalRows",
  "terminalResizeCount",
] as const;

export function createWorkspaceProcessResizeReceipt(
  input: Omit<
    WorkspaceProcessResizeReceipt,
    "kind" | "schemaVersion" | "contentSha256"
  >,
): WorkspaceProcessResizeReceipt {
  const content = {
    kind: "napier.workspace-process-resize" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function workspaceProcessResizeReceiptPayload(
  receipt: WorkspaceProcessResizeReceipt,
): JsonValue {
  return JSON.parse(JSON.stringify(receipt)) as JsonValue;
}

export function parseWorkspaceProcessResizeReceipt(
  value: unknown,
): WorkspaceProcessResizeReceipt | undefined {
  if (!record(value)) return undefined;
  if (
    value["kind"] !== "napier.workspace-process-resize" ||
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
    !boundedInteger(value["columns"], 20, 400) ||
    !boundedInteger(value["rows"], 5, 200) ||
    !isoDate(value["resizedAt"]) ||
    !hash(value["sessionSha256"]) ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessResizeReceipt;
}

export function applyWorkspaceProcessResizeReceipt(
  session: WorkspaceProcessSession,
  receipt: WorkspaceProcessResizeReceipt,
  createSession: (
    input: WorkspaceProcessSessionInput,
  ) => WorkspaceProcessSession,
): WorkspaceProcessSession | undefined {
  if (
    session.schemaVersion < 4 ||
    session.ioMode !== "pty" ||
    session.status !== "running" ||
    receipt.threadId !== session.threadId ||
    receipt.runId !== session.runId ||
    receipt.processId !== session.id ||
    receipt.sequence !== (session.terminalResizeCount ?? 0) + 1
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
  const updated = createSession({
    ...input,
    schemaVersion: session.schemaVersion,
    terminalColumns: receipt.columns,
    terminalRows: receipt.rows,
    terminalResizeCount: receipt.sequence,
  });
  return updated.contentSha256 === receipt.sessionSha256 ? updated : undefined;
}

export function validWorkspaceProcessTerminalFields(
  value: Record<string, unknown>,
): boolean {
  if (
    value["schemaVersion"] !== 4 &&
    value["schemaVersion"] !== 5 &&
    value["schemaVersion"] !== 6 &&
    value["schemaVersion"] !== 7
  )
    return false;
  if (value["ioMode"] === "pipe") {
    return WORKSPACE_PROCESS_TERMINAL_FIELDS.filter(
      (field) => field !== "ioMode",
    ).every((field) => value[field] === undefined);
  }
  return (
    value["ioMode"] === "pty" &&
    value["stdinMode"] === "interactive" &&
    value["terminalType"] === "xterm-256color" &&
    boundedInteger(value["terminalColumns"], 20, 400) &&
    boundedInteger(value["terminalRows"], 5, 200) &&
    boundedInteger(value["terminalResizeCount"], 0, 64)
  );
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
