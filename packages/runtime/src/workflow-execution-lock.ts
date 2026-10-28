import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

export function createWorkflowExecutionLockSchema(
  database: DatabaseSync,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workflow_execution_locks (
      thread_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      owner_pid INTEGER NOT NULL CHECK (owner_pid > 0)
    ) STRICT;
  `);
}

// A local process lock, not a TTL lease: a paused live driver must never lose
// ownership and later resume alongside its replacement. PID reuse blocks
// conservatively. SQLite serializes dead-owner replacement and token release.
export async function withWorkflowExecutionLock<T>(
  options: {
    databasePath: string;
    threadId: string;
    wait: boolean;
    signal?: AbortSignal;
  },
  execute: (reclaimed: boolean) => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  const database = new DatabaseSync(options.databasePath);
  const token = randomUUID();
  let acquired = false;
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    for (;;) {
      options.signal?.throwIfAborted();
      const claim = claimLock(database, options.threadId, token);
      if (claim !== undefined) {
        acquired = true;
        options.signal?.throwIfAborted();
        return await execute(claim);
      }
      if (!options.wait)
        throw new Error("Thread already has an active Workflow execution");
      await delay(25, undefined, { signal: options.signal });
    }
  } finally {
    try {
      if (acquired) {
        database
          .prepare(
            "DELETE FROM workflow_execution_locks WHERE thread_id = ? AND token = ?",
          )
          .run(options.threadId, token);
      }
    } finally {
      database.close();
    }
  }
}

function claimLock(
  database: DatabaseSync,
  threadId: string,
  token: string,
): boolean | undefined {
  database.exec("BEGIN IMMEDIATE");
  try {
    const owner = database
      .prepare(
        "SELECT owner_pid FROM workflow_execution_locks WHERE thread_id = ?",
      )
      .get(threadId) as { owner_pid: number } | undefined;
    if (owner && processAlive(owner.owner_pid)) {
      database.exec("COMMIT");
      return undefined;
    }
    database
      .prepare(
        `
      INSERT INTO workflow_execution_locks (thread_id, token, owner_pid)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET token = excluded.token,
        owner_pid = excluded.owner_pid
    `,
      )
      .run(threadId, token, process.pid);
    database.exec("COMMIT");
    return owner !== undefined;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only ESRCH proves the process is gone. Permission and unexpected errors
    // cannot authorize another driver.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
