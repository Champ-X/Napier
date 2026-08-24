import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { listRecentWorkspaces, rebindWorkspaceRoot } from "./api";
import { NapierApiError } from "./api-error";
import { requestJson } from "./api-client";
import { listWorkspaceThreads } from "./workspace-tree-api";

export function getBootstrap(
  threadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
  return requestJson(`/api/bootstrap${query}`);
}

/** Resolve legacy thread-only deep links across isolated workspace stores. */
export async function getBootstrapRestoringWorkspace(
  threadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  try {
    return await getBootstrap(threadId);
  } catch (error) {
    if (!threadId || !(error instanceof NapierApiError) || error.status !== 404) {
      throw error;
    }
    const recent = await listRecentWorkspaces().catch(() => []);
    for (const workspace of recent) {
      const threads = await listWorkspaceThreads(workspace.root).catch(() => []);
      if (!threads.some((thread) => thread.id === threadId)) continue;
      await rebindWorkspaceRoot(workspace.root);
      return getBootstrap(threadId);
    }
    throw error;
  }
}
