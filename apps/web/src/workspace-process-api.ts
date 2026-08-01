import type {
  WorkspaceProcessDelta,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutput,
  WorkspaceProcessRollbackPreview,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { requestJson } from "./api-client";

export function listWorkspaceProcesses(
  threadId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProcessSession[]> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes`,
    signal ? { signal } : undefined,
  );
}

export function getWorkspaceProcessOutput(
  threadId: string,
  processId: string,
  afterCursor: number,
  waitMs = 0,
  signal?: AbortSignal,
): Promise<WorkspaceProcessOutput> {
  const query = new URLSearchParams({
    after: String(afterCursor),
    wait: String(waitMs),
  });
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/output?${query.toString()}`,
    signal ? { signal } : undefined,
  );
}

export function cancelWorkspaceProcess(
  threadId: string,
  processId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProcessSession> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/cancel`,
    { method: "POST", ...(signal ? { signal } : {}) },
  );
}

export function sendWorkspaceProcessInput(
  threadId: string,
  processId: string,
  input: { text: string; appendNewline?: boolean; close?: boolean },
  signal?: AbortSignal,
): Promise<WorkspaceProcessInputReceipt> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/input`,
    {
      method: "POST",
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    },
  );
}

export function getWorkspaceProcessDelta(
  threadId: string,
  processId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProcessDelta> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/delta`,
    signal ? { signal } : undefined,
  );
}

export function previewWorkspaceProcessRollback(
  threadId: string,
  processId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProcessRollbackPreview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/rollback/preview`,
    { method: "POST", ...(signal ? { signal } : {}) },
  );
}

export function applyWorkspaceProcessRollback(
  threadId: string,
  processId: string,
  previewId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProcessRollbackResult> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/processes/${encodeURIComponent(processId)}/rollback`,
    {
      method: "POST",
      body: JSON.stringify({ previewId }),
      ...(signal ? { signal } : {}),
    },
  );
}
