import type {
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export function createWorkspaceProcessRollbackAttempt(input: {
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  previewSha256: string;
  recoverySnapshotSha256: string;
  expectedWorkspaceSha256: string;
  scopeCount: number;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  attemptedAt: string;
}): WorkspaceProcessRollbackAttempt {
  const content = {
    kind: "napier.workspace-process-rollback-attempt" as const,
    schemaVersion: 1 as const,
    ...input,
    initiatedBy: "operator" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createWorkspaceProcessRollbackResult(input: {
  attempt: WorkspaceProcessRollbackAttempt;
  status: WorkspaceProcessRollbackResult["status"];
  observedWorkspaceSha256: string;
  restoredScopeCount: number;
  rollbackVerified: boolean;
  durable: boolean;
  cancellationObserved: boolean;
  appliedAt: string;
  error?: unknown;
}): WorkspaceProcessRollbackResult {
  const content = {
    kind: "napier.workspace-process-rollback" as const,
    schemaVersion: 1 as const,
    id: input.attempt.id,
    threadId: input.attempt.threadId,
    runId: input.attempt.runId,
    processId: input.attempt.processId,
    initiatedBy: "operator" as const,
    attemptSha256: input.attempt.contentSha256,
    status: input.status,
    recoverySnapshotSha256: input.attempt.recoverySnapshotSha256,
    expectedWorkspaceSha256: input.attempt.expectedWorkspaceSha256,
    observedWorkspaceSha256: input.observedWorkspaceSha256,
    scopeCount: input.attempt.scopeCount,
    restoredScopeCount: input.restoredScopeCount,
    fileCount: input.attempt.fileCount,
    directoryCount: input.attempt.directoryCount,
    bytes: input.attempt.bytes,
    rollbackAttempted: true as const,
    rollbackVerified: input.rollbackVerified,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
    appliedAt: input.appliedAt,
    ...(input.error ? { errorSha256: sha256(errorMessage(input.error)) } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
