import {
  createWorkspacePathSnapshot,
  type WorkspacePathSnapshot,
} from "./workspace-snapshot.js";

export const MAX_WORKSPACE_PROCESS_WRITE_SNAPSHOT_ENTRIES = 10_000;
export const MAX_WORKSPACE_PROCESS_WRITE_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export function createWorkspaceProcessWriteSnapshot(
  workspaceRoot: string,
): Promise<WorkspacePathSnapshot> {
  return createWorkspacePathSnapshot(workspaceRoot, workspaceRoot, {
    maxFiles: MAX_WORKSPACE_PROCESS_WRITE_SNAPSHOT_ENTRIES,
    maxBytes: MAX_WORKSPACE_PROCESS_WRITE_SNAPSHOT_BYTES,
    includeDirectories: true,
  });
}
