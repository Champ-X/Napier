import type { DatabaseSync } from "node:sqlite";

import { listRunLeases } from "./sqlite-run-leases.js";
import type { LedgerSnapshot } from "./sqlite-ledger-model.js";

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
