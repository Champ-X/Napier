import type { DatabaseSync } from "node:sqlite";

export function createToolConcurrencyLeaseSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tool_concurrency_lease_generation (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      generation INTEGER NOT NULL CHECK (generation >= 0)
    ) STRICT;

    INSERT OR IGNORE INTO tool_concurrency_lease_generation
      (singleton, generation)
    VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS tool_concurrency_leases (
      lease_id TEXT PRIMARY KEY CHECK (length(lease_id) BETWEEN 3 AND 128),
      owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 3 AND 256),
      operation_id TEXT NOT NULL CHECK (
        length(operation_id) BETWEEN 1 AND 512
      ),
      generation INTEGER NOT NULL UNIQUE CHECK (generation >= 1),
      acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
      heartbeat_at_ms INTEGER NOT NULL CHECK (heartbeat_at_ms >= acquired_at_ms),
      expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > heartbeat_at_ms)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS tool_concurrency_leases_expiry
      ON tool_concurrency_leases (expires_at_ms);

    CREATE TABLE IF NOT EXISTS tool_concurrency_lease_resources (
      lease_id TEXT NOT NULL,
      resource_key_json TEXT NOT NULL CHECK (
        json_valid(resource_key_json) AND
        json_type(resource_key_json) = 'array'
      ),
      mode TEXT NOT NULL CHECK (mode IN ('safe', 'serialized', 'exclusive')),
      PRIMARY KEY (lease_id, resource_key_json),
      FOREIGN KEY (lease_id) REFERENCES tool_concurrency_leases(lease_id)
        ON UPDATE RESTRICT ON DELETE CASCADE
    ) STRICT;
  `);
}
