import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { listRecentWorkspaces, rebindWorkspaceRoot } from "./api";
import { NapierApiError } from "./api-error";
import { requestJson } from "./api-client";
import { listWorkspaceThreads } from "./workspace-tree-api";
import { explicitWorkspaceAddress, navigateWorkspace } from "./workspace-api-binding";

export function getBootstrap(
  threadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
  return requestJson(`/api/bootstrap${query}`);
}

let navigationRevision = 0;
export async function navigateWorkspaceRoot(root: string, threadId?: string): Promise<void> {
  const revision = ++navigationRevision;
  try {
    const workspace = await rebindWorkspaceRoot(root);
    if (revision !== navigationRevision) return;
    if (!workspace.workspaceId) throw new Error("工作区身份不可用，请更新本地服务后重试。");
    navigateWorkspace(workspace.workspaceId, threadId);
  } catch (error) {
    if (revision === navigationRevision) throw error;
  }
}

/** Resolve legacy thread-only deep links across isolated workspace stores. */
export async function getBootstrapRestoringWorkspace(
  threadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  try {
    return await getBootstrap(threadId);
  } catch (error) {
    if (explicitWorkspaceAddress || !threadId || !(error instanceof NapierApiError) || error.status !== 404) {
      throw error;
    }
    const recent = await listRecentWorkspaces().catch(() => []);
    const matches: string[] = [];
    for (const workspace of recent) {
      const threads = await listWorkspaceThreads(workspace.root).catch(() => []);
      if (threads.some((thread) => thread.id === threadId)) matches.push(workspace.root);
    }
    if (matches.length > 1) throw new Error("多个工作区包含此会话，请先选择工作区后打开。");
    if (matches[0]) {
      const opened = await rebindWorkspaceRoot(matches[0]);
      if (opened.workspaceId) {
        navigateWorkspace(opened.workspaceId, threadId);
        // The old document must not fetch the new thread with its old binding.
        return new Promise<never>(() => undefined);
      }
      return getBootstrap(threadId);
    }
    throw error;
  }
}
