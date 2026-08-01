import type {
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";

export class WorkspaceProcessCompensationProjection {
  private readonly pending = new Set<string>();
  private readonly results = new Map<string, WorkspaceProcessRollbackResult>();

  reset(processId: string): void {
    this.pending.delete(processId);
    this.results.delete(processId);
  }

  reconcile(
    attempts: WorkspaceProcessRollbackAttempt[],
    results: WorkspaceProcessRollbackResult[],
  ): void {
    const completed = new Set(results.map((result) => result.id));
    for (const attempt of attempts) {
      if (
        attempt.initiatedBy === "automatic_compensation" &&
        !completed.has(attempt.id)
      ) {
        this.pending.add(attempt.processId);
      }
    }
    for (const result of results) {
      if (result.initiatedBy === "automatic_compensation") {
        this.resultRecorded(result);
      }
    }
  }

  attemptRecorded(processId: string): void {
    this.pending.add(processId);
  }

  resultRecorded(result: WorkspaceProcessRollbackResult): void {
    this.pending.delete(result.processId);
    this.results.set(result.processId, result);
  }

  status(
    session: WorkspaceProcessSession,
  ): WorkspaceProcessSession["workspaceCompensationStatus"] {
    if (
      session.schemaVersion !== 7 ||
      session.failureRecovery !== "restore_scopes"
    ) {
      return undefined;
    }
    if (session.status === "running") return "pending";
    if (
      session.status === "succeeded" ||
      session.workspaceDeltaStatus === "unchanged"
    ) {
      return "not_needed";
    }
    if (
      !workspaceProcessStatusIsCompensable(session.status) ||
      session.workspaceDeltaStatus !== "changed" ||
      session.workspaceWriteScopeStatus !== "within_scope"
    ) {
      return "unavailable";
    }
    const result = this.results.get(session.id);
    if (result) return result.status;
    return this.pending.has(session.id) ? "indeterminate" : "unavailable";
  }
}

export function workspaceProcessStatusIsCompensable(
  status: WorkspaceProcessSession["status"],
): boolean {
  return (
    status === "failed" ||
    status === "timed_out" ||
    status === "output_capped" ||
    status === "cancelled"
  );
}
