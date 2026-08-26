import type {
  RunEvent,
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import {
  applyWorkspaceProcessInputReceipt,
  createWorkspaceProcessSession,
  parseWorkspaceProcessInputReceipt,
  parseWorkspaceProcessSession,
} from "./workspace-process-event-parsing.js";
import { EMPTY_SHA256 } from "./workspace-process-session-validation.js";
import {
  applyWorkspaceProcessResizeReceipt,
  parseWorkspaceProcessResizeReceipt,
} from "./workspace-process-resize-events.js";
import { projectWorkspaceProcessRollbackHistory } from "./workspace-process-rollback-events.js";
export type { WorkspaceProcessSessionInput } from "./workspace-process-event-model.js";
export {
  createWorkspaceProcessInputReceipt,
  createWorkspaceProcessSession,
  parseWorkspaceProcessInputReceipt,
  workspaceProcessInputReceiptPayload,
  workspaceProcessSessionPayload,
  workspaceProcessStableSessionInput,
} from "./workspace-process-event-parsing.js";
export {
  parseWorkspaceProcessRollbackAttempt,
  parseWorkspaceProcessRollbackResult,
  WORKSPACE_PROCESS_ROLLBACK_STARTED_EVENT,
  WORKSPACE_PROCESS_ROLLED_BACK_EVENT,
  workspaceProcessRollbackAttemptPayload,
  workspaceProcessRollbackResultPayload,
} from "./workspace-process-rollback-events.js";
export { workspaceProcessSessionWithRuntimeState } from "./workspace-process-runtime-session.js";

export const WORKSPACE_PROCESS_STARTED_EVENT = "workspace.process.started";
export const WORKSPACE_PROCESS_INPUT_EVENT = "workspace.process.input";
export const WORKSPACE_PROCESS_RESIZED_EVENT = "workspace.process.resized";
export const WORKSPACE_PROCESS_SETTLED_EVENT = "workspace.process.settled";
export const WORKSPACE_PROCESS_INTERRUPTED_EVENT =
  "workspace.process.interrupted";
export type WorkspaceProcessSessionEventType =
  | typeof WORKSPACE_PROCESS_INTERRUPTED_EVENT
  | typeof WORKSPACE_PROCESS_SETTLED_EVENT
  | typeof WORKSPACE_PROCESS_STARTED_EVENT;

export function projectWorkspaceProcessSessions(
  events: RunEvent[],
): WorkspaceProcessSession[] {
  const sessions = new Map<string, WorkspaceProcessSession>();
  for (const event of events
    .slice()
    .sort((left, right) => left.seq - right.seq)) {
    if (event.type === WORKSPACE_PROCESS_INPUT_EVENT) {
      const receipt = parseWorkspaceProcessInputReceipt(event.payload);
      const current = receipt ? sessions.get(receipt.processId) : undefined;
      const updated =
        receipt && current
          ? applyWorkspaceProcessInputReceipt(current, receipt)
          : undefined;
      if (
        updated &&
        receipt &&
        receipt.threadId === event.threadId &&
        receipt.runId === event.runId
      ) {
        sessions.set(updated.id, updated);
      }
      continue;
    }
    if (event.type === WORKSPACE_PROCESS_RESIZED_EVENT) {
      const receipt = parseWorkspaceProcessResizeReceipt(event.payload);
      const current = receipt ? sessions.get(receipt.processId) : undefined;
      const updated =
        receipt && current
          ? applyWorkspaceProcessResizeReceipt(
              current,
              receipt,
              createWorkspaceProcessSession,
            )
          : undefined;
      if (
        updated &&
        receipt &&
        receipt.threadId === event.threadId &&
        receipt.runId === event.runId
      ) {
        sessions.set(updated.id, updated);
      }
      continue;
    }
    if (
      event.type !== WORKSPACE_PROCESS_STARTED_EVENT &&
      event.type !== WORKSPACE_PROCESS_SETTLED_EVENT &&
      event.type !== WORKSPACE_PROCESS_INTERRUPTED_EVENT
    ) {
      continue;
    }
    const session = parseWorkspaceProcessSession(event.payload);
    if (
      !session ||
      session.threadId !== event.threadId ||
      session.runId !== event.runId ||
      (event.type === WORKSPACE_PROCESS_STARTED_EVENT
        ? session.status !== "running" ||
          (session.schemaVersion >= 3 &&
            session.stdinMode === "interactive" &&
            (session.stdinOpen !== true ||
              session.stdinWriteCount !== 0 ||
              session.stdinBytes !== 0 ||
              session.stdinSha256 !== EMPTY_SHA256)) ||
          (session.schemaVersion >= 4 &&
            session.ioMode === "pty" &&
            session.terminalResizeCount !== 0)
        : session.status === "running")
    ) {
      continue;
    }
    sessions.set(session.id, session);
  }
  return [...sessions.values()].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
}

export function projectWorkspaceProcessRollbackResults(
  events: RunEvent[],
): WorkspaceProcessRollbackResult[] {
  return projectWorkspaceProcessRollbackHistory(
    events,
    parseWorkspaceProcessSession,
  ).results;
}

export function projectWorkspaceProcessRollbackAttempts(
  events: RunEvent[],
): WorkspaceProcessRollbackAttempt[] {
  return projectWorkspaceProcessRollbackHistory(
    events,
    parseWorkspaceProcessSession,
  ).attempts;
}
