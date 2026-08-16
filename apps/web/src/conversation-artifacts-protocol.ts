import type { ThreadDetail } from "@napier/contracts";

export function isConversationArtifacts(
  value: unknown,
): value is NonNullable<ThreadDetail["artifacts"]> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item["id"] === "string" &&
        integer(item["seq"], 1) &&
        typeof item["createdAt"] === "string" &&
        (item["attemptScope"] === "current" ||
          item["attemptScope"] === "previous") &&
        typeof item["threadId"] === "string" &&
        typeof item["runId"] === "string" &&
        typeof item["planId"] === "string" &&
        integer(item["planRevision"], 1) &&
        artifact(item["artifact"]),
    )
  );
}

function artifact(value: unknown): boolean {
  return (
    record(value) &&
    typeof value["id"] === "string" &&
    typeof value["path"] === "string" &&
    typeof value["kind"] === "string" &&
    ["file", "directory", "url", "other"].includes(value["kind"]) &&
    typeof value["description"] === "string" &&
    typeof value["status"] === "string" &&
    [
      "expected",
      "candidate",
      "produced",
      "verified",
      "missing",
      "superseded",
    ].includes(value["status"]) &&
    typeof value["evidence"] === "string" &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string"
  );
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
