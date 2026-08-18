import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";

/**
 * A single browsable subdirectory of the requested path.
 */
export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
}

/**
 * The listing of one directory: its canonical `path`, the `parent` to walk up
 * to (null at a filesystem root, where there is nowhere higher to go), and the
 * immediate subdirectories a caller can descend into.
 */
export interface WorkspaceDirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
}

const MAX_DIRECTORY_PATH_LENGTH = 500;

class DirectoryListingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
  ) {
    super(message);
    this.name = "DirectoryListingError";
  }
}

/**
 * Canonicalize a browse target. Mirrors the resolve->realpath discipline used
 * by workspace rebind so a symlinked request lists its canonical target and the
 * returned paths stay stable for a subsequent rebind.
 */
async function resolveBrowseDirectory(raw: unknown): Promise<string> {
  if (typeof raw !== "string") {
    throw new DirectoryListingError("Directory path must be a string", 400);
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_DIRECTORY_PATH_LENGTH ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    throw new DirectoryListingError("Directory path is invalid", 400);
  }
  if (!path.isAbsolute(trimmed)) {
    throw new DirectoryListingError(
      "Directory path must be absolute",
      400,
    );
  }
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(trimmed));
  } catch {
    throw new DirectoryListingError("Directory does not exist", 404);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new DirectoryListingError("Path is not a directory", 400);
  }
  return resolved;
}

async function readSubdirectories(
  directory: string,
): Promise<WorkspaceDirectoryEntry[]> {
  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new DirectoryListingError("Directory is not readable", 403);
    }
    throw error;
  }
  const entries: WorkspaceDirectoryEntry[] = [];
  for (const dirent of dirents) {
    // Subdirectories only, and hide dotfolders by default: the picker is a
    // workspace chooser, not a full file browser.
    if (dirent.name.startsWith(".")) continue;
    if (!dirent.isDirectory()) continue;
    entries.push({
      name: dirent.name,
      path: path.join(directory, dirent.name),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export async function listWorkspaceDirectory(
  raw: unknown,
): Promise<WorkspaceDirectoryListing> {
  const directory = await resolveBrowseDirectory(raw);
  const entries = await readSubdirectories(directory);
  const parent = path.dirname(directory);
  return {
    path: directory,
    // At a filesystem root, dirname() returns the path itself; there is
    // nowhere higher to browse, so signal that with a null parent.
    parent: parent === directory ? null : parent,
    entries,
  };
}

/**
 * Register the folder-picker's directory browser.
 *
 * Security: this lists arbitrary directories on the host the runtime runs on.
 * That is the same trust boundary as the existing workspace rebind endpoint,
 * which already accepts any absolute path — Napier is a local-first,
 * single-user tool operating on the operator's own machine.
 */
export function registerWorkspaceDirectoriesHttp(app: Hono): void {
  app.get("/api/workspace/directories", async (context) => {
    let listing: WorkspaceDirectoryListing;
    try {
      listing = await listWorkspaceDirectory(context.req.query("path"));
    } catch (error) {
      if (error instanceof DirectoryListingError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, errorMessage(error), 500);
    }
    setBodyContentSha256Header(context, listing);
    return context.json(listing, 200);
  });
}
