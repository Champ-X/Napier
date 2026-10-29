import type { RunEvent, ToolLoopGuardPolicy } from "@napier/contracts";

import type { RunEventQueryPort } from "./run-event-query-port.js";
import {
  detectToolCallLoop,
  latestActiveToolLoopGuard,
  normalizeToolLoopGuardPolicy,
  projectToolLoopGuardTriggers,
} from "./tool-loop-guard.js";
export {
  createToolLoopGuardContextReceipt,
  TOOL_LOOP_GUARD_CONTEXT_EVENT,
  TOOL_LOOP_GUARD_TRIGGERED_EVENT,
} from "./tool-loop-guard.js";

const EVENT_TYPES = Object.freeze([
  "model.response",
  "tool.completed",
  "tool.failed",
  "tool.blocked",
  "model.tool_loop.detected",
]);

/** One active Run owns this cursor. Keep the unchanged replay projections as the
 * semantic oracle, while reading only new events that can affect those views. */
export class RunToolLoopGuardCursor {
  private events: RunEvent[] = [];
  private afterSeq = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly run: { id: string; threadId: string };

  constructor(
    private readonly reader: Pick<RunEventQueryPort, "listRunEvents">,
    run: { id: string; threadId: string },
  ) {
    this.run = { id: run.id, threadId: run.threadId };
  }

  async refresh(input: ToolLoopGuardPolicy | undefined) {
    const policy = normalizeToolLoopGuardPolicy(input);
    const refresh = this.tail.then(async () => {
      const delta = await this.reader.listRunEvents(
        this.run.id,
        this.afterSeq,
        EVENT_TYPES,
      );
      const afterSeq = this.validateDelta(delta);
      const events = [...this.events, ...structuredClone(delta)];
      const snapshot = structuredClone({
        detection: detectToolCallLoop(events, this.run.id, policy),
        triggers: projectToolLoopGuardTriggers(events, this.run.id),
        active: latestActiveToolLoopGuard(events, this.run.id, policy),
      });
      // Query, validation, copying and projection must all succeed before either
      // cached history or its watermark changes. A failed refresh can be retried.
      this.events = events;
      this.afterSeq = afterSeq;
      return snapshot;
    });
    this.tail = refresh.then(
      () => undefined,
      () => undefined,
    );
    return refresh;
  }

  private validateDelta(delta: RunEvent[]): number {
    if (!Array.isArray(delta))
      throw new Error("Tool loop guard event query returned an invalid batch");
    let afterSeq = this.afterSeq;
    for (const event of delta) {
      if (
        !event ||
        typeof event !== "object" ||
        Array.isArray(event) ||
        event.runId !== this.run.id ||
        event.threadId !== this.run.threadId ||
        !Number.isSafeInteger(event.seq) ||
        event.seq <= afterSeq ||
        !EVENT_TYPES.includes(event.type) ||
        !("payload" in event) ||
        event.payload === undefined
      ) {
        throw new Error(
          "Tool loop guard event query returned an invalid event",
        );
      }
      afterSeq = event.seq;
    }
    return afterSeq;
  }
}
