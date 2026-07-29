import type { WorkspaceTrashItem } from "@napier/contracts";

export interface WorkspaceTrashCardView {
  id: string;
  originalPath: string;
  kindLabel: string;
  scopeLabel: string;
  trashedAt: string;
  snapshotHash: string;
}

export interface WorkspaceFileRequestToken {
  threadId: string;
  sequence: number;
}

export function workspaceFileRequestIsCurrent(
  token: WorkspaceFileRequestToken,
  activeThreadId: string,
  activeSequence: number,
): boolean {
  return token.threadId === activeThreadId && token.sequence === activeSequence;
}

export function workspaceTrashCardView(
  item: WorkspaceTrashItem,
): WorkspaceTrashCardView {
  return {
    id: item.id,
    originalPath: item.originalPath,
    kindLabel: item.entryKind === "file" ? "File" : "Directory",
    scopeLabel: `${item.fileCount.toLocaleString()} files · ${item.directoryCount.toLocaleString()} directories · ${item.bytes.toLocaleString()} bytes`,
    trashedAt: item.trashedAt,
    snapshotHash: item.snapshotSha256.slice(0, 12),
  };
}
