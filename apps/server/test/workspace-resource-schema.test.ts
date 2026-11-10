import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";
import { createResourceRecoveryTicket } from "../src/workspace-resource-receipts.js";

const workspaceId = `workspace_${"a".repeat(64)}`;
const directories: string[] = [];
const ledgers: WorkspaceResourceAdmission[] = [];
const states = ["reserved", "dispatching", "active", "quarantined", "released"];

afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function legacyLedger(scan: boolean) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "napier-resource-schema-"));
  directories.push(directory);
  const db = new DatabaseSync(path.join(directory, "execution-resources.sqlite"));
  db.exec(`CREATE TABLE resource_hosts(owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL,
      sandbox_execution INTEGER NOT NULL, browser_session INTEGER NOT NULL, browser_task INTEGER NOT NULL);
    CREATE TABLE execution_resources(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL, backend TEXT NOT NULL, state TEXT NOT NULL, identity_json TEXT, cleanup_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE resource_recovery_tickets(resource_id TEXT PRIMARY KEY, ticket_json TEXT NOT NULL,
      receipt_sha256 TEXT, recovered_at TEXT);`);
  if (scan) {
    db.exec(`CREATE TABLE resource_recovery_scan(singleton INTEGER PRIMARY KEY CHECK(singleton=1), after_resource_id TEXT NOT NULL);
      INSERT INTO resource_recovery_scan VALUES(1,'');`);
  }
  db.prepare("INSERT INTO resource_hosts VALUES(?,?,8,8,8)").run("legacy-owner", process.pid);
  for (const state of states) {
    const id = `legacy-${state}`;
    db.prepare("INSERT INTO execution_resources VALUES(?,?,?,'sandbox_execution','fixture',?,NULL,?,?,?)")
      .run(id, "legacy-owner", workspaceId, state,
        state === "released" ? JSON.stringify({ status: "released", scope: "sandbox_execution", reason: "legacy_cleanup" }) : null,
        "2026-10-29T00:00:00.000Z", "2026-10-29T00:00:00.000Z");
    db.prepare("INSERT INTO resource_recovery_tickets VALUES(?,?,?,?)").run(id, createResourceRecoveryTicket({
      leaseId: id, ownerId: "legacy-owner", ownerPid: process.pid, workspaceId, kind: "sandbox_execution", backend: "fixture",
    }), state === "released" ? "b".repeat(64) : null, state === "released" ? "2026-10-29T00:00:00.000Z" : null);
  }
  return { directory, db };
}

async function open(directory: string) {
  const ledger = await WorkspaceResourceAdmission.open(directory, { sandbox_execution: 8 });
  ledgers.push(ledger);
  return ledger;
}

describe("execution resource ledger upgrades", () => {
  it.each([false, true])("upgrades legacy tickets without losing ownership or receipt evidence (scan table: %s)", async (scan) => {
    const { directory, db } = await legacyLedger(scan);
    try {
      const resources = db.prepare("SELECT * FROM execution_resources ORDER BY id").all();
      const tickets = db.prepare("SELECT resource_id,ticket_json,receipt_sha256,recovered_at FROM resource_recovery_tickets ORDER BY resource_id").all();
      const ledger = await open(directory);
      expect(ledger.snapshot()[0]).toMatchObject({ occupied: 4, preparing: 2, active: 1, quarantined: 1 });
      expect(db.prepare("SELECT * FROM execution_resources ORDER BY id").all()).toEqual(resources);
      expect(db.prepare("SELECT resource_id,ticket_json,receipt_sha256,recovered_at FROM resource_recovery_tickets ORDER BY resource_id").all()).toEqual(tickets);
      expect(db.prepare("SELECT resource_id,pending FROM resource_recovery_tickets ORDER BY resource_id").all()).toEqual(
        states.map((state) => ({ resource_id: `legacy-${state}`, pending: state === "released" ? 0 : 1 }))
          .sort((left, right) => left.resource_id.localeCompare(right.resource_id)),
      );
      expect(db.prepare("SELECT revision FROM resource_recovery_scan").get()?.["revision"]).toEqual(expect.any(Number));
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='resource_recovery_pending'").get()).toBeDefined();
      // New leases must still work when ALTER TABLE appended pending after the
      // legacy receipt columns, and reopening must preserve migrated evidence.
      ledger.forWorkspace(workspaceId).reserve({ kind: "sandbox_execution", backend: "fixture" })
        .settle({ status: "not_started", scope: "sandbox_execution", reason: "schema_smoke" });
      const migrated = db.prepare("SELECT * FROM resource_recovery_tickets ORDER BY resource_id").all();
      ledger.close();
      expect((await open(directory)).snapshot()[0]?.occupied).toBe(4);
      expect(db.prepare("SELECT * FROM resource_recovery_tickets ORDER BY resource_id").all()).toEqual(migrated);
      expect(db.prepare("PRAGMA quick_check").get()?.["quick_check"]).toBe("ok");
    } finally { db.close(); }
  });

  it("rolls back an interrupted upgrade and can retry without dropping legacy data", async () => {
    const { directory, db } = await legacyLedger(false);
    try {
      const tickets = db.prepare("SELECT * FROM resource_recovery_tickets ORDER BY resource_id").all();
      db.exec(`CREATE TRIGGER reject_ticket_migration BEFORE UPDATE ON resource_recovery_tickets
        BEGIN SELECT RAISE(ABORT,'injected migration failure'); END;`);
      await expect(open(directory)).rejects.toThrow("injected migration failure");
      expect(db.prepare("PRAGMA table_info(resource_recovery_tickets)").all().some((column) => column["name"] === "pending")).toBe(false);
      expect(db.prepare("SELECT * FROM resource_recovery_tickets ORDER BY resource_id").all()).toEqual(tickets);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='resource_recovery_scan'").get()).toBeUndefined();
      db.exec("DROP TRIGGER reject_ticket_migration");
      expect((await open(directory)).snapshot()[0]?.occupied).toBe(4);
    } finally { db.close(); }
  });
});
