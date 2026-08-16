import type { WorkspaceProcessSession } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export function workspaceProcessSessionWithRuntimeState(
  session: WorkspaceProcessSession,
  runtime: {
    nextCursor: number;
    outputAvailable: boolean;
    workspaceDeltaAvailable: boolean;
    workspaceRollbackAvailable?: boolean;
    workspaceCompensationStatus?: WorkspaceProcessSession["workspaceCompensationStatus"];
    stdinOpen?: boolean;
  },
): WorkspaceProcessSession {
  const { contentSha256: _contentSha256, ...content } = {
    ...session,
    nextCursor: runtime.nextCursor,
    outputAvailable: runtime.outputAvailable,
    workspaceDeltaAvailable: runtime.workspaceDeltaAvailable,
    ...(runtime.workspaceRollbackAvailable !== undefined
      ? { workspaceRollbackAvailable: runtime.workspaceRollbackAvailable }
      : {}),
    ...(runtime.workspaceCompensationStatus !== undefined
      ? { workspaceCompensationStatus: runtime.workspaceCompensationStatus }
      : {}),
    ...(runtime.stdinOpen !== undefined
      ? { stdinOpen: runtime.stdinOpen }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function projectActiveWorkspaceProcessSession(input: {
  session: WorkspaceProcessSession;
  nextCursor: number;
  privateProtocol: boolean;
  workspaceDeltaAvailable: boolean;
  workspaceRollbackAvailable: boolean;
  workspaceCompensationStatus?: WorkspaceProcessSession["workspaceCompensationStatus"];
}): WorkspaceProcessSession {
  return workspaceProcessSessionWithRuntimeState(input.session, {
    nextCursor: input.nextCursor,
    outputAvailable: !input.privateProtocol,
    workspaceDeltaAvailable: input.workspaceDeltaAvailable,
    ...(input.session.workspaceAccess === "scoped_write" &&
    input.session.schemaVersion >= 6
      ? {
          workspaceRollbackAvailable: input.workspaceRollbackAvailable,
          ...(input.workspaceCompensationStatus
            ? {
                workspaceCompensationStatus: input.workspaceCompensationStatus,
              }
            : {}),
        }
      : {}),
    ...(input.privateProtocol &&
    input.session.schemaVersion >= 3 &&
    input.session.stdinMode === "interactive"
      ? { stdinOpen: false }
      : {}),
  });
}
