import type { RunEvent, ThreadRecord } from "@napier/contracts";

export interface KernelProjectionEventStore {
  getThread(threadId: string): ThreadRecord;
  listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
  listEventsRange?(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
}

/** Load a complete bounded tail so the registry can verify sequence continuity. */
export async function loadKernelProjectionEvents(
  store: KernelProjectionEventStore,
  threadId: string,
  afterSeq: number,
  eventCount: number,
): Promise<RunEvent[]> {
  const fromSeq = afterSeq + 1;
  if (fromSeq > eventCount) return [];
  if (typeof store.listEventsRange === "function") {
    return store.listEventsRange(threadId, fromSeq, eventCount);
  }
  return (await store.listEvents(threadId, afterSeq)).filter(
    (event) => event.seq <= eventCount,
  );
}
