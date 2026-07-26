import { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "@napier/contracts";

export const LEDGER_DATABASE_FILENAME = "ledger.sqlite";
export const LEDGER_SCHEMA_VERSION = 2;

export interface LedgerSnapshot {
  revision: number;
  stateJson: string;
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

export class SqliteLedger {
  private database: DatabaseSync | undefined;

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
      this.migrateSchema(database, versionRow.user_version);
      const integrity = database.prepare("PRAGMA quick_check").get() as
        | { quick_check: string }
        | undefined;
      if (integrity?.quick_check !== "ok") {
        throw new Error("SQLite ledger integrity check failed");
      }
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    const database = this.database;
    if (!database) return;
    this.database = undefined;
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
    const row = this.requireDatabase()
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string } | undefined;
    return row
      ? {
          revision: row.revision,
          stateJson: row.state_json,
        }
      : undefined;
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
            (singleton, revision, state_json, updated_at)
           VALUES (1, 1, ?, ?)`,
        )
        .run(stateJson, new Date().toISOString());
      const insertEvent = this.prepareEventInsert();
      for (const event of events) {
        this.insertEvent(insertEvent, event);
      }
      database.exec("COMMIT");
      return { revision: 1, stateJson };
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
              (singleton, revision, state_json, updated_at)
             VALUES (1, ?, ?, ?)`,
          )
          .run(nextRevision, stateJson, new Date().toISOString());
      } else {
        const result = database
          .prepare(
            `UPDATE workspace_state
             SET revision = ?, state_json = ?, updated_at = ?
             WHERE singleton = 1 AND revision = ?`,
          )
          .run(
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

  private migrateSchema(database: DatabaseSync, currentVersion: number): void {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS workspace_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS ledger_events (
          thread_id TEXT NOT NULL,
          seq INTEGER NOT NULL CHECK (seq >= 1),
          event_id TEXT NOT NULL UNIQUE,
          run_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          category TEXT NOT NULL,
          visibility TEXT NOT NULL,
          created_at TEXT NOT NULL,
          event_json TEXT NOT NULL CHECK (json_valid(event_json)),
          PRIMARY KEY (thread_id, seq)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS ledger_events_run
          ON ledger_events (run_id, seq);
      `);
      if (currentVersion <= 1) {
        database.exec(`
          CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
            version INTEGER PRIMARY KEY CHECK (version >= 1),
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          ) STRICT;
        `);
        const appliedAt = new Date().toISOString();
        database
          .prepare(
            `INSERT OR IGNORE INTO ledger_schema_migrations
              (version, name, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(
            1,
            currentVersion === 0 ? "initial_schema" : "initial_schema_backfill",
            appliedAt,
          );
        database
          .prepare(
            `INSERT OR IGNORE INTO ledger_schema_migrations
              (version, name, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(2, "schema_migration_history", appliedAt);
        database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
      } else {
        database.exec(`
          CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
            version INTEGER PRIMARY KEY CHECK (version >= 1),
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          ) STRICT;
        `);
      }
      database.exec("COMMIT");
    } catch (error) {
      rollback(database);
      throw error;
    }
  }
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original transaction error is more useful than a redundant rollback.
  }
}
