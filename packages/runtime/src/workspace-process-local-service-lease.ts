import type { WorkspaceProcessSession } from "@napier/contracts";

import {
  RunLocalServiceLeaseRegistry,
  type LocalServiceLeaseRevocationReason,
} from "./run-local-service-leases.js";

export class WorkspaceProcessLocalServiceLeases extends RunLocalServiceLeaseRegistry {
  async started(session: WorkspaceProcessSession): Promise<void> {
    if (session.localService) await this.grant(session).catch(() => undefined);
  }

  async ended(
    session: Pick<WorkspaceProcessSession, "threadId" | "runId" | "id">,
    reason: Extract<
      LocalServiceLeaseRevocationReason,
      "process_settled" | "start_failed"
    >,
  ): Promise<void> {
    await this.revokeProcess(session, reason).catch(() => undefined);
  }
}
