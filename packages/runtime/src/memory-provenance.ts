import type { MemorySource, RunEvent } from "@napier/contracts";

const MAX_MEMORY_SOURCE_MESSAGES = 30;

export function memoryRunMessageIds(events: readonly RunEvent[]): string[] {
  return events
    .filter(isConversationMessage)
    .slice(-MAX_MEMORY_SOURCE_MESSAGES)
    .map((event) => event.id);
}

export function buildMemoryRunConversation(
  events: readonly RunEvent[],
): string {
  return events
    .filter(isConversationMessage)
    .flatMap((event): string[] => {
      const payload = record(event.payload);
      const text = payload?.["text"];
      if (typeof text !== "string" || !text.trim()) return [];
      return [
        `[${event.id}] ${event.type === "message.user" ? "User" : "Assistant"}: ${text.trim()}`,
      ];
    })
    .join("\n\n")
    .slice(-12_000);
}

export function createMemorySourceProvenance(input: {
  type: MemorySource["type"];
  threadId?: string;
  runId?: string;
  taskTitle?: string;
  messageIds?: readonly string[];
  events?: readonly RunEvent[];
}): MemorySource {
  const repositoryEvidence = latestRepositoryEvidence(input.events ?? []);
  return {
    type: input.type,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.taskTitle ? { taskTitle: input.taskTitle } : {}),
    ...(input.type === "conversation" && input.messageIds?.length
      ? { messageIds: [...input.messageIds] }
      : {}),
    repositoryEvidence: repositoryEvidence ?? { status: "unavailable" },
  };
}

function isConversationMessage(event: RunEvent): boolean {
  return event.type === "message.user" || event.type === "message.assistant";
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
    const workspaceSnapshotSha256 = details?.["workspaceSnapshotSha256"];
    if (
      payload?.["toolName"] === "verify_workspace" &&
      details?.["status"] === "passed" &&
      typeof workspaceSnapshotSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(workspaceSnapshotSha256)
    ) {
      return {
        status: "linked",
        eventId: event.id,
        eventSeq: event.seq,
        workspaceSnapshotSha256,
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
