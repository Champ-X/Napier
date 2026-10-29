import type { DatabaseSync } from "node:sqlite";

import { listRunLeases } from "./sqlite-run-leases.js";
import type { LedgerSchemaReport, LedgerSnapshot } from "./sqlite-ledger-model.js";

export function readLedgerSnapshot(
  database: DatabaseSync,
): LedgerSnapshot | undefined {
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

export function rollbackSqliteTransaction(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original transaction error is more useful than a redundant rollback.
  }
}

export function readSqliteTransaction<T>(database: DatabaseSync,
  read: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN");
  try {
    const result = read();
    if (result && typeof (result as { then?: unknown }).then === "function")
      throw new Error("SQLite ledger read transaction callback must be synchronous");
    if (ownsTransaction) database.exec("COMMIT");
    return result;
  } catch (error) {
    if (ownsTransaction) rollbackSqliteTransaction(database);
    throw error;
  }
}

export function readLedgerSchemaReport(database: DatabaseSync): LedgerSchemaReport {
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
