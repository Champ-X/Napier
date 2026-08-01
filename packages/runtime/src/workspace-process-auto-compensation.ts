import type { WorkspaceProcessSession } from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkspaceProcessRecoveryManager } from "./workspace-process-recovery.js";
import {
  appendWorkspaceProcessRollbackAttempt,
  appendWorkspaceProcessRollbackResult,
} from "./workspace-process-rollback-ledger.js";

export async function compensateWorkspaceProcessFailure(input: {
  recovery: WorkspaceProcessRecoveryManager;
  store: LocalStore;
  session: WorkspaceProcessSession;
}): Promise<void> {
  await input.recovery.compensate({
    session: input.session,
    recordAttempt: (attempt) =>
      appendWorkspaceProcessRollbackAttempt(input.store, attempt),
    recordResult: (result) =>
      appendWorkspaceProcessRollbackResult(input.store, result),
  });
}
