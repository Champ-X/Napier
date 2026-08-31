import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { LocalStore } from "@napier/runtime/store";

export class WorkspaceRebindRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "WorkspaceRebindRequestError";
  }
}

export class WorkspaceRebindBusyError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Workspace is busy: ${reasons.join("; ")}`);
    this.name = "WorkspaceRebindBusyError";
  }
}

type WorkspaceRebindBusyStore = Pick<LocalStore, "listThreads" | "listRuns">;

/**
 * A rebind pauses the current runtime before activating another workspace, so
 * it must refuse while any Run is still in flight. Run-scoped sessions
 * (workspace processes, browser, LSP leases) are released when their owning Run
 * settles, so a persisted queued/running scan is the authoritative busy signal.
 */
export function workspaceRebindBusyReasons(
  store: WorkspaceRebindBusyStore,
): string[] {
  const reasons: string[] = [];
  for (const thread of store.listThreads()) {
    const active = store
      .listRuns(thread.id)
      .filter((run) => run.status === "queued" || run.status === "running");
    if (active.length > 0) {
      reasons.push(
        `thread ${thread.id} has ${active.length} active run(s)`,
      );
    }
  }
  return reasons;
}

/**
 * Canonicalize a requested workspace root. Mirrors the resolve->realpath
 * discipline used for other host paths so a symlinked request binds to its
 * canonical target and later isPathInsideWorkspace checks stay consistent.
 */
export async function resolveRebindWorkspaceRoot(
  rawRoot: unknown,
): Promise<string> {
  if (typeof rawRoot !== "string") {
    throw new WorkspaceRebindRequestError(
      "Workspace root must be a string",
      400,
    );
  }
  if (
    rawRoot.trim().length === 0 ||
    rawRoot.length > 500 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/u.test(rawRoot)
  ) {
    throw new WorkspaceRebindRequestError(
      "Workspace root is invalid",
      400,
    );
  }
  if (!path.isAbsolute(rawRoot)) {
    throw new WorkspaceRebindRequestError(
      "Workspace root must be an absolute path",
      400,
    );
  }
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(rawRoot));
  } catch {
    throw new WorkspaceRebindRequestError(
      "Workspace folder does not exist",
      404,
    );
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new WorkspaceRebindRequestError(
      "Workspace root must be a directory",
      400,
    );
  }
  return resolved;
}
