import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { validWorkspaceRuntimeId } from "./workspace-runtime-identity.js";
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

  private constructor(private readonly db: DatabaseSync, private readonly limits: WorkspaceResourceLimits) {}

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
    try {
      await initializeDatabase(db);
      const admission = new WorkspaceResourceAdmission(db, limits);
      admission.transaction(() => {
        admission.reconcileDeadOwners();
        db.prepare("INSERT INTO resource_hosts VALUES(?,?,?,?,?)").run(
          admission.ownerId, process.pid, limits.sandbox_execution, limits.browser_session, limits.browser_task);
      });
      return admission;
    } catch (error) { db.close(); throw error; }
  }

  forWorkspace(workspaceId: string): ResourceAdmission {
    if (!validWorkspaceRuntimeId(workspaceId)) throw new Error("Invalid resource admission workspace");
    return { reserve: (request) => this.reserve(workspaceId, request), drain: () => this.drainWorkspace(workspaceId) };
  }

  hasPending(workspaceId: string): boolean {
    return [...this.pending.values()].some((entry) => entry.workspaceId === workspaceId);
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
      this.db.prepare("UPDATE execution_resources SET state=?,cleanup_json=?,updated_at=? WHERE id=?")
        .run(evidence.status === "unknown" ? "quarantined" : "released", encoded, new Date().toISOString(), id);
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
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS resource_hosts(owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL,
          sandbox_execution INTEGER NOT NULL, browser_session INTEGER NOT NULL, browser_task INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS execution_resources(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL, backend TEXT NOT NULL, state TEXT NOT NULL, identity_json TEXT, cleanup_json TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS execution_resources_capacity ON execution_resources(kind,state);
        CREATE INDEX IF NOT EXISTS execution_resources_owner ON execution_resources(owner_id,state);`);
      return;
    } catch (error) {
      const code = (error as { errcode?: number }).errcode;
      if (code !== 5 || Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
}

function processMayBeAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
