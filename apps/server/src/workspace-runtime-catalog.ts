import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  workspaceRuntimeId,
  type WorkspaceRuntimeIdentity,
} from "./workspace-runtime-identity.js";

interface IdentityRow { workspace_id: string; root: string; data_root: string }
interface OwnerRow { owner_id: string; pid: number }

/** Machine-local index, separate from each workspace's ledger and recent UI list. */
export class WorkspaceRuntimeCatalog {
  private readonly ownerId = randomUUID();

  private constructor(private readonly database: DatabaseSync) {}

  static async open(stateHome: string): Promise<WorkspaceRuntimeCatalog> {
    await mkdir(stateHome, { recursive: true, mode: 0o700 });
    const target = path.join(stateHome, "workspace-runtimes.sqlite");
    const file = await open(target, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return undefined;
    });
    await file?.close();
    if (!(await lstat(target)).isFile()) throw new Error("Invalid workspace catalog file");
    const database = new DatabaseSync(target);
    try {
      database.exec(`
        PRAGMA busy_timeout = 2500;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS workspace_runtimes (
          workspace_id TEXT PRIMARY KEY,
          root TEXT NOT NULL UNIQUE,
          data_root TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS workspace_runtime_owners (
          workspace_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          pid INTEGER NOT NULL
        );
      `);
      return new WorkspaceRuntimeCatalog(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  list(): WorkspaceRuntimeIdentity[] {
    return (this.database.prepare(
      "SELECT workspace_id, root, data_root FROM workspace_runtimes ORDER BY rowid",
    ).all() as unknown as IdentityRow[]).map(decodeIdentity);
  }

  get(workspaceId: string): WorkspaceRuntimeIdentity {
    const row = this.database.prepare(
      "SELECT workspace_id, root, data_root FROM workspace_runtimes WHERE workspace_id = ?",
    ).get(workspaceId) as unknown as IdentityRow | undefined;
    if (!row) throw new Error("Unknown workspace runtime");
    return decodeIdentity(row);
  }

  findRoot(root: string): WorkspaceRuntimeIdentity | undefined {
    const row = this.database.prepare(
      "SELECT workspace_id, root, data_root FROM workspace_runtimes WHERE root = ?",
    ).get(root) as unknown as IdentityRow | undefined;
    return row ? decodeIdentity(row) : undefined;
  }

  register(identity: WorkspaceRuntimeIdentity): WorkspaceRuntimeIdentity {
    decodeIdentity({ workspace_id: identity.workspaceId, root: identity.root, data_root: identity.dataRoot });
    return this.transaction(() => {
      const existing = this.findRoot(identity.root);
      if (existing) {
        if (existing.workspaceId !== identity.workspaceId) {
          throw new Error("Workspace is already registered with a different data root");
        }
        return existing;
      }
      if (this.list().length >= 256) throw new Error("Workspace catalog capacity reached");
      this.database.prepare(
        "INSERT INTO workspace_runtimes (workspace_id, root, data_root) VALUES (?, ?, ?)",
      ).run(identity.workspaceId, identity.root, identity.dataRoot);
      return { ...identity };
    });
  }

  /** Never initialize a ledger that another live server owns. PID reuse fails closed. */
  claim(workspaceId: string): void {
    this.transaction(() => {
      this.get(workspaceId);
      const owner = this.database.prepare(
        "SELECT owner_id, pid FROM workspace_runtime_owners WHERE workspace_id = ?",
      ).get(workspaceId) as unknown as OwnerRow | undefined;
      if (owner && processMayBeAlive(owner.pid)) {
        throw new Error("Workspace runtime is already owned by a live server");
      }
      this.database.prepare(
        "INSERT OR REPLACE INTO workspace_runtime_owners (workspace_id, owner_id, pid) VALUES (?, ?, ?)",
      ).run(workspaceId, this.ownerId, process.pid);
    });
  }

  release(workspaceId: string): void {
    this.database.prepare(
      "DELETE FROM workspace_runtime_owners WHERE workspace_id = ? AND owner_id = ?",
    ).run(workspaceId, this.ownerId);
  }

  close(): void {
    // Closing the DB does not release runtime ownership. The graph must be
    // disposed first; otherwise another server could interrupt still-live work.
    this.database.close();
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function decodeIdentity(row: IdentityRow): WorkspaceRuntimeIdentity {
  if (!path.isAbsolute(row.root) || !path.isAbsolute(row.data_root) ||
      workspaceRuntimeId(row.root, row.data_root) !== row.workspace_id) {
    throw new Error("Workspace catalog identity is invalid");
  }
  return { workspaceId: row.workspace_id, root: row.root, dataRoot: row.data_root };
}

function processMayBeAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
