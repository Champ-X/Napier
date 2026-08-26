import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { RunEvent } from "@napier/contracts";

import type { PersistedStoreState } from "./store-state.js";
import { threadMessagePreview } from "./store-thread-summary-projection.js";

export async function readLegacyEvents(
  state: PersistedStoreState,
  eventsRoot: string,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const threads = new Map(state.threads.map((thread) => [thread.id, thread]));
  const files = (await readdir(eventsRoot))
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const threadId = file.slice(0, -".jsonl".length);
    const thread = threads.get(threadId);
    if (!thread) {
      throw new Error(`Legacy ledger has an orphan event file: ${file}`);
    }
    const contents = await readFile(path.join(eventsRoot, file), "utf8");
    const threadEvents = contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
    for (const [index, event] of threadEvents.entries()) {
      const expectedSeq = index + 1;
      if (event.threadId !== threadId || event.seq !== expectedSeq) {
        throw new Error(
          `Legacy ledger sequence is invalid for ${threadId} at ${String(expectedSeq)}`,
        );
      }
    }
    if (threadEvents.length < thread.eventCount) {
      throw new Error(
        `Legacy ledger is missing evidence for ${threadId}: expected ${String(thread.eventCount)}, found ${String(threadEvents.length)}`,
      );
    }
    if (threadEvents.length > thread.eventCount) {
      thread.eventCount = threadEvents.length;
      const lastEvent = threadEvents.at(-1);
      if (lastEvent) {
        thread.updatedAt = lastEvent.createdAt;
        for (let index = threadEvents.length - 1; index >= 0; index -= 1) {
          const message = threadMessagePreview(threadEvents[index]!);
          if (message) {
            thread.lastMessage = message;
            break;
          }
        }
      }
    }
    events.push(...threadEvents);
    threads.delete(threadId);
  }
  for (const thread of threads.values()) {
    if (thread.eventCount > 0) {
      throw new Error(`Legacy ledger event file is missing for ${thread.id}`);
    }
  }
  return events;
}
