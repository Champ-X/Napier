import type { RunEvent, ThreadRecord } from "@napier/contracts";

export function applyThreadSummaryEvent(
  thread: ThreadRecord,
  event: RunEvent,
): void {
  if (event.threadId !== thread.id || event.seq !== thread.eventCount + 1) {
    throw new Error(`SQLite ledger tail is invalid for ${thread.id}`);
  }
  thread.eventCount = event.seq;
  thread.updatedAt = event.createdAt;
  const message = threadMessagePreview(event);
  if (message) thread.lastMessage = message;
}

export function replayThreadSummaryTails(input: {
  threads: ThreadRecord[];
  expectedEventCount: number;
  listEvents(threadId: string, afterSeq: number): RunEvent[];
}): void {
  if (
    !Number.isSafeInteger(input.expectedEventCount) ||
    input.expectedEventCount < 0
  ) {
    throw new Error("SQLite ledger snapshot watermark is invalid");
  }
  let appliedEventCount = 0;
  for (const thread of input.threads) {
    for (const event of input.listEvents(thread.id, thread.eventCount)) {
      applyThreadSummaryEvent(thread, event);
      appliedEventCount += 1;
    }
  }
  if (appliedEventCount !== input.expectedEventCount) {
    throw new Error(
      `SQLite ledger snapshot tail mismatch: expected ${input.expectedEventCount}, found ${appliedEventCount}`,
    );
  }
}

export function threadMessagePreview(event: RunEvent): string | undefined {
  if (
    (event.type !== "message.user" && event.type !== "message.assistant") ||
    event.category !== "message" ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const text = event.payload["text"];
  return typeof text === "string"
    ? text.replace(/\s+/gu, " ").trim().slice(0, 180)
    : undefined;
}
