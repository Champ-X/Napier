import type { RunEvent } from "@napier/contracts";

export type EventSink = (event: RunEvent) => Promise<void> | void;

export async function emitBestEffort(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable evidence survives a disconnected observer.
  }
}
