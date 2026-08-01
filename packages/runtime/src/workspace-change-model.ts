import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_WORKSPACE_CHANGE_FILES = 32;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface WorkspaceChange {
  path: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string | null;
  content?: string;
  mode?: number;
}

export interface WorkspaceChangeExpectedFile {
  path: string;
  pathSha256: string;
  beforeSha256: string | null;
  expectedSha256: string | null;
}

export interface WorkspaceChangeCommitOutcome {
  status: "applied" | "rolled_back" | "indeterminate";
  postcondition: "verified" | "drifted" | "indeterminate";
  sourcePreviewResultSha256: string;
  planSha256: string;
  fileCount: number;
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  committedFileCount: number;
  restoredFileCount: number;
  recoveryArtifactCount: number;
  rollbackAttempted: boolean;
  rollbackVerified: boolean;
  durable: boolean;
  cancellationObserved: boolean;
  beforeFileSetSha256: string;
  expectedFileSetSha256: string;
  observedFileSetSha256?: string;
  resourceLimitsSha256: string;
  errorSha256?: string;
  expectedFiles: WorkspaceChangeExpectedFile[];
}

export function validateWorkspaceChanges(
  sourcePreviewResultSha256: string,
  changes: WorkspaceChange[],
): void {
  if (
    !SHA256.test(sourcePreviewResultSha256) ||
    !Array.isArray(changes) ||
    changes.length < 1 ||
    changes.length > MAX_WORKSPACE_CHANGE_FILES
  ) {
    throw new Error("Workspace change commit input is invalid");
  }
  let previousPath: string | undefined;
  for (const change of changes) {
    const beforeValid =
      change.beforeSha256 === null || SHA256.test(change.beforeSha256);
    const afterValid =
      change.afterSha256 === null || SHA256.test(change.afterSha256);
    if (
      !change.path ||
      sha256(change.path) !== change.pathSha256 ||
      (previousPath !== undefined &&
        previousPath.localeCompare(change.path) >= 0) ||
      !beforeValid ||
      !afterValid ||
      (change.beforeSha256 === null && change.afterSha256 === null) ||
      change.beforeSha256 === change.afterSha256 ||
      (change.afterSha256 === null) !== (change.content === undefined) ||
      (change.mode !== undefined &&
        (!Number.isSafeInteger(change.mode) ||
          change.mode < 0 ||
          change.mode > 0o777)) ||
      (change.content !== undefined &&
        (change.content.includes("\u0000") ||
          sha256(change.content) !== change.afterSha256))
    ) {
      throw new Error("Workspace change binding is invalid");
    }
    previousPath = change.path;
  }
}

export function workspaceChangeSetSha256(
  changes: WorkspaceChangeExpectedFile[],
  field: "beforeSha256" | "expectedSha256",
): string {
  return sha256(
    canonicalJson(
      changes.map((change) => ({
        pathSha256: change.pathSha256,
        fileSha256: change[field],
      })),
    ),
  );
}

export function workspaceChangeOperationCounts(changes: WorkspaceChange[]): {
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
} {
  return {
    addedFileCount: changes.filter((change) => change.beforeSha256 === null)
      .length,
    modifiedFileCount: changes.filter(
      (change) => change.beforeSha256 !== null && change.afterSha256 !== null,
    ).length,
    deletedFileCount: changes.filter((change) => change.afterSha256 === null)
      .length,
  };
}
