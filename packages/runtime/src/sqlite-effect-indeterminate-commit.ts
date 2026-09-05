import type { DatabaseSync } from "node:sqlite";

import type { RunEvent, RunLeaseSummary } from "@napier/contracts";

import { lostRunLeaseDisposition } from "./run-lease-loss.js";
import { listRunLeases } from "./sqlite-run-leases.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { recoveryRunLeaseBindingSha256 } from "./tool-effect-indeterminate-event.js";
import {
  assertToolOperationEventIntegrity,
  publishesToolExecutionOutcome,
  toolExecutionEventAttribution,
} from "./tool-execution-event-integrity.js";

interface SnapshotRun {
  id: string;
  threadId: string;
  status: string;
  outcome?: string;
  lease?: RunLeaseSummary;
  leaseTokenSha256?: string;
}

export class EffectIndeterminateCommitError extends Error {
  override readonly name = "EffectIndeterminateCommitError";

  constructor(
    readonly runId: string,
    reason: string,
  ) {
    super(`Run ${runId} effect-indeterminate commit rejected: ${reason}`);
  }
}

export function assertEffectIndeterminateTerminalCommit(
  database: DatabaseSync,
  previousStateJson: string | undefined,
  nextStateJson: string | undefined,
  events: readonly RunEvent[],
): void {
  assertNoContinuationAfterEffectIndeterminate(database, events);
  const markers = events.filter(
    (event) => event.type === "tool.operation.effect_indeterminate",
  );
  if (markers.length === 0) {
    assertToolOperationEventIntegrity(events);
    return;
  }
  if (!previousStateJson || !nextStateJson) {
    throw new EffectIndeterminateCommitError(
      markers[0]!.runId,
      "the marker is restricted to an atomic lifecycle snapshot transition",
    );
  }
  assertToolOperationEventIntegrity(events);
  const previousRuns = snapshotRuns(previousStateJson);
  const nextRuns = snapshotRuns(nextStateJson);
  const markerKeys = new Set<string>();
  const commitNowMs = Date.now();
  for (const marker of markers) {
    assertMarkerCommit(
      database,
      marker,
      events,
      previousRuns,
      nextRuns,
      markerKeys,
      commitNowMs,
    );
  }
}

export function assertNoContinuationAfterEffectIndeterminate(
  database: DatabaseSync,
  events: readonly RunEvent[],
): void {
  for (const event of events) {
    if (event.type === "tool.operation.effect_indeterminate") continue;
    const attribution = toolExecutionEventAttribution(event);
    if (!attribution.operationId && attribution.callIds.length === 0) continue;
    const marker = indeterminateMarkers(database, event).find((candidate) => {
      const closed = toolExecutionEventAttribution(candidate);
      return (
        (attribution.operationId &&
          closed.operationId === attribution.operationId) ||
        attribution.callIds.some((callId) => closed.callIds.includes(callId))
      );
    });
    if (!marker) continue;
    throw new EffectIndeterminateCommitError(
      event.runId,
      `event ${event.type} is attributed to an effect-indeterminate execution`,
    );
  }
}

function indeterminateMarkers(
  database: DatabaseSync,
  event: RunEvent,
): RunEvent[] {
  return database
    .prepare(
      `SELECT event_json FROM ledger_events
       WHERE thread_id = ? AND run_id = ?
         AND event_type = 'tool.operation.effect_indeterminate'
       ORDER BY seq DESC`,
    )
    .all(event.threadId, event.runId)
    .map(
      (row) =>
        JSON.parse((row as { event_json: string }).event_json) as RunEvent,
    );
}

function assertMarkerCommit(
  database: DatabaseSync,
  marker: RunEvent,
  events: readonly RunEvent[],
  previousRuns: ReadonlyMap<string, SnapshotRun>,
  nextRuns: ReadonlyMap<string, SnapshotRun>,
  markerKeys: Set<string>,
  commitNowMs: number,
): void {
  const payload = record(marker.payload);
  const operationId = text(payload?.["operationId"]);
  const ownerSha256 = hash(payload?.["executionLeaseOwnerSha256"]);
  const generation = positiveInteger(payload?.["executionLeaseGeneration"]);
  const boundaryEventSeq = positiveInteger(payload?.["effectBoundaryEventSeq"]);
  const recoveredAtMs = nonNegativeInteger(payload?.["recoveredAtMs"]);
  if (
    !payload ||
    !operationId ||
    !ownerSha256 ||
    !generation ||
    !boundaryEventSeq ||
    recoveredAtMs === undefined ||
    Date.parse(marker.createdAt) !== recoveredAtMs ||
    recoveredAtMs > commitNowMs
  ) {
    throw markerError(marker, "the marker token or recovery clock is invalid");
  }
  const markerKey = `${marker.runId}:${operationId}:${ownerSha256}:${String(generation)}`;
  if (markerKeys.has(markerKey)) {
    throw markerError(
      marker,
      "the execution token is abandoned more than once",
    );
  }
  markerKeys.add(markerKey);
  const terminal = pairedBlockedSafetyTerminal(events, marker);
  if (!terminal) {
    throw markerError(
      marker,
      "a later paired run.failed/blocked_safety is required",
    );
  }
  assertTerminalOperationSet(terminal, markersForRun(events, marker), marker);
  const stateKey = `${marker.threadId}\u0000${marker.runId}`;
  const previous = previousRuns.get(stateKey);
  const next = nextRuns.get(stateKey);
  if (
    !previous ||
    (previous.status !== "queued" && previous.status !== "running") ||
    !next ||
    next.status !== "failed" ||
    next.outcome !== "blocked_safety" ||
    next.lease !== undefined ||
    next.leaseTokenSha256 !== undefined
  ) {
    throw markerError(
      marker,
      "the snapshot must atomically transition active to failed/blocked_safety and revoke its Run lease",
    );
  }
  assertRunLeaseEvidence(database, marker, previous, payload, commitNowMs);
  const priorEvents = runEventsBefore(database, marker);
  const boundary = liveToolEffectAuthoritiesFromEvents(priorEvents).find(
    (authority) =>
      authority.operationId === operationId &&
      authority.ownerSha256 === ownerSha256 &&
      authority.generation === generation &&
      authority.boundaryEventSeq === boundaryEventSeq &&
      authority.current,
  );
  const descriptorSha256 = hash(payload["descriptorSha256"]);
  const boundaryPayload = record(boundary?.boundaryEvent?.payload);
  if (
    !boundary ||
    !descriptorSha256 ||
    !sameOperationIdentity(payload, boundaryPayload)
  ) {
    throw markerError(
      marker,
      "the marker is not bound to the current unresolved effect boundary",
    );
  }
  if (
    priorEvents.some(
      (event) =>
        publishesToolExecutionOutcome(event) &&
        toolExecutionEventAttribution(event).callIds.includes(
          payload["parentCallId"] as string,
        ),
    )
  ) {
    throw markerError(
      marker,
      "the execution already published a terminal outcome",
    );
  }
}

function assertRunLeaseEvidence(
  database: DatabaseSync,
  marker: RunEvent,
  previous: SnapshotRun,
  payload: Record<string, unknown>,
  commitNowMs: number,
): void {
  const binding = recoveryRunLeaseBindingSha256(previous);
  if (payload["recoveryRunLeaseBindingSha256"] !== binding) {
    throw markerError(
      marker,
      "the Run lease binding does not match the prior snapshot",
    );
  }
  const durableLease = listRunLeases(database).find(
    (candidate) => candidate.runId === marker.runId,
  );
  if (
    Boolean(previous.lease && previous.leaseTokenSha256) !==
    Boolean(durableLease)
  ) {
    throw markerError(
      marker,
      "the Run lease table does not match the prior snapshot",
    );
  }
  if (
    durableLease &&
    recoveryRunLeaseBindingSha256({
      lease: durableLease.lease,
      leaseTokenSha256: durableLease.tokenSha256,
    }) !== binding
  ) {
    throw markerError(marker, "the Run lease table and snapshot disagree");
  }
  const expectedDisposition = lostRunLeaseDisposition(
    previous.lease,
    Boolean(previous.leaseTokenSha256),
    commitNowMs,
    true,
  );
  if (!expectedDisposition) {
    throw markerError(marker, "the Run owner lease is still preservable");
  }
  if (payload["recoveryDisposition"] !== expectedDisposition) {
    throw markerError(marker, "the Run lease loss disposition is inconsistent");
  }
}

function runEventsBefore(database: DatabaseSync, marker: RunEvent): RunEvent[] {
  const rows = database
    .prepare(
      `SELECT event_json FROM ledger_events
       WHERE thread_id = ? AND run_id = ? AND seq < ? ORDER BY seq ASC`,
    )
    .all(marker.threadId, marker.runId, marker.seq) as Array<{
    event_json: string;
  }>;
  return rows.map((row) => JSON.parse(row.event_json) as RunEvent);
}

const OPERATION_IDENTITY_FIELDS = [
  "parentCallId",
  "operationId",
  "role",
  "startedTakeover",
  "ordinal",
  "mode",
  "route",
  "operation",
  "scope",
  "contribution",
  "resourceKeySha256",
  "failureBindings",
  "failureDomainKeySha256",
  "descriptorSha256",
] as const;

function sameOperationIdentity(
  marker: Record<string, unknown>,
  boundary: Record<string, unknown> | undefined,
): boolean {
  return Boolean(
    boundary &&
    OPERATION_IDENTITY_FIELDS.every(
      (field) =>
        JSON.stringify(marker[field]) === JSON.stringify(boundary[field]),
    ),
  );
}

function pairedBlockedSafetyTerminal(
  events: readonly RunEvent[],
  marker: RunEvent,
): RunEvent | undefined {
  return events.find((event) => {
    const payload = record(event.payload);
    return (
      event.threadId === marker.threadId &&
      event.runId === marker.runId &&
      event.seq > marker.seq &&
      event.type === "run.failed" &&
      payload?.["status"] === "failed" &&
      payload["outcome"] === "blocked_safety" &&
      payload["reason"] === "effect_indeterminate"
    );
  });
}

function markersForRun(
  events: readonly RunEvent[],
  marker: RunEvent,
): RunEvent[] {
  return events.filter(
    (event) =>
      event.threadId === marker.threadId &&
      event.runId === marker.runId &&
      event.type === "tool.operation.effect_indeterminate",
  );
}

function assertTerminalOperationSet(
  terminal: RunEvent,
  markers: readonly RunEvent[],
  marker: RunEvent,
): void {
  const payload = record(terminal.payload);
  const operationIds = payload?.["operationIds"];
  const expected = markers
    .map((event) => text(record(event.payload)?.["operationId"]))
    .filter((value): value is string => Boolean(value))
    .sort();
  if (
    !Array.isArray(operationIds) ||
    operationIds.some((value) => typeof value !== "string") ||
    JSON.stringify([...operationIds].sort()) !== JSON.stringify(expected)
  ) {
    throw markerError(
      marker,
      "run.failed does not bind the abandoned operation set",
    );
  }
}

function snapshotRuns(stateJson: string): Map<string, SnapshotRun> {
  const state = JSON.parse(stateJson) as { runs?: unknown };
  const runs = new Map<string, SnapshotRun>();
  if (!Array.isArray(state.runs)) return runs;
  for (const value of state.runs) {
    if (!record(value)) continue;
    const id = text(value["id"]);
    const threadId = text(value["threadId"]);
    const status = text(value["status"]);
    if (!id || !threadId || !status) continue;
    runs.set(`${threadId}\u0000${id}`, value as unknown as SnapshotRun);
  }
  return runs;
}

function markerError(marker: RunEvent, reason: string): Error {
  return new EffectIndeterminateCommitError(marker.runId, reason);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}
