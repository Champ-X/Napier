import type { DatabaseSync } from "node:sqlite";

import type { RunLeaseSummary } from "@napier/contracts";

export interface LedgerRunLease {
  runId: string;
  threadId: string;
  tokenSha256: string;
  lease: RunLeaseSummary;
}

export function createRunLeaseSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS run_leases (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      token_sha256 TEXT NOT NULL CHECK (
        length(token_sha256) = 64 AND
        token_sha256 NOT GLOB '*[^0-9a-f]*'
      )
    ) STRICT;

    CREATE INDEX IF NOT EXISTS run_leases_thread
      ON run_leases (thread_id, run_id);
  `);
}

export function listRunLeases(database: DatabaseSync): LedgerRunLease[] {
  const rows = database
    .prepare(
      `SELECT run_id, thread_id, owner_id, acquired_at, heartbeat_at,
              expires_at, revision, token_sha256
       FROM run_leases
       ORDER BY run_id`,
    )
    .all() as Array<{
    run_id: string;
    thread_id: string;
    owner_id: string;
    acquired_at: string;
    heartbeat_at: string;
    expires_at: string;
    revision: number;
    token_sha256: string;
  }>;
  return rows.map((row) => validateRunLeaseRow(row));
}

export function synchronizeRunLeases(
  database: DatabaseSync,
  leases: readonly LedgerRunLease[],
): number {
  const retained = new Set(leases.map((lease) => lease.runId));
  const existing = database
    .prepare("SELECT run_id, revision FROM run_leases")
    .all() as Array<{ run_id: string; revision: number }>;
  const upsert = database.prepare(
    `INSERT INTO run_leases (
      run_id, thread_id, owner_id, acquired_at, heartbeat_at,
      expires_at, revision, token_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      owner_id = excluded.owner_id,
      acquired_at = excluded.acquired_at,
      heartbeat_at = excluded.heartbeat_at,
      expires_at = excluded.expires_at,
      revision = excluded.revision,
      token_sha256 = excluded.token_sha256
    WHERE excluded.revision > run_leases.revision OR (
      excluded.revision = run_leases.revision AND (
        excluded.thread_id <> run_leases.thread_id OR
        excluded.owner_id <> run_leases.owner_id OR
        excluded.acquired_at <> run_leases.acquired_at OR
        excluded.heartbeat_at <> run_leases.heartbeat_at OR
        excluded.expires_at <> run_leases.expires_at OR
        excluded.token_sha256 <> run_leases.token_sha256
      )
    )`,
  );
  let changes = 0;
  for (const lease of leases) {
    validateRunLease(lease);
    changes += Number(
      upsert.run(
        lease.runId,
        lease.threadId,
        lease.lease.ownerId,
        lease.lease.acquiredAt,
        lease.lease.heartbeatAt,
        lease.lease.expiresAt,
        lease.lease.revision,
        lease.tokenSha256,
      ).changes,
    );
  }
  const remove = database.prepare("DELETE FROM run_leases WHERE run_id = ?");
  for (const row of existing) {
    if (!retained.has(row.run_id)) {
      changes += Number(remove.run(row.run_id).changes);
    }
  }
  return changes;
}

export function renewRunLease(
  database: DatabaseSync,
  input: {
    runId: string;
    tokenSha256: string;
    expectedRevision: number;
    heartbeatAt: string;
    expiresAt: string;
  },
): LedgerRunLease | undefined {
  assertIso(input.heartbeatAt, "heartbeatAt");
  assertIso(input.expiresAt, "expiresAt");
  const result = database
    .prepare(
      `UPDATE run_leases
       SET heartbeat_at = ?, expires_at = ?, revision = revision + 1
       WHERE run_id = ? AND token_sha256 = ? AND revision = ?
         AND expires_at > ?`,
    )
    .run(
      input.heartbeatAt,
      input.expiresAt,
      input.runId,
      input.tokenSha256,
      input.expectedRevision,
      input.heartbeatAt,
    );
  if (Number(result.changes) !== 1) return undefined;
  return listRunLeases(database).find((lease) => lease.runId === input.runId);
}

export function runLeasesFromStateJson(stateJson: string): LedgerRunLease[] {
  const state = JSON.parse(stateJson) as { runs?: unknown };
  if (!Array.isArray(state.runs)) {
    throw new Error("SQLite Run lease state is invalid");
  }
  return state.runs.flatMap((value): LedgerRunLease[] => {
    if (!record(value)) {
      throw new Error("SQLite Run lease state Run is invalid");
    }
    const lease = value["lease"];
    const tokenSha256 = value["leaseTokenSha256"];
    if (lease === undefined && tokenSha256 === undefined) return [];
    if (!record(lease) || typeof tokenSha256 !== "string") {
      throw new Error("SQLite Run lease state binding is invalid");
    }
    const output = {
      runId: String(value["id"]),
      threadId: String(value["threadId"]),
      tokenSha256,
      lease: {
        ownerId: String(lease["ownerId"]),
        acquiredAt: String(lease["acquiredAt"]),
        heartbeatAt: String(lease["heartbeatAt"]),
        expiresAt: String(lease["expiresAt"]),
        revision: Number(lease["revision"]),
      },
    };
    validateRunLease(output);
    return [output];
  });
}

function validateRunLeaseRow(row: {
  run_id: string;
  thread_id: string;
  owner_id: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  revision: number;
  token_sha256: string;
}): LedgerRunLease {
  const lease = {
    runId: row.run_id,
    threadId: row.thread_id,
    tokenSha256: row.token_sha256,
    lease: {
      ownerId: row.owner_id,
      acquiredAt: row.acquired_at,
      heartbeatAt: row.heartbeat_at,
      expiresAt: row.expires_at,
      revision: row.revision,
    },
  };
  validateRunLease(lease);
  return lease;
}

function validateRunLease(lease: LedgerRunLease): void {
  if (
    !/^[a-z][a-z0-9_]{2,80}$/u.test(lease.runId) ||
    !/^[a-z][a-z0-9_]{2,80}$/u.test(lease.threadId) ||
    !/^[a-z][a-z0-9_.:-]{2,127}$/u.test(lease.lease.ownerId) ||
    !/^[a-f0-9]{64}$/u.test(lease.tokenSha256) ||
    !Number.isSafeInteger(lease.lease.revision) ||
    lease.lease.revision < 1
  ) {
    throw new Error("SQLite Run lease is invalid");
  }
  assertIso(lease.lease.acquiredAt, "acquiredAt");
  assertIso(lease.lease.heartbeatAt, "heartbeatAt");
  assertIso(lease.lease.expiresAt, "expiresAt");
  if (
    Date.parse(lease.lease.heartbeatAt) < Date.parse(lease.lease.acquiredAt) ||
    Date.parse(lease.lease.expiresAt) <= Date.parse(lease.lease.heartbeatAt)
  ) {
    throw new Error("SQLite Run lease timeline is invalid");
  }
}

function assertIso(value: string, field: string): void {
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`SQLite Run lease ${field} is invalid`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
