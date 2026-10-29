import type { RunEvent, RunRecord } from "@napier/contracts";
import type { RunEventQueryPort } from "./run-event-query-port.js";

const EVENT_TYPES = Object.freeze([
  "message.user", "workflow.node.prompt", "goal.continuation.prompt", "run.recovery.prompt",
  "run.control.queued", "run.control.delivered", "run.control.cancelled",
  "tool.started", "tool.completed", "tool.failed", "tool.blocked",
]);
type Reader = Partial<Pick<RunEventQueryPort, "findLatestEvent" | "listEventsRange">>;

/** One active Run retains event input only. Files, memory eligibility and the
 * unchanged replay projections are evaluated again for every invocation. */
export class RunInvocationContextCursor {
  private events: RunEvent[] = [];
  private afterSeq = 0;
  private tail: Promise<void> = Promise.resolve();
  private branchObserved = false;
  private readonly run: { id: string; threadId: string };

  constructor(private readonly reader: Reader, run: { id: string; threadId: string }) {
    this.run = { id: run.id, threadId: run.threadId };
  }

  canRead(run: { id: string; threadId: string }, threadRuns: readonly RunRecord[]): boolean {
    if (run.id !== this.run.id || run.threadId !== this.run.threadId)
      throw new Error("Invocation event cursor belongs to another Run or Thread");
    // Branch provenance rejects unexpected event types, so a typed subset is
    // insufficient. Once observed, retain the full oracle for this Run's lifetime.
    this.branchObserved ||= threadRuns.some((item) => item.branchFromSeq !== undefined);
    return !this.branchObserved && typeof this.reader.findLatestEvent === "function" &&
      typeof this.reader.listEventsRange === "function";
  }

  async refresh<T>(project: (events: RunEvent[]) => Promise<T>): Promise<T> {
    const refresh = this.tail.then(async () => {
      if (!this.reader.findLatestEvent || !this.reader.listEventsRange)
        throw new Error("Invocation event cursor is unavailable");
      // Store snapshot eventCount is not a durable ledger head. Fix the range
      // using the committed reader so later appends belong to the next refresh.
      const head = await this.reader.findLatestEvent({ threadId: this.run.threadId });
      const headSeq = this.validateHead(head);
      const delta = headSeq > this.afterSeq ? await this.reader.listEventsRange(
        this.run.threadId, this.afterSeq + 1, headSeq, EVENT_TYPES,
      ) : [];
      this.validateDelta(delta, headSeq);
      const events = [...this.events, ...structuredClone(delta)];
      const output = await project(structuredClone(events));
      // A failed read, invalid/incomplete control prefix or projection never
      // advances either field. Noise-only committed ranges may advance the head.
      if (!this.branchObserved) {
        this.events = events;
        this.afterSeq = headSeq;
      }
      return output;
    });
    this.tail = refresh.then(() => undefined, () => undefined);
    return refresh;
  }

  private validateHead(head: RunEvent | undefined): number {
    if (head !== undefined && (!head || typeof head !== "object" || Array.isArray(head) ||
        head.threadId !== this.run.threadId || !Number.isSafeInteger(head.seq) || head.seq < 1))
      throw new Error("Invocation event query returned an invalid head");
    const seq = head?.seq ?? 0;
    if (seq < this.afterSeq) throw new Error("Invocation event ledger head moved backwards");
    return seq;
  }

  private validateDelta(delta: RunEvent[], headSeq: number): void {
    if (!Array.isArray(delta)) throw new Error("Invocation event query returned an invalid batch");
    let previous = this.afterSeq;
    for (const event of delta) {
      if (!event || typeof event !== "object" || Array.isArray(event) ||
          event.threadId !== this.run.threadId || !Number.isSafeInteger(event.seq) ||
          event.seq <= previous || event.seq > headSeq || !EVENT_TYPES.includes(event.type) ||
          !("payload" in event) || event.payload === undefined)
        throw new Error("Invocation event query returned an invalid event");
      previous = event.seq;
    }
  }
}
