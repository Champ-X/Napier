import { RUN_TERMINAL_EVENT_TYPES_V1, type RunEvent } from "@napier/contracts";

const TERMINAL_EVENTS = new Set<string>(RUN_TERMINAL_EVENT_TYPES_V1);

/** Makes a Run's first terminal event the immutable end of progress evidence. */
export class RunTerminalProjectionFence {
  private closed = false;

  accept(events: readonly RunEvent[], runId: string): RunEvent[] {
    const accepted: RunEvent[] = [];
    for (const event of events) {
      if (event.runId !== runId || this.closed) continue;
      accepted.push(event);
      if (TERMINAL_EVENTS.has(event.type)) this.closed = true;
    }
    return accepted;
  }
}

export function orderedRunEventsThroughTerminal(
  events: readonly RunEvent[],
  runId: string,
): RunEvent[] {
  const ordered = events
    .filter((event) => event.runId === runId)
    .slice()
    .sort(
      (left, right) => left.seq - right.seq || left.id.localeCompare(right.id),
    );
  return new RunTerminalProjectionFence().accept(ordered, runId);
}
