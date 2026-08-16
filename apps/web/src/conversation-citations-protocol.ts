import type { ThreadDetail } from "@napier/contracts";

const CITATION_ID = /^citation_[a-z0-9]{8,80}$/u;
const SOURCE_ID = /^source_[a-z0-9]{8,80}$/u;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function isConversationCitations(
  value: unknown,
): value is NonNullable<ThreadDetail["citations"]> {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every((citation) => valid(citation))
  );
}

function valid(value: unknown): boolean {
  return (
    record(value) &&
    text(value["id"]) &&
    integer(value["seq"], 1) &&
    text(value["createdAt"]) &&
    typeof value["callId"] === "string" &&
    CALL_ID.test(value["callId"]) &&
    typeof value["citationId"] === "string" &&
    CITATION_ID.test(value["citationId"]) &&
    typeof value["sourceId"] === "string" &&
    SOURCE_ID.test(value["sourceId"]) &&
    (value["sourceKind"] === "browser" ||
      value["sourceKind"] === "web_fetch") &&
    integer(value["startLine"], 1, 400) &&
    integer(value["endLine"], Number(value["startLine"]), 400) &&
    Number(value["endLine"]) - Number(value["startLine"]) < 40 &&
    digest(value["sourceContentSha256"]) &&
    digest(value["sourceTitleSha256"]) &&
    digest(value["quoteSha256"]) &&
    digest(value["claimSha256"])
  );
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function digest(value: unknown): boolean {
  return typeof value === "string" && SHA256.test(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
