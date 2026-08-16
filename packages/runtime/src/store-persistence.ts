import type { RunEvent } from "@napier/contracts";

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
}): Promise<number> {
  const startedAt = monotonicNow();
  const serializationStartedAt = monotonicNow();
  const stateJson = input.snapshotJson?.();
  const serializationDurationMs = monotonicNow() - serializationStartedAt;
  const stateBytes = stateJson ? Buffer.byteLength(stateJson, "utf8") : 0;
  const eventBytes = input.events.reduce(
    (total, event) => total + Buffer.byteLength(JSON.stringify(event), "utf8"),
    0,
  );
  const touchedThreadIds = [
    ...new Set(input.events.map((event) => event.threadId)),
  ];
  const ledgerCommitStartedAt = monotonicNow();
  let revision: number;
  try {
    revision = stateJson
      ? input.ledger.commit(input.expectedRevision, stateJson, [
          ...input.events,
        ])
      : input.ledger.commitEvents(input.expectedRevision, [...input.events]);
  } catch (error) {
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
  const projectionStartedAt = monotonicNow();
  const projection = await input.compatibility.recordCommit(
    input.compatibilityStateJson,
    input.events,
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
  return revision;
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
