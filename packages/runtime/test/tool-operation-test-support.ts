import type { JsonValue, RunEvent } from "@napier/contracts";

import type { AppendEventInput } from "../src/run-event-registry.js";
import { resolveRegisteredEventInput } from "../src/run-event-registry.js";
import { ConcurrentRunEventHeadError } from "../src/sqlite-ledger-errors.js";
import type {
  ToolOperationDescriptor,
  ToolOperationJournalStore,
} from "../src/tool-operation-journal.js";

export const toolOperationTestOwner = {
  threadId: "thread_operation_journal",
  runId: "run_operation_journal",
};

export function operationDescriptor(): ToolOperationDescriptor {
  return {
    ordinal: 1,
    mode: "fallback",
    route: "route-a",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKey: { query: "private query text" },
    failureDomainKey: { route: "route-a" },
  };
}

export function mutatingOperationDescriptor(): ToolOperationDescriptor {
  return {
    ...operationDescriptor(),
    operation: "mutate",
    scope: "workspace",
    contribution: "product",
  };
}

export function idempotentOperationDescriptor(): ToolOperationDescriptor {
  return { ...operationDescriptor(), startedTakeover: "idempotent" };
}

export function operationEventField(
  event: RunEvent,
  name: string,
): JsonValue | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
    ? event.payload[name]
    : undefined;
}

export function memoryToolOperationStore(
  events: RunEvent[],
): ToolOperationJournalStore {
  const idempotent = memoryStoreIdempotency(events);
  const appendEvent = async (input: AppendEventInput): Promise<RunEvent> => {
    const resolved = resolveRegisteredEventInput(input);
    const event: RunEvent = {
      id: `event_${String(events.length + 1)}`,
      threadId: input.threadId,
      runId: input.runId,
      seq: events.length + 1,
      type: resolved.type,
      category: resolved.category,
      visibility: resolved.visibility,
      createdAt: "2026-09-03T12:00:00.000Z",
      payload: resolved.payload,
      schemaVersion: resolved.schemaVersion,
    };
    events.push(event);
    return structuredClone(event);
  };
  return {
    appendEvent,
    async appendEventOnceAtRunHead(input, options) {
      const key = `${input.runId}:${options.namespace}:${options.key}`;
      const existing = idempotent.get(key);
      if (existing) {
        return { event: structuredClone(existing), appended: false };
      }
      const actualRunHeadSeq = events
        .filter((event) => event.runId === input.runId)
        .reduce((head, event) => Math.max(head, event.seq), 0);
      if (actualRunHeadSeq !== options.expectedRunHeadSeq) {
        throw new ConcurrentRunEventHeadError(
          input.runId,
          options.expectedRunHeadSeq,
          actualRunHeadSeq,
        );
      }
      const event = await appendEvent(input);
      idempotent.set(key, structuredClone(event));
      return { event, appended: true };
    },
    async listRunEvents(runId, afterSeq = 0, types) {
      return events
        .filter(
          (event) =>
            event.runId === runId &&
            event.seq > afterSeq &&
            (!types || types.includes(event.type)),
        )
        .map((event) => structuredClone(event));
    },
  };
}

const MEMORY_STORE_IDEMPOTENCY = new WeakMap<
  RunEvent[],
  Map<string, RunEvent>
>();

function memoryStoreIdempotency(events: RunEvent[]): Map<string, RunEvent> {
  const existing = MEMORY_STORE_IDEMPOTENCY.get(events);
  if (existing) return existing;
  const idempotent = new Map<string, RunEvent>();
  MEMORY_STORE_IDEMPOTENCY.set(events, idempotent);
  return idempotent;
}
