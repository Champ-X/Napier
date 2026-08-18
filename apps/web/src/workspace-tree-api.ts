import type { ThreadSummary } from "@napier/contracts";

import { requestJson } from "./api-client";

export function listWorkspaceThreads(root: string): Promise<ThreadSummary[]> {
  return requestJson(`/api/workspace/threads?root=${encodeURIComponent(root)}`);
}
