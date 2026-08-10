import type { WorkspaceProcessSession } from "@napier/contracts";

export type WorkspaceProcessSessionInput = Omit<
  WorkspaceProcessSession,
  | "kind"
  | "schemaVersion"
  | "outputAvailable"
  | "workspaceDeltaAvailable"
  | "workspaceRollbackAvailable"
  | "workspaceCompensationStatus"
  | "contentSha256"
> & { schemaVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 };
