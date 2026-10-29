import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { RESOURCE_KINDS } from "./workspace-resource-policy.js";
import {
  createResourceRecoveryTicket, parseResourceRecoveryTicket, WorkspaceResourceReceipts,
  type ResourceRecoveryTicket,
} from "./workspace-resource-receipts.js";

interface RecoveryRow {
  id: string;
  owner_id: string;
  workspace_id: string;
  kind: string;
  backend: string;
  state: string;
  identity_json: string | null;
  cleanup_json: string | null;
  ticket_json: string;
}
const CANDIDATES = `SELECT r.*,t.ticket_json FROM resource_recovery_tickets t
  JOIN execution_resources r ON r.id=t.resource_id
  WHERE t.pending=1 AND r.state IN ('dispatching','active','quarantined')`;
const PAGE_SIZE = 128;
// Valid admission permits at most 256 outstanding resources of each kind.
const STARTUP_LIMIT = RESOURCE_KINDS.length * 256;
interface ScanProgress { after_resource_id: string; revision: number }

/** Replays only durable complete evidence. It never probes or kills a backend. */
export class WorkspaceResourceRecovery {
  private readonly receipts: WorkspaceResourceReceipts;

  constructor(private readonly db: DatabaseSync, stateHome: string) {
    this.receipts = new WorkspaceResourceReceipts(stateHome);
  }
  close(): void { this.receipts.close(); }

  reserve(input: Omit<ResourceRecoveryTicket, "schemaVersion" | "protocol" | "nonce" | "receiptName">): void {
    this.db.prepare("INSERT INTO resource_recovery_tickets(resource_id,ticket_json) VALUES(?,?)")
      .run(input.leaseId, createResourceRecoveryTicket(input));
  }

  publish(id: string, identityJson: string | null, cleanupJson: string): string {
    const ticket = this.db.prepare("SELECT ticket_json FROM resource_recovery_tickets WHERE resource_id=?").get(id);
    if (!ticket) throw new Error("Resource recovery ticket is missing");
    return this.receipts.publish(String(ticket["ticket_json"]), identityJson, cleanupJson);
  }

  /** Called within the same transaction that releases capacity. */
  accept(id: string, receiptSha256: string | null = null): void {
    this.db.prepare("UPDATE resource_recovery_tickets SET pending=0,receipt_sha256=? WHERE resource_id=?")
      .run(receiptSha256, id);
  }

  async reconcileStartup(): Promise<void> {
    // Freeze the initial cohort, so concurrent inserts cannot move the end of
    // this sweep. Oversized/corrupt ledgers retain the remainder for explicit
    // bounded reconciliation; startup never becomes an unbounded worker.
    const progress = this.progress();
    const rows = this.db.prepare(`${CANDIDATES} ORDER BY t.resource_id LIMIT ?`)
      .all(STARTUP_LIMIT + 1) as unknown as RecoveryRow[];
    const cohort = rows.slice(0, STARTUP_LIMIT);
    for (let offset = 0; offset < cohort.length; offset += PAGE_SIZE) {
      const page = cohort.slice(offset, offset + PAGE_SIZE);
      this.releaseCompleted(page);
      const more = offset + page.length < rows.length;
      this.advance(progress, more ? page.at(-1)!.id : "");
      if (offset + page.length < cohort.length) await yieldTurn();
    }
    if (!cohort.length) this.advance(progress, "");
  }

  reconcile(): { examined: number; released: number; skipped: number; hasMore: boolean } {
    const progress = this.progress();
    const rows = this.db.prepare(`${CANDIDATES} AND t.resource_id>? ORDER BY t.resource_id LIMIT ?`).all(progress.after_resource_id, PAGE_SIZE + 1) as unknown as RecoveryRow[];
    const page = rows.slice(0, PAGE_SIZE);
    const released = this.releaseCompleted(page);
    const hasMore = rows.length > PAGE_SIZE;
    this.advance(progress, hasMore ? page.at(-1)!.id : "");
    return { examined: page.length, released, skipped: page.length - released, hasMore };
  }

  private releaseCompleted(rows: RecoveryRow[]): number {
    let released = 0;
    for (const row of rows) {
      const ticket = this.ticket(row);
      if (!ticket || processMayBeAlive(ticket.ownerPid)) continue;
      const receipt = this.receipts.verify(row.ticket_json, row.identity_json);
      if (!receipt) continue;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.db.prepare(`${CANDIDATES} AND r.id=?`).get(row.id) as unknown as RecoveryRow | undefined;
        const owner = this.db.prepare("SELECT pid FROM resource_hosts WHERE owner_id=?").get(row.owner_id);
        if (current && current.ticket_json === row.ticket_json && current.identity_json === row.identity_json &&
            this.ticket(current) && (!owner || owner["pid"] === ticket.ownerPid) && !processMayBeAlive(ticket.ownerPid)) {
          const result = this.db.prepare(`UPDATE execution_resources SET state='released',cleanup_json=?,updated_at=?
            WHERE id=? AND owner_id=? AND state=? AND identity_json IS ? AND cleanup_json IS ?`)
            .run(receipt.cleanupJson, new Date().toISOString(), row.id, row.owner_id, current.state, current.identity_json, current.cleanup_json);
          if (result.changes === 1) {
            this.db.prepare("UPDATE resource_recovery_tickets SET pending=0,receipt_sha256=?,recovered_at=? WHERE resource_id=? AND pending=1")
              .run(receipt.receiptSha256, new Date().toISOString(), row.id);
            released += 1;
          }
        }
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    return released;
  }

  private progress(): ScanProgress {
    return this.db.prepare("SELECT after_resource_id,revision FROM resource_recovery_scan WHERE singleton=1").get() as unknown as ScanProgress;
  }

  private advance(progress: ScanProgress, next: string): void {
    // Persist progress even when every examined receipt is missing or malformed.
    // A concurrent sweep cannot rewind a cursor that another host has advanced.
    if (next !== "" && next <= progress.after_resource_id) return;
    const result = this.db.prepare("UPDATE resource_recovery_scan SET after_resource_id=?,revision=revision+1 WHERE singleton=1 AND revision=? AND after_resource_id=?")
      .run(next, progress.revision, progress.after_resource_id);
    if (result.changes === 1) { progress.after_resource_id = next; progress.revision += 1; }
  }

  private ticket(row: RecoveryRow): ResourceRecoveryTicket | undefined {
    const ticket = parseResourceRecoveryTicket(row.ticket_json);
    return ticket && ticket.leaseId === row.id && ticket.ownerId === row.owner_id &&
      ticket.workspaceId === row.workspace_id && ticket.kind === row.kind && ticket.backend === row.backend ? ticket : undefined;
  }
}

/** PID reuse, EPERM and unsupported observation retain ownership. No signal other
 * than the read-only existence probe is used; ESRCH is the only death evidence. */
export function processMayBeAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
