import type {
  WorkspaceTrashList,
  WorkspaceTrashRestoreResult,
} from "@napier/contracts";

import { requestJson } from "./api-client";

export function listWorkspaceTrash(
  threadId: string,
  signal?: AbortSignal,
): Promise<WorkspaceTrashList> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/workspace-trash`,
    signal ? { signal } : undefined,
  );
}

export function restoreWorkspaceTrashItem(
  threadId: string,
  trashId: string,
  signal?: AbortSignal,
): Promise<WorkspaceTrashRestoreResult> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/workspace-trash/${encodeURIComponent(trashId)}/restore`,
    { method: "POST", ...(signal ? { signal } : {}) },
  );
}
