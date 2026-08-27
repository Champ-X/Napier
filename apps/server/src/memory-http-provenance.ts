import type { MemorySource, RunEvent, ThreadRecord } from "@napier/contracts";

export function createManualMemorySource(
  thread: ThreadRecord | undefined,
  events: readonly RunEvent[],
): MemorySource {
  return {
    type: "manual",
    ...(thread
      ? {
          threadId: thread.id,
          taskTitle: thread.title,
          repositoryEvidence: latestRepositoryEvidence(events) ?? {
            status: "unavailable",
          },
        }
      : {}),
  };
}

function latestRepositoryEvidence(
  events: readonly RunEvent[],
): NonNullable<MemorySource["repositoryEvidence"]> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type !== "tool.completed") continue;
    const payload = record(event.payload);
    if (payload?.["effect"] === "write") return undefined;
    const details = record(payload?.["details"]);
    const snapshot = details?.["workspaceSnapshotSha256"];
    if (
      payload?.["toolName"] === "verify_workspace" &&
      details?.["status"] === "passed" &&
      typeof snapshot === "string" &&
      /^[a-f0-9]{64}$/u.test(snapshot)
    ) {
      return {
        status: "linked",
        eventId: event.id,
        eventSeq: event.seq,
        workspaceSnapshotSha256: snapshot,
        capturedAt: event.createdAt,
      };
    }
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
