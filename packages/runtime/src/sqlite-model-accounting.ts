import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RunEvent } from "@napier/contracts";
import type { LedgerSnapshot } from "./sqlite-ledger-model.js";
import { readLedgerSnapshot } from "./sqlite-ledger-state.js";

export interface LedgerModelAccountingPort {
  listRunEvents(runId: string): RunEvent[];
  readRunAccountingView(runId: string): { snapshot: LedgerSnapshot | undefined; events: RunEvent[] };
  readModelAttemptView(physicalId: string): LedgerModelAttemptView;
  modelAccountingIdentity(): string;
  modelAttribution(physicalId: string): LedgerModelAttribution | undefined;
  modelUsageClaim(physicalId: string): LedgerModelUsageClaim | undefined;
  modelChildInvocationClosed(invocationId: string): boolean;
}

export interface LedgerModelAttemptView {
  workspaceLedgerId: string;
  snapshot: LedgerSnapshot | undefined;
  attribution: LedgerModelAttribution | undefined;
  claim: LedgerModelUsageClaim | undefined;
  event: RunEvent | undefined;
}

/** Caller owns one read transaction across snapshot, native identity and claim evidence. */
export function readModelAttemptView(database: DatabaseSync, physicalId: string): LedgerModelAttemptView {
  if (!database.isTransaction) throw new Error("Model attempt read requires its Store transaction");
  const claim = readModelUsageClaim(database, physicalId);
  const row = claim?.eventId ? database.prepare("SELECT event_json FROM ledger_events WHERE event_id = ?")
    .get(claim.eventId) as { event_json: string } | undefined : undefined;
  return { workspaceLedgerId: readModelAccountingIdentity(database), snapshot: readLedgerSnapshot(database),
    attribution: readModelAttribution(database, physicalId), claim,
    event: row ? JSON.parse(row.event_json) as RunEvent : undefined };
}

export interface LedgerModelAttribution {
  physicalId: string;
  attributionSha256: string;
  attributionJson: string;
  runId: string | null;
  childInvocationId: string | null;
  dataRootSha256: string;
  workspaceRootSha256: string;
  state: "prepared" | "dispatch_intent" | "settled";
}

export interface LedgerModelUsageClaim {
  physicalId: string;
  attributionSha256: string;
  receiptSha256: string;
  receiptJson: string;
  eventId: string | null;
}

export type LedgerModelAccountingMutation =
  | { kind: "prepare"; attribution: LedgerModelAttribution }
  | { kind: "enter"; physicalId: string; attributionSha256: string }
  | { kind: "claim"; claim: LedgerModelUsageClaim }
  | { kind: "close_child"; childInvocationId: string; runId: string };

export function createModelAccountingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_accounting_identity (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      workspace_ledger_id TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS model_call_attributions (
      physical_id TEXT PRIMARY KEY,
      attribution_sha256 TEXT NOT NULL,
      attribution_json TEXT NOT NULL CHECK (json_valid(attribution_json)),
      run_id TEXT,
      child_invocation_id TEXT UNIQUE,
      data_root_sha256 TEXT NOT NULL,
      workspace_root_sha256 TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'dispatch_intent', 'settled'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS model_call_attributions_run ON model_call_attributions(run_id);
    CREATE TABLE IF NOT EXISTS model_usage_claims (
      physical_id TEXT PRIMARY KEY REFERENCES model_call_attributions(physical_id),
      attribution_sha256 TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
      event_id TEXT REFERENCES ledger_events(event_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS model_child_undispatched (
      child_invocation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL
    ) STRICT;
  `);
  database.prepare("INSERT OR IGNORE INTO model_accounting_identity VALUES (1, ?)")
    .run(`ledger_${randomUUID()}`);
}

export function readModelAccountingIdentity(database: DatabaseSync): string {
  const row = database.prepare("SELECT workspace_ledger_id FROM model_accounting_identity WHERE singleton = 1")
    .get() as { workspace_ledger_id: string } | undefined;
  if (!row) throw new Error("Model accounting identity is unavailable");
  return row.workspace_ledger_id;
}

export function readModelAttribution(database: DatabaseSync, physicalId: string): LedgerModelAttribution | undefined {
  return database.prepare(`SELECT physical_id AS physicalId, attribution_sha256 AS attributionSha256,
    attribution_json AS attributionJson, run_id AS runId, child_invocation_id AS childInvocationId,
    data_root_sha256 AS dataRootSha256, workspace_root_sha256 AS workspaceRootSha256, state
    FROM model_call_attributions WHERE physical_id = ?`).get(physicalId) as LedgerModelAttribution | undefined;
}

export function listModelAttributions(database: DatabaseSync, runId: string): LedgerModelAttribution[] {
  return database.prepare(`SELECT physical_id AS physicalId, attribution_sha256 AS attributionSha256,
    attribution_json AS attributionJson, run_id AS runId, child_invocation_id AS childInvocationId,
    data_root_sha256 AS dataRootSha256, workspace_root_sha256 AS workspaceRootSha256, state
    FROM model_call_attributions WHERE run_id = ? ORDER BY physical_id`).all(runId) as unknown as LedgerModelAttribution[];
}

export function readModelUsageClaim(database: DatabaseSync, physicalId: string): LedgerModelUsageClaim | undefined {
  return database.prepare(`SELECT physical_id AS physicalId, attribution_sha256 AS attributionSha256,
    receipt_sha256 AS receiptSha256, receipt_json AS receiptJson, event_id AS eventId
    FROM model_usage_claims WHERE physical_id = ?`).get(physicalId) as LedgerModelUsageClaim | undefined;
}

export function childInvocationIsClosed(database: DatabaseSync, invocationId: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM model_child_undispatched WHERE child_invocation_id = ?").get(invocationId));
}

/** Called only inside the snapshot/event writer transaction; never opens its own transaction. */
export function applyModelAccountingMutation(database: DatabaseSync, mutation: LedgerModelAccountingMutation): void {
  if (!database.isTransaction) throw new Error("Model accounting mutation requires its Store transaction");
  if (mutation.kind === "prepare") {
    const value = mutation.attribution;
    if (value.childInvocationId && childInvocationIsClosed(database, value.childInvocationId))
      throw new Error("Child invocation was closed before dispatch");
    database.prepare(`INSERT INTO model_call_attributions VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared')`)
      .run(value.physicalId, value.attributionSha256, value.attributionJson, value.runId,
        value.childInvocationId, value.dataRootSha256, value.workspaceRootSha256);
    return;
  }
  if (mutation.kind === "close_child") {
    if (database.prepare("SELECT 1 FROM model_call_attributions WHERE child_invocation_id = ?").get(mutation.childInvocationId))
      throw new Error("Prepared child invocation requires a physical disposition");
    database.prepare("INSERT INTO model_child_undispatched VALUES (?, ?)").run(mutation.childInvocationId, mutation.runId);
    return;
  }
  const value = mutation.kind === "claim" ? mutation.claim : mutation;
  const attribution = readModelAttribution(database, value.physicalId);
  if (!attribution || attribution.attributionSha256 !== value.attributionSha256)
    throw new Error("Model accounting native attribution differs");
  if (mutation.kind === "enter") {
    if (attribution.state !== "prepared") throw new Error("Model invocation was already entered or settled");
    database.prepare("UPDATE model_call_attributions SET state = 'dispatch_intent' WHERE physical_id = ?").run(value.physicalId);
  } else {
    const claim = mutation.claim;
    if (attribution.state === "settled" ||
        (JSON.parse(claim.receiptJson).terminal !== "undispatched" && attribution.state !== "dispatch_intent"))
      throw new Error("Final model receipt requires native dispatch intent");
    database.prepare("INSERT INTO model_usage_claims VALUES (?, ?, ?, ?, ?)")
      .run(claim.physicalId, claim.attributionSha256, claim.receiptSha256, claim.receiptJson, claim.eventId);
    database.prepare("UPDATE model_call_attributions SET state = 'settled' WHERE physical_id = ?").run(value.physicalId);
  }
}
