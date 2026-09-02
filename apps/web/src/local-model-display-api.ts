import { requestJson } from "./api-client";
import type { LocalConversationModelDisplay } from "./conversation-model-display-view-model";

export interface LocalModelDisplayRecord extends LocalConversationModelDisplay {
  kind: "napier.local-model-display";
  schemaVersion: 1;
  contentSha256: string;
}

interface LocalModelDisplayResponse {
  kind: "napier.local-model-display-list";
  schemaVersion: 1;
  threadId: string;
  records: LocalModelDisplayRecord[];
}

export async function getLocalModelDisplays(
  threadId: string,
): Promise<LocalModelDisplayRecord[]> {
  const value = await requestJson<unknown>(
    `/api/threads/${encodeURIComponent(threadId)}/local-model-displays`,
  );
  if (!localModelDisplayResponse(value, threadId)) {
    throw new Error("Local model display response is invalid");
  }
  return value.records;
}

function localModelDisplayResponse(
  value: unknown,
  threadId: string,
): value is LocalModelDisplayResponse {
  if (!record(value)) return false;
  return (
    value["kind"] === "napier.local-model-display-list" &&
    value["schemaVersion"] === 1 &&
    value["threadId"] === threadId &&
    Array.isArray(value["records"]) &&
    value["records"].every((entry) => localModelDisplay(entry, threadId))
  );
}

function localModelDisplay(value: unknown, threadId: string): boolean {
  if (!record(value)) return false;
  const allowed = new Set([
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "responseEventId",
    "modelContextEnvelopeTurnIndex",
    "text",
    "thinking",
    "origin",
    "contentSha256",
  ]);
  const optionalText = (key: string) =>
    value[key] === undefined ||
    (typeof value[key] === "string" && value[key].length > 0);
  const turnIndex = value["modelContextEnvelopeTurnIndex"];
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    value["kind"] === "napier.local-model-display" &&
    value["schemaVersion"] === 1 &&
    value["sourceThreadId"] === threadId &&
    typeof value["sourceRunId"] === "string" &&
    typeof value["responseEventId"] === "string" &&
    (turnIndex === undefined ||
      (typeof turnIndex === "number" &&
        Number.isSafeInteger(turnIndex) &&
        turnIndex >= 0)) &&
    optionalText("text") &&
    optionalText("thinking") &&
    (typeof value["text"] === "string" ||
      typeof value["thinking"] === "string") &&
    (value["origin"] === "captured_response" ||
      value["origin"] === "conversation_surface") &&
    typeof value["contentSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(value["contentSha256"])
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
