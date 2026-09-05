import type { DatabaseSync } from "node:sqlite";

import type {
  RunEvent,
  RunEventAdmissionPolicyV1,
  RunStatus,
} from "@napier/contracts";

import {
  assertIdempotentEventReplay,
  eventIdempotencyKey,
  type EventIdempotencyKey,
  type IdempotentRunEvent,
} from "./event-idempotency.js";
import { assertDurableRunEventAdmission } from "./run-event-admission.js";
import {
  ConcurrentRunEventHeadError,
  ConcurrentStoreUpdateError,
} from "./sqlite-ledger-errors.js";
import { readTerminalRunStatus } from "./sqlite-terminal-events.js";
import {
  assertNoContinuationAfterEffectIndeterminate,
  EffectIndeterminateCommitError,
} from "./sqlite-effect-indeterminate-commit.js";
import { assertNoLiveToolEffectAuthority } from "./sqlite-tool-effect-authority.js";
import { assertToolOperationEventIntegrity } from "./tool-execution-event-integrity.js";

export interface SqliteEventOnceResult {
  event: RunEvent;
  revision: number;
  appended: boolean;
  /**
   * The commit was based on a newer workspace or Thread event frontier than
   * the caller's in-memory projection. The durable event is authoritative and
   * the caller must rebuild its projection before publishing compatibility
   * state.
   */
  projectionRefreshRequired: boolean;
}

export interface SqliteRunEventHeadCondition {
  expectedRunHeadSeq: number;
  admission?: RunEventAdmissionPolicyV1;
}

export function commitSqliteEventOnce(
  database: DatabaseSync,
  expectedRevision: number,
  event: IdempotentRunEvent,
  idempotency: EventIdempotencyKey,
  admission: RunEventAdmissionPolicyV1 = "run_any",
): SqliteEventOnceResult {
  return commitSqliteEventOnceTransaction(
    database,
    expectedRevision,
    event,
    idempotency,
    undefined,
    admission,
  );
}

export function commitSqliteEventOnceAtRunHead(
  database: DatabaseSync,
  expectedRevision: number,
  event: IdempotentRunEvent,
  idempotency: EventIdempotencyKey,
  runHead: SqliteRunEventHeadCondition,
): SqliteEventOnceResult {
  return commitSqliteEventOnceTransaction(
    database,
    expectedRevision,
    event,
    idempotency,
    runHead,
    runHead.admission ?? "run_any",
  );
}

function commitSqliteEventOnceTransaction(
  database: DatabaseSync,
  expectedRevision: number,
  event: IdempotentRunEvent,
  idempotency: EventIdempotencyKey,
  runHead?: SqliteRunEventHeadCondition,
  admission: RunEventAdmissionPolicyV1 = "run_any",
): SqliteEventOnceResult {
  if (event.type === "tool.operation.effect_indeterminate") {
    throw new EffectIndeterminateCommitError(
      event.runId,
      "the marker is restricted to an atomic lifecycle snapshot transition",
    );
  }
  assertToolOperationEventIntegrity([event]);
  database.exec("BEGIN IMMEDIATE");
  try {
    const actualRevision = workspaceRevision(database);
    if (actualRevision === undefined) {
      throw new ConcurrentStoreUpdateError(expectedRevision, 0);
    }
    const existing = findIdempotentEvent(database, idempotency, event);
    if (existing) {
      assertIdempotentEventReplay(existing, event);
      database.exec("COMMIT");
      return {
        event: existing,
        revision: actualRevision,
        appended: false,
        projectionRefreshRequired: true,
      };
    }
    // A replay is not a new commit, so it is intentionally resolved before
    // the head check. New semantic events must still be based on the exact
    // Run history observed by their caller.
    if (runHead) {
      const actualRunHeadSeq = runEventHeadSeq(
        database,
        event.threadId,
        event.runId,
      );
      if (actualRunHeadSeq !== runHead.expectedRunHeadSeq) {
        throw new ConcurrentRunEventHeadError(
          event.runId,
          runHead.expectedRunHeadSeq,
          actualRunHeadSeq,
        );
      }
      assertDurableEventAdmission(database, event, admission);
    } else {
      assertDurableEventAdmission(database, event, admission);
      if (actualRevision !== expectedRevision) {
        // Unconditional idempotent events have no causal lane cursor. Keep the
        // workspace CAS until their callers declare a narrower dependency.
        throw new ConcurrentStoreUpdateError(expectedRevision, actualRevision);
      }
    }
    assertNoContinuationAfterEffectIndeterminate(database, [event]);
    if (admission === "terminal_transition") {
      assertNoLiveToolEffectAuthority(database, event.threadId, event.runId);
    }
    const committedEvent = allocateThreadSequence(database, event);
    assertEmbeddedKey(committedEvent, idempotency);
    insertEvent(database, committedEvent);
    insertSqliteEventIdempotency(database, committedEvent);
    const nextRevision = actualRevision + 1;
    const result = database
      .prepare(
        `UPDATE workspace_state
         SET revision = ?, updated_at = ?
         WHERE singleton = 1 AND revision = ?`,
      )
      .run(nextRevision, new Date().toISOString(), actualRevision);
    if (Number(result.changes) !== 1) {
      throw new ConcurrentStoreUpdateError(
        expectedRevision,
        workspaceRevision(database) ?? 0,
      );
    }
    database.exec("COMMIT");
    return {
      event: committedEvent,
      revision: nextRevision,
      appended: true,
      projectionRefreshRequired:
        actualRevision !== expectedRevision || committedEvent.seq !== event.seq,
    };
  } catch (error) {
    rollback(database);
    throw error;
  }
}

function assertDurableEventAdmission(
  database: DatabaseSync,
  event: Pick<RunEvent, "threadId" | "runId" | "type">,
  admission: RunEventAdmissionPolicyV1,
): void {
  if (admission === "run_any") return;
  const durableRunStatus = runStatus(database, event.threadId, event.runId);
  const terminalStatus = readTerminalRunStatus(
    database,
    event.threadId,
    event.runId,
  );
  assertDurableRunEventAdmission(
    admission,
    event.type,
    durableRunStatus === "missing"
      ? undefined
      : { threadId: event.threadId, status: durableRunStatus },
    event.threadId,
    terminalStatus,
  );
}

/**
 * Thread sequence numbers are ledger-owned ordering metadata. Allocating the
 * final value while holding SQLite's write transaction lets independent
 * Threads commit against the same workspace revision and lets independent
 * Runs sharing one Thread serialize without colliding on (thread_id, seq).
 */
function allocateThreadSequence(
  database: DatabaseSync,
  event: IdempotentRunEvent,
): IdempotentRunEvent {
  const seq = threadEventHeadSeq(database, event.threadId) + 1;
  return seq === event.seq ? event : { ...event, seq };
}

export function insertSqliteEventIdempotency(
  database: DatabaseSync,
  event: RunEvent,
): void {
  const idempotency = eventIdempotencyKey(event);
  if (!idempotency) return;
  database
    .prepare(
      `INSERT INTO ledger_event_idempotency (
        thread_id,
        run_id,
        namespace,
        idempotency_key,
        event_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.threadId,
      event.runId,
      idempotency.namespace,
      idempotency.key,
      event.id,
      event.createdAt,
    );
}

function workspaceRevision(database: DatabaseSync): number | undefined {
  const row = database
    .prepare("SELECT revision FROM workspace_state WHERE singleton = 1")
    .get() as { revision: number } | undefined;
  return row?.revision;
}

function runEventHeadSeq(
  database: DatabaseSync,
  threadId: string,
  runId: string,
): number {
  const row = database
    .prepare(
      `SELECT MAX(seq) AS max_seq
       FROM ledger_events
       WHERE thread_id = ? AND run_id = ?`,
    )
    .get(threadId, runId) as { max_seq: number | null };
  return row.max_seq ?? 0;
}

function threadEventHeadSeq(database: DatabaseSync, threadId: string): number {
  const row = database
    .prepare(
      `SELECT MAX(seq) AS max_seq
       FROM ledger_events
       WHERE thread_id = ?`,
    )
    .get(threadId) as { max_seq: number | null };
  return row.max_seq ?? 0;
}

function runStatus(
  database: DatabaseSync,
  threadId: string,
  runId: string,
): RunStatus | "missing" {
  const row = database
    .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
    .get() as { state_json: string } | undefined;
  if (!row) return "missing";
  const state = JSON.parse(row.state_json) as {
    runs?: Array<{ id?: unknown; threadId?: unknown; status?: unknown }>;
  };
  const run = state.runs?.find(
    (candidate) => candidate.id === runId && candidate.threadId === threadId,
  );
  return validRunStatus(run?.status) ? run.status : "missing";
}

function validRunStatus(value: unknown): value is RunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function findIdempotentEvent(
  database: DatabaseSync,
  idempotency: EventIdempotencyKey,
  scope: Pick<RunEvent, "threadId" | "runId">,
): RunEvent | undefined {
  const row = database
    .prepare(
      `SELECT events.event_json
       FROM ledger_event_idempotency AS keys
       INNER JOIN ledger_events AS events
         ON events.event_id = keys.event_id
       WHERE keys.thread_id = ?
         AND keys.run_id = ?
         AND keys.namespace = ?
         AND keys.idempotency_key = ?`,
    )
    .get(
      scope.threadId,
      scope.runId,
      idempotency.namespace,
      idempotency.key,
    ) as { event_json: string } | undefined;
  if (!row) return undefined;
  const event = JSON.parse(row.event_json) as RunEvent;
  if (event.threadId !== scope.threadId || event.runId !== scope.runId) {
    throw new Error("Ledger event idempotency scope is invalid");
  }
  assertEmbeddedKey(event as IdempotentRunEvent, idempotency);
  return event;
}

function assertEmbeddedKey(
  event: IdempotentRunEvent,
  idempotency: EventIdempotencyKey,
): void {
  const embedded = eventIdempotencyKey(event);
  if (
    !embedded ||
    embedded.namespace !== idempotency.namespace ||
    embedded.key !== idempotency.key
  ) {
    throw new Error("Ledger event idempotency binding is invalid");
  }
}

function insertEvent(database: DatabaseSync, event: RunEvent): void {
  database
    .prepare(
      `INSERT INTO ledger_events (
        thread_id,
        seq,
        event_id,
        run_id,
        event_type,
        category,
        visibility,
        created_at,
        event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.threadId,
      event.seq,
      event.id,
      event.runId,
      event.type,
      event.category,
      event.visibility,
      event.createdAt,
      JSON.stringify(event),
    );
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}
