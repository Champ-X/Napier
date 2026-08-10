import type { WorkspaceProcessSession } from "@napier/contracts";

import { nowIso } from "./ids.js";
import {
  createWorkspaceProcessSession,
  workspaceProcessStableSessionInput,
} from "./workspace-process-events.js";
import { closedWorkspaceProcessLocalService } from "./workspace-process-local-service.js";

export function createInterruptedWorkspaceProcessSession(
  session: WorkspaceProcessSession,
  input: {
    reason: string;
    stdoutChars?: number;
    stderrChars?: number;
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
    nextCursor?: number;
  },
): WorkspaceProcessSession {
  return createWorkspaceProcessSession({
    schemaVersion: session.schemaVersion,
    ...workspaceProcessStableSessionInput(session),
    status: "interrupted",
    ...closedWorkspaceProcessLocalService(session),
    ...(session.schemaVersion >= 3 ? { stdinOpen: false } : {}),
    settledAt: nowIso(),
    stdoutChars: input.stdoutChars ?? session.stdoutChars,
    stderrChars: input.stderrChars ?? session.stderrChars,
    stdoutTruncated: input.stdoutTruncated ?? session.stdoutTruncated,
    stderrTruncated: input.stderrTruncated ?? session.stderrTruncated,
    nextCursor: input.nextCursor ?? session.nextCursor,
    interruptionReason: input.reason,
  });
}
