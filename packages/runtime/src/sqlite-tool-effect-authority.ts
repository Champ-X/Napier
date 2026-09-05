import type { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "@napier/contracts";

const HASH = /^[a-f0-9]{64}$/u;

interface ToolOperationEventRow {
  seq: number;
  event_type: string;
  event_json: string;
}

interface ExecutionToken {
  operationId: string;
  ownerSha256: string;
  generation: number;
}

interface EffectBoundary extends ExecutionToken {
  seq: number;
  current: boolean;
  sourceEvent?: RunEvent;
}

interface EffectAuthorityEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown> | undefined;
  sourceEvent?: RunEvent;
}

export interface LiveToolEffectAuthority {
  operationId: string;
  ownerSha256: string;
  generation: number;
  boundaryEventSeq: number;
  current: boolean;
  boundaryEvent?: RunEvent;
}

/**
 * A terminal transition cannot prove that code beyond a durable effect
 * boundary has stopped. The matching generation must settle first; lease
 * expiry alone deliberately does not release this fence.
 */
export class LiveToolEffectAuthorityError extends Error {
  override readonly name = "LiveToolEffectAuthorityError";

  constructor(
    readonly runId: string,
    readonly operationIds: readonly string[],
  ) {
    super(
      `Run ${runId} cannot become terminal while tool effect authority is active for ${operationIds.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Must run inside the same SQLite write transaction that commits terminal
 * Run state. It creates a strict ordering with effect-boundary event commits:
 * whichever transaction obtains the SQLite writer lock first wins.
 */
export function assertNoLiveToolEffectAuthority(
  database: DatabaseSync,
  threadId: string,
  runId: string,
): void {
  const live = liveToolEffectAuthorityOperationIds(database, threadId, runId);
  if (live.length > 0) {
    throw new LiveToolEffectAuthorityError(runId, live);
  }
}

export function liveToolEffectAuthorityOperationIds(
  database: DatabaseSync,
  threadId: string,
  runId: string,
): string[] {
  const rows = database
    .prepare(
      `SELECT seq, event_type, event_json
       FROM ledger_events
       WHERE thread_id = ? AND run_id = ?
         AND event_type IN (
           'tool.operation.admitted',
           'tool.operation.lease.granted',
           'tool.operation.started',
           'tool.operation.lease.renewed',
           'tool.operation.effect_indeterminate',
           'tool.operation.settled'
         )
       ORDER BY seq ASC`,
    )
    .all(threadId, runId) as unknown as ToolOperationEventRow[];
  return projectLiveToolEffectAuthorityOperationIds(
    rows.map((row) => ({
      seq: row.seq,
      type: row.event_type,
      payload: eventPayload(row.event_json),
    })),
  );
}

export function liveToolEffectAuthorityOperationIdsFromEvents(
  events: readonly RunEvent[],
): string[] {
  return [
    ...new Set(
      liveToolEffectAuthoritiesFromEvents(events).map(
        (authority) => authority.operationId,
      ),
    ),
  ].sort();
}

export function liveToolEffectAuthoritiesFromEvents(
  events: readonly RunEvent[],
): LiveToolEffectAuthority[] {
  return projectLiveToolEffectAuthorities(
    events.map((event) => ({
      seq: event.seq,
      type: event.type,
      payload: objectRecord(event.payload) ? event.payload : undefined,
      sourceEvent: event,
    })),
  );
}

function projectLiveToolEffectAuthorityOperationIds(
  events: readonly EffectAuthorityEvent[],
): string[] {
  return [
    ...new Set(
      projectLiveToolEffectAuthorities(events).map(
        (authority) => authority.operationId,
      ),
    ),
  ].sort();
}

function projectLiveToolEffectAuthorities(
  events: readonly EffectAuthorityEvent[],
): LiveToolEffectAuthority[] {
  const starts = new Map<string, number>();
  const boundaries = new Map<string, EffectBoundary>();
  const settlements = new Map<string, number>();
  const indeterminate = new Map<string, { seq: number; boundarySeq: number }>();
  const latestLease = new Map<
    string,
    ExecutionToken & { expiresAtMs: number; seq: number }
  >();
  for (const event of events) {
    const payload = event.payload;
    const token = executionToken(payload);
    if (!token) continue;
    const key = executionTokenKey(token);
    const lease = executionLease(payload, event.seq);
    if (
      lease &&
      (event.type === "tool.operation.admitted" ||
        event.type === "tool.operation.lease.granted" ||
        event.type === "tool.operation.lease.renewed")
    ) {
      const prior = latestLease.get(token.operationId);
      if (!prior || laterLease(lease, prior))
        latestLease.set(token.operationId, lease);
    }
    if (event.type === "tool.operation.started") {
      if (!starts.has(key)) starts.set(key, event.seq);
      continue;
    }
    if (event.type === "tool.operation.lease.renewed") {
      if (
        payload?.["role"] === "execution_authority" &&
        payload["executionEffectBoundary"] === true &&
        (starts.get(key) ?? Number.MAX_SAFE_INTEGER) < event.seq
      ) {
        boundaries.set(key, {
          ...token,
          seq: event.seq,
          current: false,
          ...(event.sourceEvent ? { sourceEvent: event.sourceEvent } : {}),
        });
      }
      continue;
    }
    if (event.type === "tool.operation.effect_indeterminate") {
      const boundarySeq = payload?.["effectBoundaryEventSeq"];
      if (Number.isSafeInteger(boundarySeq) && Number(boundarySeq) > 0) {
        indeterminate.set(key, {
          seq: event.seq,
          boundarySeq: Number(boundarySeq),
        });
      }
      continue;
    }
    if (event.type !== "tool.operation.settled") continue;
    const priorSettlement = settlements.get(key);
    if (priorSettlement === undefined || event.seq > priorSettlement) {
      settlements.set(key, event.seq);
    }
  }
  return [...boundaries.values()]
    .filter((boundary) => {
      const key = executionTokenKey(boundary);
      const settledAt = settlements.get(key);
      const abandoned = indeterminate.get(key);
      return (
        (settledAt === undefined || settledAt <= boundary.seq) &&
        (!abandoned ||
          abandoned.seq <= boundary.seq ||
          abandoned.boundarySeq !== boundary.seq)
      );
    })
    .map((boundary) => {
      const current = latestLease.get(boundary.operationId);
      return {
        operationId: boundary.operationId,
        ownerSha256: boundary.ownerSha256,
        generation: boundary.generation,
        boundaryEventSeq: boundary.seq,
        current:
          current?.generation === boundary.generation &&
          current.ownerSha256 === boundary.ownerSha256,
        ...(boundary.sourceEvent
          ? { boundaryEvent: boundary.sourceEvent }
          : {}),
      };
    })
    .sort(
      (left, right) =>
        left.operationId.localeCompare(right.operationId) ||
        left.generation - right.generation,
    );
}

function executionLease(
  payload: Record<string, unknown> | undefined,
  seq: number,
): (ExecutionToken & { expiresAtMs: number; seq: number }) | undefined {
  const token = executionToken(payload);
  const expiresAtMs = payload?.["executionLeaseExpiresAtMs"];
  return token && Number.isSafeInteger(expiresAtMs) && Number(expiresAtMs) >= 0
    ? { ...token, expiresAtMs: Number(expiresAtMs), seq }
    : undefined;
}

function laterLease(
  candidate: ExecutionToken & { expiresAtMs: number; seq: number },
  current: ExecutionToken & { expiresAtMs: number; seq: number },
): boolean {
  return (
    candidate.generation > current.generation ||
    (candidate.generation === current.generation &&
      (candidate.expiresAtMs > current.expiresAtMs ||
        (candidate.expiresAtMs === current.expiresAtMs &&
          candidate.seq > current.seq)))
  );
}

function eventPayload(eventJson: string): Record<string, unknown> | undefined {
  let event: unknown;
  try {
    event = JSON.parse(eventJson);
  } catch {
    return undefined;
  }
  if (!objectRecord(event)) return undefined;
  const payload = event["payload"];
  return objectRecord(payload) ? payload : undefined;
}

function executionToken(
  payload: Record<string, unknown> | undefined,
): ExecutionToken | undefined {
  const operationId = payload?.["operationId"];
  const ownerSha256 = payload?.["executionLeaseOwnerSha256"];
  const generation = payload?.["executionLeaseGeneration"];
  if (
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    typeof ownerSha256 !== "string" ||
    !HASH.test(ownerSha256) ||
    !Number.isSafeInteger(generation) ||
    Number(generation) < 1
  ) {
    return undefined;
  }
  return { operationId, ownerSha256, generation: Number(generation) };
}

function executionTokenKey(token: ExecutionToken): string {
  return `${token.operationId}:${token.ownerSha256}:${String(token.generation)}`;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
