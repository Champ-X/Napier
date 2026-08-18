import { requestJson } from "./api-client";

/**
 * A single browsable subdirectory returned by the directory browser.
 */
export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
}

/**
 * The listing of one directory for the folder picker: its canonical `path`,
 * the `parent` to walk up to (null at a filesystem root), and the immediate
 * subdirectories to descend into. Mirrors the server-side shape in
 * apps/server/src/workspace-directories-http.ts.
 */
export interface WorkspaceDirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
}

export function listWorkspaceDirectories(
  path: string,
): Promise<WorkspaceDirectoryListing> {
  return requestJson(
    `/api/workspace/directories?path=${encodeURIComponent(path)}`,
  );
}
