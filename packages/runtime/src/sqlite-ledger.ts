import { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "@napier/contracts";

import {
  listRunLeases,
  renewRunLease,
  runLeasesFromStateJson,
  synchronizeRunLeases,
  type LedgerRunLease,
} from "./sqlite-run-leases.js";
import {
  LEDGER_SCHEMA_VERSION,
  migrateLedgerSchema,
} from "./sqlite-ledger-schema.js";
import { SqliteLedgerQuery } from "./sqlite-ledger-query.js";
import { SqliteLedgerReadWorker } from "./sqlite-ledger-read-worker.js";
import type { RunEventQueryScope } from "./run-event-query-port.js";

export const LEDGER_DATABASE_FILENAME = "ledger.sqlite";
export { LEDGER_SCHEMA_VERSION } from "./sqlite-ledger-schema.js";

export interface LedgerSnapshot {
  revision: number;
  snapshotRevision: number;
  stateJson: string;
  runLeases: LedgerRunLease[];
}

export interface LedgerEventStats {
  threadId: string;
  count: number;
  maxSeq: number;
}

export interface LedgerSchemaMigration {
  version: number;
  name: string;
  appliedAt: string;
}

export interface LedgerSchemaReport {
  schemaVersion: number;
  quickCheck: string;
  migrations: LedgerSchemaMigration[];
}

export class ConcurrentStoreUpdateError extends Error {
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Concurrent store update detected: expected revision ${expectedRevision}, found ${actualRevision}`,
    );
    this.name = "ConcurrentStoreUpdateError";
  }
}

export class ConcurrentRunLeaseUpdateError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedRevision: number,
  ) {
    super(
      `Concurrent Run lease update detected: ${runId} expected revision ${String(expectedRevision)}`,
    );
    this.name = "ConcurrentRunLeaseUpdateError";
  }
}

export class SqliteLedger {
  private database: DatabaseSync | undefined;
  private query: SqliteLedgerQuery | undefined;
  private reader: SqliteLedgerReadWorker | undefined;

  constructor(readonly databasePath: string) {}

  initialize(): void {
    if (this.database) return;
    const database = new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    });
    try {
      const versionRow = database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (
        versionRow.user_version < 0 ||
        versionRow.user_version > LEDGER_SCHEMA_VERSION
      ) {
        throw new Error(
          `Unsupported SQLite ledger schema version: ${versionRow.user_version}`,
        );
      }
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        PRAGMA trusted_schema = OFF;

      `);
      migrateLedgerSchema(database, versionRow.user_version);
      const integrity = database.prepare("PRAGMA quick_check").get() as
        | { quick_check: string }
        | undefined;
      if (integrity?.quick_check !== "ok") {
        throw new Error("SQLite ledger integrity check failed");
      }
      this.database = database;
      this.query = new SqliteLedgerQuery(database);
      this.reader = new SqliteLedgerReadWorker(this.databasePath);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    const database = this.database;
    if (!database) return;
    this.database = undefined;
    this.query = undefined;
    this.reader?.close();
    this.reader = undefined;
    database.close();
  }

  schemaReport(): LedgerSchemaReport {
    const database = this.requireDatabase();
    const versionRow = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const integrity = database.prepare("PRAGMA quick_check").get() as
      | { quick_check: string }
      | undefined;
    const rows = database
      .prepare(
        `SELECT version, name, applied_at
         FROM ledger_schema_migrations
         ORDER BY version ASC`,
      )
      .all() as Array<{
      version: number;
      name: string;
      applied_at: string;
    }>;
    return {
      schemaVersion: versionRow.user_version,
      quickCheck: integrity?.quick_check ?? "missing",
      migrations: rows.map((row) => ({
        version: row.version,
        name: row.name,
        appliedAt: row.applied_at,
      })),
    };
  }

  readSnapshot(): LedgerSnapshot | undefined {
    const database = this.requireDatabase();
    const ownsTransaction = !database.isTransaction;
    if (ownsTransaction) database.exec("BEGIN");
    try {
      const snapshot = readSnapshot(database);
      if (ownsTransaction) database.exec("COMMIT");
      return snapshot;
    } catch (error) {
      if (ownsTransaction) rollback(database);
      throw error;
    }
  }

  bootstrap(stateJson: string, events: RunEvent[]): LedgerSnapshot {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.readSnapshot();
      if (existing) {
        database.exec("COMMIT");
        return existing;
      }
      database
        .prepare(
          `INSERT INTO workspace_state
            (singleton, revision, snapshot_revision, state_json, updated_at)
           VALUES (1, 1, 1, ?, ?)`,
        )
        .run(stateJson, new Date().toISOString());
      const insertEvent = this.prepareEventInsert();
      for (const event of events) {
        this.insertEvent(insertEvent, event);
      }
      synchronizeRunLeases(database, runLeasesFromStateJson(stateJson));
      database.exec("COMMIT");
      return {
        revision: 1,
        snapshotRevision: 1,
        stateJson,
        runLeases: listRunLeases(database),
      };
    } catch (error) {
      rollback(database);
      throw error;
    }
  }

  commit(
    expectedRevision: number,
    stateJson: string,
    eventOrEvents?: RunEvent | RunEvent[],
  ): number {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readSnapshot();
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new ConcurrentStoreUpdateError(expectedRevision, actualRevision);
      }
      const events = Array.isArray(eventOrEvents)
        ? eventOrEvents
        : eventOrEvents
          ? [eventOrEvents]
          : [];
      if (events.length > 0) {
        const insertEvent = this.prepareEventInsert();
        for (const event of events) this.insertEvent(insertEvent, event);
      }
      const nextRevision = actualRevision + 1;
      if (actualRevision === 0) {
        database
          .prepare(
            `INSERT INTO workspace_state
              (singleton, revision, snapshot_revision, state_json, updated_at)
             VALUES (1, ?, ?, ?, ?)`,
          )
          .run(nextRevision, nextRevision, stateJson, new Date().toISOString());
      } else {
        const result = database
          .prepare(
            `UPDATE workspace_state
             SET revision = ?, snapshot_revision = ?, state_json = ?, updated_at = ?
             WHERE singleton = 1 AND revision = ?`,
          )
          .run(
            nextRevision,
            nextRevision,
            stateJson,
            new Date().toISOString(),
            actualRevision,
          );
        if (Number(result.changes) !== 1) {
          throw new ConcurrentStoreUpdateError(
            expectedRevision,
            this.readSnapshot()?.revision ?? 0,
          );
        }
      }
      synchronizeRunLeases(database, runLeasesFromStateJson(stateJson));
      database.exec("COMMIT");
      return nextRevision;
    } catch (error) {
      rollback(database);
      throw error;
    }
  }

  commitEvents(
    expectedRevision: number,
    eventOrEvents: RunEvent | RunEvent[],
  ): number {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readSnapshot();
      const actualRevision = current?.revision ?? 0;
      if (!current || actualRevision !== expectedRevision) {
        throw new ConcurrentStoreUpdateError(expectedRevision, actualRevision);
      }
      const events = Array.isArray(eventOrEvents)
        ? eventOrEvents
        : [eventOrEvents];
      if (events.length !== 1) {
        throw new Error("Event-only commit requires exactly one event");
      }
      const insertEvent = this.prepareEventInsert();
      for (const event of events) this.insertEvent(insertEvent, event);
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
          this.readSnapshot()?.revision ?? 0,
        );
      }
      database.exec("COMMIT");
      return nextRevision;
    } catch (error) {
      rollback(database);
      throw error;
    }
  }

  listEvents(threadId: string, afterSeq = 0): RunEvent[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT event_json
         FROM ledger_events
         WHERE thread_id = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(threadId, afterSeq) as Array<{ event_json: string }>;
    return rows.map((row) => JSON.parse(row.event_json) as RunEvent);
  }

  listRunEvents(
    runId: string,
    afterSeq = 0,
    types?: readonly string[],
  ): RunEvent[] {
    return this.requireQuery().listRunEvents(runId, afterSeq, types);
  }

  listEventsRange(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): RunEvent[] {
    return this.requireQuery().listEventsRange(threadId, fromSeq, toSeq, types);
  }

  findLatestEvent(query: RunEventQueryScope): RunEvent | undefined {
    return this.requireQuery().findLatestEvent(query);
  }

  findToolTerminal(
    callId: string,
    scope?: Omit<RunEventQueryScope, "types">,
  ): RunEvent | undefined {
    return this.requireQuery().findToolTerminal(callId, scope);
  }

  listEventsByCorrelationId(
    correlationId: string,
    scope?: RunEventQueryScope,
  ): RunEvent[] {
    return this.requireQuery().listEventsByCorrelationId(correlationId, scope);
  }

  listEventStats(): LedgerEventStats[] {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT thread_id, COUNT(*) AS event_count, MAX(seq) AS max_seq
         FROM ledger_events
         GROUP BY thread_id
         ORDER BY thread_id`,
      )
      .all() as Array<{
      thread_id: string;
      event_count: number;
      max_seq: number;
    }>;
    return rows.map((row) => ({
      threadId: row.thread_id,
      count: row.event_count,
      maxSeq: row.max_seq,
    }));
  }

  renewRunLease(input: {
    runId: string;
    tokenSha256: string;
    expectedRevision: number;
    heartbeatAt: string;
    expiresAt: string;
  }): LedgerRunLease {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const lease = renewRunLease(database, input);
      if (!lease) {
        throw new ConcurrentRunLeaseUpdateError(
          input.runId,
          input.expectedRevision,
        );
      }
      database.exec("COMMIT");
      return lease;
    } catch (error) {
      rollback(database);
      throw error;
    }
  }

  private prepareEventInsert() {
    return this.requireDatabase().prepare(
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
    );
  }

  private insertEvent(
    statement: ReturnType<DatabaseSync["prepare"]>,
    event: RunEvent,
  ): void {
    statement.run(
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

  private requireDatabase(): DatabaseSync {
    if (!this.database) {
      throw new Error("SQLite ledger is not initialized");
    }
    return this.database;
  }

  private requireQuery(): SqliteLedgerQuery {
    if (!this.query) throw new Error("SQLite ledger is not initialized");
    return this.query;
  }

  eventReader(): SqliteLedgerReadWorker {
    if (!this.reader) throw new Error("SQLite ledger is not initialized");
    return this.reader;
  }
}

function readSnapshot(database: DatabaseSync): LedgerSnapshot | undefined {
  const row = database
    .prepare(
      `SELECT revision, snapshot_revision, state_json
       FROM workspace_state
       WHERE singleton = 1`,
    )
    .get() as
    | {
        revision: number;
        snapshot_revision: number;
        state_json: string;
      }
    | undefined;
  return row
    ? {
        revision: row.revision,
        snapshotRevision: row.snapshot_revision,
        stateJson: row.state_json,
        runLeases: listRunLeases(database),
      }
    : undefined;
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original transaction error is more useful than a redundant rollback.
  }
}
