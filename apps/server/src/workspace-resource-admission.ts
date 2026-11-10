import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { validWorkspaceRuntimeId } from "./workspace-runtime-identity.js";
import { processMayBeAlive, WorkspaceResourceRecovery } from "./workspace-resource-recovery.js";
import {
  RESOURCE_KINDS, encodeResourceCleanup, encodeResourceIdentity,
  validateResourceRequest, workspaceResourceLimits,
  type ResourceAdmission, type ResourceCleanup, type ResourceIdentity,
  type ResourceKind, type ResourceLease, type ResourceRequest, type WorkspaceResourceLimits,
} from "./workspace-resource-policy.js";

class WorkspaceResourceAdmissionError extends Error {
  constructor(readonly code: "capacity" | "accounting" | "cleanup" | "closed" | "transition", options?: ErrorOptions) {
    super(`Workspace execution resource admission: ${code}`, options);
    this.name = "WorkspaceResourceAdmissionError";
  }
}
interface ResourceRow {
  kind: ResourceKind;
  state: "reserved" | "dispatching" | "active" | "quarantined" | "released";
  identity_json: string | null;
  cleanup_json: string | null;
}
interface Pending {
  workspaceId: string;
  promise: Promise<void>;
  done(): void;
  fail(error: Error): void;
}

/** Shared durable ownership. Owner death is never proof of post-dispatch cleanup. */
export class WorkspaceResourceAdmission {
  private readonly ownerId = randomUUID();
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  private constructor(private readonly db: DatabaseSync, private readonly limits: WorkspaceResourceLimits,
    private readonly recovery: WorkspaceResourceRecovery) {}

  static async open(stateHome: string, options: Partial<WorkspaceResourceLimits> = {}): Promise<WorkspaceResourceAdmission> {
    const limits = workspaceResourceLimits(options);
    await mkdir(stateHome, { recursive: true, mode: 0o700 });
    const filename = path.join(stateHome, "execution-resources.sqlite");
    const file = await open(filename, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return undefined;
    });
    await file?.close();
    if (!(await lstat(filename)).isFile()) throw new Error("Invalid execution resource ledger file");
    const db = new DatabaseSync(filename);
    let recovery: WorkspaceResourceRecovery | undefined;
    let admission: WorkspaceResourceAdmission | undefined;
    try {
      await initializeDatabase(db);
      recovery = new WorkspaceResourceRecovery(db, stateHome);
      admission = new WorkspaceResourceAdmission(db, limits, recovery);
      const opened = admission;
      admission.transaction(() => {
        opened.reconcileDeadOwners();
        db.prepare("INSERT INTO resource_hosts VALUES(?,?,?,?,?)").run(
          opened.ownerId, process.pid, limits.sandbox_execution, limits.browser_session, limits.browser_task);
      });
      await recovery.reconcileStartup();
      return admission;
    } catch (error) {
      // Open has admitted no resources yet. Do not leave a live registration if
      // receipt ingestion fails after registration committed.
      try { if (admission) db.prepare("DELETE FROM resource_hosts WHERE owner_id=?").run(admission.ownerId); }
      finally { recovery?.close(); db.close(); }
      throw error;
    }
  }

  forWorkspace(workspaceId: string): ResourceAdmission {
    if (!validWorkspaceRuntimeId(workspaceId)) throw new Error("Invalid resource admission workspace");
    return { reserve: (request) => this.reserve(workspaceId, request), drain: () => this.drainWorkspace(workspaceId) };
  }

  hasPending(workspaceId: string): boolean {
    return [...this.pending.values()].some((entry) => entry.workspaceId === workspaceId);
  }

  /** Bounded, retryable receipt ingestion; live/unknown owners keep their slots. */
  reconcileCompletedReceipts() {
    this.assertOpen();
    return this.recovery.reconcile();
  }

  async drainWorkspace(workspaceId: string): Promise<void> {
    while (this.hasPending(workspaceId)) {
      await Promise.all([...this.pending.values()].filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.promise));
    }
  }

  snapshot() {
    this.assertOpen();
    return this.transaction(() => {
      this.reconcileDeadOwners();
      return RESOURCE_KINDS.map((kind) => ({
        kind, configuredCapacity: this.limits[kind], effectiveCapacity: this.maximum(kind),
        occupied: this.count(kind, "state!='released'"),
        preparing: this.count(kind, "state IN ('reserved','dispatching')"),
        active: this.count(kind, "state='active'"),
        quarantined: this.count(kind, "state='quarantined'"),
      }));
    });
  }

  close(): void {
    if (this.closed) return;
    if (this.pending.size) throw new WorkspaceResourceAdmissionError("cleanup");
    this.db.prepare("DELETE FROM resource_hosts WHERE owner_id=?").run(this.ownerId);
    this.db.close();
    this.recovery.close();
    this.closed = true;
  }

  private reserve(workspaceId: string, request: ResourceRequest): ResourceLease {
    this.assertOpen();
    validateResourceRequest(request);
    const { kind, backend } = request;
    const id = randomUUID();
    this.transaction(() => {
      this.reconcileDeadOwners();
      if (this.count(kind, "state!='released'") >= this.maximum(kind)) throw new WorkspaceResourceAdmissionError("capacity");
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO execution_resources VALUES(?,?,?,?,?,'reserved',NULL,NULL,?,?)")
        .run(id, this.ownerId, workspaceId, kind, backend, now, now);
      this.recovery.reserve({ leaseId: id, ownerId: this.ownerId, ownerPid: process.pid, workspaceId, kind, backend });
    });
    let done!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
    void promise.catch(() => undefined);
    this.pending.set(id, { workspaceId, promise, done, fail });
    return {
      id,
      dispatched: () => this.dispatched(id),
      bind: (identity) => this.bind(id, identity),
      settle: (evidence) => this.settle(id, kind, evidence),
    };
  }

  private dispatched(id: string): void {
    this.mutate(id, () => {
      const row = this.row(id);
      if (row.state === "dispatching" || row.state === "active") return;
      if (row.state !== "reserved") throw new WorkspaceResourceAdmissionError("transition");
      this.db.prepare("UPDATE execution_resources SET state='dispatching',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id);
    });
  }

  private bind(id: string, identity: ResourceIdentity): void {
    this.mutate(id, () => {
      const encoded = encodeResourceIdentity(identity);
      const row = this.row(id);
      if (row.state === "reserved" || row.state === "released") throw new WorkspaceResourceAdmissionError("transition");
      if (row.identity_json !== null) {
        if (row.identity_json !== encoded) throw new WorkspaceResourceAdmissionError("transition");
        return;
      }
      const next = row.state === "quarantined" ? "quarantined" : "active";
      this.db.prepare("UPDATE execution_resources SET state=?,identity_json=?,updated_at=? WHERE id=?")
        .run(next, encoded, new Date().toISOString(), id);
    });
  }

  private settle(id: string, kind: ResourceKind, evidence: ResourceCleanup): void {
    this.mutate(id, () => {
      const encoded = encodeResourceCleanup(evidence, kind);
      const row = this.row(id);
      if (row.cleanup_json === encoded) return;
      if (row.state === "released" || (row.state === "reserved" && evidence.status === "released")) {
        throw new WorkspaceResourceAdmissionError("transition");
      }
      // All current owners call settle only after their complete cleanup scope.
      // Persist that fact before the SQLite update, so a crash cannot erase it.
      const receiptSha256 = evidence.status !== "unknown" ? this.recovery.publish(id, row.identity_json, encoded) : null;
      this.db.prepare("UPDATE execution_resources SET state=?,cleanup_json=?,updated_at=? WHERE id=?")
        .run(evidence.status === "unknown" ? "quarantined" : "released", encoded, new Date().toISOString(), id);
      if (evidence.status !== "unknown") this.recovery.accept(id, receiptSha256);
    });
    if (evidence.status === "unknown") {
      this.pending.get(id)?.fail(new WorkspaceResourceAdmissionError("cleanup"));
    } else {
      this.pending.get(id)?.done();
      this.pending.delete(id);
    }
  }

  private mutate(id: string, operation: () => void): void {
    this.assertOpen();
    try { this.transaction(operation); }
    catch (error) {
      this.pending.get(id)?.fail(new WorkspaceResourceAdmissionError("accounting", { cause: error }));
      throw error;
    }
  }

  private row(id: string): ResourceRow {
    const row = this.db.prepare("SELECT kind,state,identity_json,cleanup_json FROM execution_resources WHERE id=? AND owner_id=?")
      .get(id, this.ownerId) as unknown as ResourceRow | undefined;
    if (!row) throw new WorkspaceResourceAdmissionError("transition");
    return row;
  }

  private count(kind: ResourceKind, predicate: string): number {
    return Number(this.db.prepare(`SELECT count(*) AS amount FROM execution_resources WHERE kind=? AND ${predicate}`).get(kind)!["amount"]);
  }

  private maximum(kind: ResourceKind): number {
    // kind is a validated closed union, never request SQL.
    const amount = Number(this.db.prepare(`SELECT min(${kind}) AS amount FROM resource_hosts`).get()!["amount"]);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new WorkspaceResourceAdmissionError("accounting");
    return amount;
  }

  private reconcileDeadOwners(): void {
    const owners = this.db.prepare("SELECT owner_id,pid FROM resource_hosts").all();
    for (const owner of owners) {
      if (processMayBeAlive(Number(owner["pid"]))) continue;
      const ownerId = String(owner["owner_id"]);
      const rows = this.db.prepare("SELECT id,kind,state FROM execution_resources WHERE owner_id=? AND state IN ('reserved','dispatching','active')").all(ownerId);
      for (const row of rows) {
        const beforeDispatch = row["state"] === "reserved";
        const cleanup = encodeResourceCleanup({
          status: beforeDispatch ? "not_started" : "unknown", scope: row["kind"] as ResourceKind,
          reason: beforeDispatch ? "owner_lost_before_dispatch" : "owner_lost_after_dispatch",
        }, row["kind"] as ResourceKind);
        this.db.prepare("UPDATE execution_resources SET state=?,cleanup_json=?,updated_at=? WHERE id=?")
          .run(beforeDispatch ? "released" : "quarantined", cleanup, new Date().toISOString(), String(row["id"]));
        if (beforeDispatch) this.recovery.accept(String(row["id"]));
      }
      this.db.prepare("DELETE FROM resource_hosts WHERE owner_id=?").run(ownerId);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new WorkspaceResourceAdmissionError("closed");
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

async function initializeDatabase(db: DatabaseSync): Promise<void> {
  const deadline = Date.now() + 5_000;
  db.exec("PRAGMA busy_timeout=2500");
  for (;;) {
    try {
      // Concurrent first open can fail the journal-mode upgrade without invoking
      // SQLite's busy handler. Only this idempotent schema setup is retried.
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      // Serialize schema inspection and migration across hosts. CREATE TABLE
      // IF NOT EXISTS alone cannot upgrade a ledger from an older checkout.
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`
        CREATE TABLE IF NOT EXISTS resource_hosts(owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL,
          sandbox_execution INTEGER NOT NULL, browser_session INTEGER NOT NULL, browser_task INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS execution_resources(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL, backend TEXT NOT NULL, state TEXT NOT NULL, identity_json TEXT, cleanup_json TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS execution_resources_capacity ON execution_resources(kind,state);
        CREATE INDEX IF NOT EXISTS execution_resources_owner ON execution_resources(owner_id,state);
        CREATE TABLE IF NOT EXISTS resource_recovery_tickets(resource_id TEXT PRIMARY KEY, ticket_json TEXT NOT NULL,
          pending INTEGER NOT NULL DEFAULT 1, receipt_sha256 TEXT, recovered_at TEXT);
        CREATE TABLE IF NOT EXISTS resource_recovery_scan(singleton INTEGER PRIMARY KEY CHECK(singleton=1), after_resource_id TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0);`);
        const ticketColumns = db.prepare("PRAGMA table_info(resource_recovery_tickets)").all();
        if (!ticketColumns.some((column) => column["name"] === "pending")) {
          db.exec(`ALTER TABLE resource_recovery_tickets ADD COLUMN pending INTEGER NOT NULL DEFAULT 1;
            UPDATE resource_recovery_tickets SET pending=0 WHERE resource_id IN
              (SELECT id FROM execution_resources WHERE state='released');`);
        }
        const scanColumns = db.prepare("PRAGMA table_info(resource_recovery_scan)").all();
        if (!scanColumns.some((column) => column["name"] === "revision")) {
          db.exec("ALTER TABLE resource_recovery_scan ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
        }
        db.exec(`CREATE INDEX IF NOT EXISTS resource_recovery_pending ON resource_recovery_tickets(resource_id) WHERE pending=1;
          INSERT OR IGNORE INTO resource_recovery_scan(singleton,after_resource_id) VALUES(1,'');
          COMMIT;`);
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return;
    } catch (error) {
      const code = (error as { errcode?: number }).errcode;
      if (code !== 5 || Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
}
