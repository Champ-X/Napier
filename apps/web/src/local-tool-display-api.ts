import { requestJson } from "./api-client";
import type { ConversationToolDisplay } from "./conversation-tool-display-view-model";

export interface LocalToolDisplayRecord extends ConversationToolDisplay {
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
}

interface LocalToolDisplayResponse {
  kind: "napier.local-tool-display-list";
  schemaVersion: 1;
  threadId: string;
  records: LocalToolDisplayRecord[];
}

export async function getLocalToolDisplays(
  threadId: string,
): Promise<LocalToolDisplayRecord[]> {
  const value = await requestJson<unknown>(
    `/api/threads/${encodeURIComponent(threadId)}/local-tool-displays`,
  );
  if (!localToolDisplayResponse(value, threadId)) {
    throw new Error("Local tool display response is invalid");
  }
  return value.records;
}

function localToolDisplayResponse(
  value: unknown,
  threadId: string,
): value is LocalToolDisplayResponse {
  if (!record(value)) return false;
  return (
    value["kind"] === "napier.local-tool-display-list" &&
    value["schemaVersion"] === 1 &&
    value["threadId"] === threadId &&
    Array.isArray(value["records"]) &&
    value["records"].every((entry) => localToolDisplay(entry, threadId))
  );
}

function localToolDisplay(value: unknown, threadId: string): boolean {
  if (!record(value)) return false;
  const allowed = new Set([
    "kind", "schemaVersion", "sourceThreadId", "sourceRunId",
    "callId", "toolName", "input", "output", "error", "contentSha256",
  ]);
  const text = (key: string) =>
    value[key] === undefined ||
    (typeof value[key] === "string" && value[key].length > 0);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    value["kind"] === "napier.local-tool-display" &&
    value["schemaVersion"] === 1 &&
    value["sourceThreadId"] === threadId &&
    typeof value["sourceRunId"] === "string" &&
    typeof value["callId"] === "string" &&
    typeof value["toolName"] === "string" &&
    typeof value["contentSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(value["contentSha256"]) &&
    text("input") && text("output") && text("error")
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
