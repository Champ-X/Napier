import { closeSync, lstatSync, openSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class WorkspaceLockCoordinationBusyError extends Error {}

/** Serialize small lock metadata operations across updated cooperating processes.
 * Never await inside this transaction or hold it for the protected file operation. */
export function coordinateWorkspaceLockMetadata<T>(dataRoot: string, operation: () => T): T {
  const root = realpathSync(dataRoot);
  const filename = path.join(root, "file-edit-locks.sqlite");
  try { closeSync(openSync(filename, "wx", 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const metadata = lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(filename) !== filename)
    throw new Error("Workspace lock coordinator must be a native regular file");
  const database = new DatabaseSync(filename);
  try {
    // Waiting here blocks this process's event loop and lease heartbeats. Let
    // the existing caller backpressure or deferred reinspection retry instead.
    database.exec("PRAGMA busy_timeout = 0");
    try { database.exec("BEGIN IMMEDIATE"); }
    catch (error) {
      const sqlite = error as { code?: unknown; errcode?: unknown };
      if (sqlite.code === "ERR_SQLITE_ERROR" && typeof sqlite.errcode === "number" &&
          [5, 6].includes(sqlite.errcode & 0xff))
        throw new WorkspaceLockCoordinationBusyError("Workspace lock coordinator is busy", { cause: error });
      throw error;
    }
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally { database.close(); }
}
