import type {
  WorkspaceProcessDelta,
  WorkspaceProcessOutput,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { requestJson } from "./api-client";

export function listWorkspaceProcesses(
  threadId: string,
): Promise<WorkspaceProcessSession[]> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/processes`);
}

export function getWorkspaceProcessOutput(
  threadId: string,
  processId: string,
  afterCursor: number,
  waitMs = 0,
): Promise<WorkspaceProcessOutput> {
  const query = new URLSearchParams({
    after: String(afterCursor),
    wait: String(waitMs),
  });
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/output?${query.toString()}`,
  );
}

export function cancelWorkspaceProcess(
  threadId: string,
  processId: string,
): Promise<WorkspaceProcessSession> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/cancel`,
    { method: "POST" },
  );
}

export function getWorkspaceProcessDelta(
  threadId: string,
  processId: string,
): Promise<WorkspaceProcessDelta> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/delta`,
  );
}
