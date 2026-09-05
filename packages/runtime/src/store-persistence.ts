import type { RunEvent, RunEventAdmissionPolicyV1 } from "@napier/contracts";

import type {
  EventIdempotencyKey,
  IdempotentRunEvent,
} from "./event-idempotency.js";
import type { LedgerRunLease } from "./sqlite-run-leases.js";
import type { SqliteLedger } from "./sqlite-ledger.js";
import type { StoreCompatibilityProjectionWriter } from "./store-compatibility-projections.js";
import {
  monotonicNow,
  type StorePersistenceMonitor,
} from "./store-observability.js";

export async function persistStoreMutation(input: {
  expectedRevision: number;
  snapshotJson?: () => string;
  compatibilityStateJson: () => string;
  events: readonly RunEvent[];
  ledger: SqliteLedger;
  monitor: StorePersistenceMonitor;
  compatibility: StoreCompatibilityProjectionWriter;
  onCommitFailure(): void;
  eventIdempotency?: EventIdempotencyKey;
  /** Lifecycle admission for an idempotent event without a Run-head cursor. */
  eventAdmission?: RunEventAdmissionPolicyV1;
  runHeadCondition?: {
    runId: string;
    expectedRunHeadSeq: number;
    admission?: RunEventAdmissionPolicyV1;
  };
  onIdempotentHit?(): void;
  onProjectionRefreshRequired?(): void;
}): Promise<{
  revision: number;
  event?: RunEvent;
  appended: boolean;
}> {
  const startedAt = monotonicNow();
  const serializationStartedAt = monotonicNow();
  const stateJson = input.snapshotJson?.();
  const serializationDurationMs = monotonicNow() - serializationStartedAt;
  const stateBytes = stateJson ? Buffer.byteLength(stateJson, "utf8") : 0;
  const ledgerCommitStartedAt = monotonicNow();
  let revision: number;
  let persistedEvent: RunEvent | undefined;
  let appended = true;
  try {
    if (input.eventIdempotency) {
      const [event] = input.events;
      if (input.events.length !== 1 || !event) {
        throw new Error("Idempotent persistence requires exactly one event");
      }
      if (stateJson) {
        throw new Error("Idempotent event persistence must be event-only");
      }
      if (
        input.runHeadCondition &&
        input.runHeadCondition.runId !== event.runId
      ) {
        throw new Error(
          "Run event head condition does not match the event Run",
        );
      }
      const result = input.runHeadCondition
        ? input.ledger.commitEventOnceAtRunHead(
            input.expectedRevision,
            event as IdempotentRunEvent,
            input.eventIdempotency,
            input.runHeadCondition.expectedRunHeadSeq,
            input.runHeadCondition.admission,
          )
        : input.ledger.commitEventOnce(
            input.expectedRevision,
            event as IdempotentRunEvent,
            input.eventIdempotency,
            input.eventAdmission,
          );
      revision = result.revision;
      persistedEvent = result.event;
      appended = result.appended;
      if (!appended) input.onIdempotentHit?.();
      else if (result.projectionRefreshRequired) {
        input.onProjectionRefreshRequired?.();
      }
    } else {
      if (input.runHeadCondition) {
        throw new Error(
          "Run event head conditions require an idempotent event append",
        );
      }
      revision = stateJson
        ? input.ledger.commit(input.expectedRevision, stateJson, [
            ...input.events,
          ])
        : input.ledger.commitEvents(input.expectedRevision, [...input.events]);
    }
  } catch (error) {
    const eventBytes = eventByteLength(input.events);
    const touchedThreadIds = touchedThreads(input.events);
    input.monitor.record({
      status: "failed",
      revision: input.expectedRevision,
      stateBytes,
      eventCount: input.events.length,
      eventBytes,
      touchedThreadCount: touchedThreadIds.length,
      stateProjectionBytes: 0,
      eventProjectionBytes: 0,
      serializationDurationMs,
      ledgerCommitDurationMs: monotonicNow() - ledgerCommitStartedAt,
      projectionDurationMs: 0,
      totalDurationMs: monotonicNow() - startedAt,
      projectionFailureCount: 0,
    });
    input.onCommitFailure();
    throw error;
  }
  const ledgerCommitDurationMs = monotonicNow() - ledgerCommitStartedAt;
  const committedEvents = appended
    ? persistedEvent
      ? [persistedEvent]
      : input.events
    : [];
  const eventBytes = eventByteLength(committedEvents);
  const touchedThreadIds = touchedThreads(committedEvents);
  const projectionStartedAt = monotonicNow();
  const projection =
    input.eventIdempotency && !appended
      ? {
          stateProjectionBytes: 0,
          eventProjectionBytes: 0,
          projectionFailureCount: 0,
        }
      : await input.compatibility.recordCommit(
          input.compatibilityStateJson,
          committedEvents,
        );
  const projectionDurationMs = monotonicNow() - projectionStartedAt;
  input.monitor.record({
    status: "committed",
    revision,
    stateBytes,
    eventCount: input.events.length,
    eventBytes,
    touchedThreadCount: touchedThreadIds.length,
    stateProjectionBytes: projection.stateProjectionBytes,
    eventProjectionBytes: projection.eventProjectionBytes,
    serializationDurationMs,
    ledgerCommitDurationMs,
    projectionDurationMs,
    totalDurationMs: monotonicNow() - startedAt,
    projectionFailureCount: projection.projectionFailureCount,
  });
  return {
    revision,
    ...(persistedEvent ? { event: persistedEvent } : {}),
    appended,
  };
}

function eventByteLength(events: readonly RunEvent[]): number {
  return events.reduce(
    (total, event) => total + Buffer.byteLength(JSON.stringify(event), "utf8"),
    0,
  );
}

function touchedThreads(events: readonly RunEvent[]): string[] {
  return [...new Set(events.map((event) => event.threadId))];
}

export function persistRunLeaseRenewal(input: {
  runId: string;
  tokenSha256: string;
  expectedRevision: number;
  heartbeatAt: string;
  expiresAt: string;
  workspaceRevision: number;
  ledger: SqliteLedger;
  monitor: StorePersistenceMonitor;
}): LedgerRunLease {
  const startedAt = monotonicNow();
  try {
    const lease = input.ledger.renewRunLease({
      runId: input.runId,
      tokenSha256: input.tokenSha256,
      expectedRevision: input.expectedRevision,
      heartbeatAt: input.heartbeatAt,
      expiresAt: input.expiresAt,
    });
    input.monitor.record({
      status: "committed",
      revision: input.workspaceRevision,
      stateBytes: 0,
      eventCount: 0,
      eventBytes: 0,
      touchedThreadCount: 0,
      stateProjectionBytes: 0,
      eventProjectionBytes: 0,
      serializationDurationMs: 0,
      ledgerCommitDurationMs: monotonicNow() - startedAt,
      projectionDurationMs: 0,
      totalDurationMs: monotonicNow() - startedAt,
      projectionFailureCount: 0,
    });
    return lease;
  } catch (error) {
    input.monitor.record({
      status: "failed",
      revision: input.workspaceRevision,
      stateBytes: 0,
      eventCount: 0,
      eventBytes: 0,
      touchedThreadCount: 0,
      stateProjectionBytes: 0,
      eventProjectionBytes: 0,
      serializationDurationMs: 0,
      ledgerCommitDurationMs: monotonicNow() - startedAt,
      projectionDurationMs: 0,
      totalDurationMs: monotonicNow() - startedAt,
      projectionFailureCount: 0,
    });
    throw error;
  }
}
