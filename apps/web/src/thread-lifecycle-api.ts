import type { ThreadDetail } from "@napier/contracts";

import { requestJson } from "./api-client";

export function trashThread(threadId: string): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}

export function restoreThread(threadId: string): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/restore`, {
    method: "POST",
  });
}
