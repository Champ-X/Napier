import type { LedgerRunLease } from "./sqlite-run-leases.js";

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
