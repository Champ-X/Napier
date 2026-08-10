import type { WorkspaceProcessSession } from "@napier/contracts";

import { workspaceProcessSessionWithRuntimeState } from "./workspace-process-events.js";
import type { WorkspaceProcessRecoveryManager } from "./workspace-process-recovery.js";

export function projectInactiveWorkspaceProcessSession(
  session: WorkspaceProcessSession,
  recovery?: WorkspaceProcessRecoveryManager,
): WorkspaceProcessSession {
  if (session.schemaVersion < 6) return session;
  const compensationStatus = recovery?.compensationStatus(session);
  return workspaceProcessSessionWithRuntimeState(session, {
    nextCursor: session.nextCursor,
    outputAvailable: false,
    workspaceDeltaAvailable: false,
    workspaceRollbackAvailable: recovery?.available(session) === true,
    ...(compensationStatus
      ? { workspaceCompensationStatus: compensationStatus }
      : {}),
  });
}
