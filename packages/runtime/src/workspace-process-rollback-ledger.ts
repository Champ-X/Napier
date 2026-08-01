import type {
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import {
  WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT,
  WORKSPACE_PROCESS_ROLLED_BACK_EVENT,
  workspaceProcessRollbackAttemptPayload,
  workspaceProcessRollbackResultPayload,
} from "./workspace-process-rollback-events.js";

export function appendWorkspaceProcessRollbackAttempt(
  store: LocalStore,
  attempt: WorkspaceProcessRollbackAttempt,
): Promise<void> {
  return store
    .appendEvent({
      threadId: attempt.threadId,
      runId: attempt.runId,
      type: WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT,
      category: "tool",
      visibility: "user",
      payload: workspaceProcessRollbackAttemptPayload(attempt),
    })
    .then(() => undefined);
}

export function appendWorkspaceProcessRollbackResult(
  store: LocalStore,
  result: WorkspaceProcessRollbackResult,
): Promise<void> {
  return store
    .appendEvent({
      threadId: result.threadId,
      runId: result.runId,
      type: WORKSPACE_PROCESS_ROLLED_BACK_EVENT,
      category: "tool",
      visibility: "user",
      payload: workspaceProcessRollbackResultPayload(result),
    })
    .then(() => undefined);
}
