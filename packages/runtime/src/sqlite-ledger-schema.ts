import type { DatabaseSync } from "node:sqlite";

import {
  createRunLeaseSchema,
  runLeasesFromStateJson,
  synchronizeRunLeases,
} from "./sqlite-run-leases.js";

export const LEDGER_SCHEMA_VERSION = 4;

export function migrateLedgerSchema(
  database: DatabaseSync,
  currentVersion: number,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    createBaseSchema(database);
    createMigrationHistory(database, currentVersion);
    migrateEventOnlySnapshots(database, currentVersion);
    createRunLeaseSchema(database);
    migrateRunLeases(database, currentVersion);
    database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error) {
    rollback(database);
    throw error;
  }
}

function createBaseSchema(database: DatabaseSync): void {
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
}

function createMigrationHistory(
  database: DatabaseSync,
  currentVersion: number,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version >= 1),
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  if (currentVersion > 1) return;
  const appliedAt = new Date().toISOString();
  recordMigration(
    database,
    1,
    currentVersion === 0 ? "initial_schema" : "initial_schema_backfill",
    appliedAt,
  );
  recordMigration(database, 2, "schema_migration_history", appliedAt);
}

function migrateEventOnlySnapshots(
  database: DatabaseSync,
  currentVersion: number,
): void {
  if (currentVersion >= 3) return;
  const columns = database
    .prepare("PRAGMA table_info(workspace_state)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "snapshot_revision")) {
    database.exec(`
      ALTER TABLE workspace_state
      ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 1;
    `);
  }
  database.exec("UPDATE workspace_state SET snapshot_revision = revision");
  recordMigration(
    database,
    3,
    "event_only_state_snapshots",
    new Date().toISOString(),
  );
}

function migrateRunLeases(
  database: DatabaseSync,
  currentVersion: number,
): void {
  if (currentVersion >= 4) return;
  const row = database
    .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
    .get() as { state_json: string } | undefined;
  if (row) {
    synchronizeRunLeases(database, runLeasesFromStateJson(row.state_json));
  }
  recordMigration(
    database,
    4,
    "normalized_run_leases",
    new Date().toISOString(),
  );
}

function recordMigration(
  database: DatabaseSync,
  version: number,
  name: string,
  appliedAt: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO ledger_schema_migrations
        (version, name, applied_at)
       VALUES (?, ?, ?)`,
    )
    .run(version, name, appliedAt);
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original transaction error is more useful than a redundant rollback.
  }
}
