import type { ThreadDetail, ThreadRecord } from "@napier/contracts";

import { requestJson } from "./api-client";

export function trashThread(threadId: string): Promise<ThreadRecord> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export function restoreThread(threadId: string): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/restore`, {
    method: "POST",
  });
}
