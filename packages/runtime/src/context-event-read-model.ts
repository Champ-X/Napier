import {
  RUN_EVENT_DEFINITION_GROUPS_V1,
  type RunEvent,
  type ThreadRecord,
} from "@napier/contracts";

import type { RunEventQueryPort } from "./run-event-query-port.js";
import {
  latestValidContextCheckpoint,
  parseContextCheckpointPayload,
} from "./compaction.js";

const DIRECT_CONTEXT_EVENT_TYPES = new Set([
  "context.compaction.completed",
  "context.conversation_surface",
  "context.conversation_surface_unavailable",
  "context.model_invocation",
  "context.model_invocation_unavailable",
  "context.tool_invocation",
  "context.tool_invocation_unavailable",
  "context.tool_result",
  "context.tool_result_unavailable",
  "goal.continuation.prompt",
  "message.assistant",
  "message.user",
  "model.response",
  "tool.completed",
  "tool.failed",
  "tool.blocked",
  "tool.result_reused",
  "run.environment.negotiated",
  "verification.completed",
  "workspace.file.mutated",
  "agent.milestone.recorded",
  "goal.evaluated",
]);

export const CONTEXT_READ_MODEL_EVENT_TYPES =
  RUN_EVENT_DEFINITION_GROUPS_V1.flatMap((group) => group.types).filter(
    (type) =>
      DIRECT_CONTEXT_EVENT_TYPES.has(type) ||
      type.startsWith("plan.") ||
      type.startsWith("operator.decision.") ||
      type.startsWith("run.recovery."),
  );

interface ContextEventReadStore extends Pick<
  RunEventQueryPort,
  "findLatestEvent" | "listEventsRange"
> {
  getThread(threadId: string): ThreadRecord;
}

interface ContextEventCacheEntry {
  eventWatermark: number;
  events: RunEvent[];
}

export class ContextEventReadModel {
  private readonly cache = new Map<string, ContextEventCacheEntry>();
  private readonly pending = new Map<string, Promise<RunEvent[]>>();
  private cacheRevision = 0;

  constructor(private readonly store: ContextEventReadStore) {}

  async read(threadId: string): Promise<RunEvent[]> {
    const previous = this.pending.get(threadId);
    const operation = (previous ?? Promise.resolve([]))
      .catch(() => [])
      .then(() => this.refresh(threadId));
    this.pending.set(threadId, operation);
    try {
      return structuredClone(await operation);
    } finally {
      if (this.pending.get(threadId) === operation) {
        this.pending.delete(threadId);
      }
    }
  }

  invalidate(threadId?: string): void {
    this.cacheRevision += 1;
    if (threadId) this.cache.delete(threadId);
    else this.cache.clear();
  }

  private async refresh(threadId: string): Promise<RunEvent[]> {
    const cacheRevision = this.cacheRevision;
    const thread = this.store.getThread(threadId);
    const cached = this.cache.get(threadId);
    const reusable = cached && cached.eventWatermark <= thread.eventCount;
    const eventWatermark = reusable ? cached.eventWatermark : 0;
    const events = reusable
      ? [
          ...cached.events,
          ...(eventWatermark < thread.eventCount
            ? await this.store.listEventsRange(
                threadId,
                eventWatermark + 1,
                thread.eventCount,
                CONTEXT_READ_MODEL_EVENT_TYPES,
              )
            : []),
        ]
      : await this.loadInitial(thread);
    if (cacheRevision === this.cacheRevision) {
      this.cache.set(threadId, {
        eventWatermark: thread.eventCount,
        events,
      });
    }
    return events;
  }

  private async loadInitial(thread: ThreadRecord): Promise<RunEvent[]> {
    if (thread.eventCount === 0) return [];
    let candidate = await this.store.findLatestEvent({
      threadId: thread.id,
      atOrBeforeSeq: thread.eventCount,
      types: ["context.compaction.completed"],
    });
    while (candidate) {
      const checkpoint = parseContextCheckpointPayload(candidate.payload);
      if (checkpoint && checkpoint.fromSeq <= thread.eventCount) {
        const events = await this.store.listEventsRange(
          thread.id,
          checkpoint.fromSeq,
          thread.eventCount,
          CONTEXT_READ_MODEL_EVENT_TYPES,
        );
        if (
          latestValidContextCheckpoint(events)?.checkpointId ===
          checkpoint.checkpointId
        ) {
          return events;
        }
      }
      candidate =
        candidate.seq > 1
          ? await this.store.findLatestEvent({
              threadId: thread.id,
              atOrBeforeSeq: candidate.seq - 1,
              types: ["context.compaction.completed"],
            })
          : undefined;
    }
    return this.store.listEventsRange(
      thread.id,
      1,
      thread.eventCount,
      CONTEXT_READ_MODEL_EVENT_TYPES,
    );
  }
}
