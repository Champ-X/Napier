import type {
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { createId } from "./ids.js";
import {
  cleanupWorkspaceProcessRollbackArtifacts,
  restoreWorkspaceProcessRecoveryScopes,
} from "./workspace-process-recovery-files.js";
import type { WorkspaceProcessRecoveryManifest } from "./workspace-process-recovery-manifest.js";
import {
  createWorkspaceProcessRollbackAttempt,
  createWorkspaceProcessRollbackResult,
} from "./workspace-process-rollback-evidence.js";
import { createWorkspaceProcessWriteSnapshot } from "./workspace-process-write-snapshot.js";

export async function executeWorkspaceProcessRollbackTransaction(input: {
  session: WorkspaceProcessSession;
  manifest: WorkspaceProcessRecoveryManifest;
  initiatedBy: WorkspaceProcessRollbackAttempt["initiatedBy"];
  authorizationSha256: string;
  workspaceRoot: string;
  recoveryDirectory: string;
  signal?: AbortSignal;
  now(): Date;
  recordAttempt(attempt: WorkspaceProcessRollbackAttempt): Promise<void>;
  attemptRecorded(attempt: WorkspaceProcessRollbackAttempt): void;
  recordResult(result: WorkspaceProcessRollbackResult): Promise<void>;
}): Promise<WorkspaceProcessRollbackResult> {
  const rollbackId = createId("processrollback");
  const attempt = createWorkspaceProcessRollbackAttempt({
    id: rollbackId,
    threadId: input.session.threadId,
    runId: input.session.runId,
    processId: input.session.id,
    initiatedBy: input.initiatedBy,
    previewSha256: input.authorizationSha256,
    recoverySnapshotSha256: input.manifest.contentSha256,
    expectedWorkspaceSha256: input.session.workspaceAfterSha256!,
    scopeCount: input.manifest.totals.scopeCount,
    fileCount: input.manifest.totals.fileCount,
    directoryCount: input.manifest.totals.directoryCount,
    bytes: input.manifest.totals.bytes,
    attemptedAt: input.now().toISOString(),
  });
  try {
    await input.recordAttempt(attempt);
  } catch {
    throw new Error(
      "Workspace Process rollback was not started because its Ledger intent could not be persisted",
    );
  }
  input.attemptRecorded(attempt);
  const restored = await restoreWorkspaceProcessRecoveryScopes({
    workspaceRoot: input.workspaceRoot,
    recoveryDirectory: input.recoveryDirectory,
    rollbackId,
    scopes: input.manifest.scopes,
    ...(input.signal ? { signal: input.signal } : {}),
  }).catch((error) => ({
    status: "reverted" as const,
    restoredScopeCount: 0,
    durable: true,
    cancellationObserved: input.signal?.aborted === true,
    cleanupTargets: [],
    error,
  }));
  let status = restored.status;
  let durable = restored.durable;
  let rollbackError = restored.error;
  if (status !== "indeterminate") {
    try {
      const cleanupDurable = await cleanupWorkspaceProcessRollbackArtifacts(
        restored.cleanupTargets,
      );
      durable = durable && cleanupDurable;
    } catch (error) {
      status = "indeterminate";
      durable = false;
      rollbackError = error;
    }
  }
  const observed = await createWorkspaceProcessWriteSnapshot(
    input.workspaceRoot,
  );
  const result = createWorkspaceProcessRollbackResult({
    attempt,
    status,
    observedWorkspaceSha256: observed.sha256,
    restoredScopeCount: restored.restoredScopeCount,
    rollbackVerified: status === "restored",
    durable,
    cancellationObserved: restored.cancellationObserved,
    appliedAt: input.now().toISOString(),
    ...(rollbackError ? { error: rollbackError } : {}),
  });
  try {
    await input.recordResult(result);
  } catch {
    throw new Error(
      "Workspace Process rollback changed the workspace but its Ledger outcome could not be persisted; inspect workspace state before retrying",
    );
  }
  return result;
}
