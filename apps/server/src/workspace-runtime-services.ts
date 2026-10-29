import type { NapierServices } from "./server-composition-root.js";

/** Keep future obligations resident as well as currently executing Runs. All
 * foreground handlers/finite SSE executions are additionally registry-pinned. */
export function workspaceRuntimeCanDispose(services: NapierServices): boolean {
  const store = services.store;
  const threads = store.listThreads();
  const runs = threads.flatMap((thread) => store.listRuns(thread.id));
  const waiting = new Set(threads.filter((thread) => thread.status === "waiting" && !store.getThread(thread.id).currentRunId).map((thread) => thread.id));
  if (runs.some((run) => run.status === "queued" || run.status === "running")) return false;
  if (services.workspaceProcesses.hasPendingWork()) return false;
  if (services.browserTasks.hasPendingWork()) return false;
  if (services.receiptTrustDirectorySubscriptions.hasPendingWork()) return false;
  if (store.listSchedules().some((schedule) => schedule.status === "active" || schedule.claim)) return false;
  if (store.listInboundChannels().some((channel) => channel.status === "active")) return false;
  if (store.listInboundDeliveries().some((delivery) =>
    ["accepted", "running", "retrying"].includes(delivery.status))) return false;
  if (store.listAutomaticRecoveryAttempts().some((attempt) =>
    ["claimed", "running"].includes(attempt.status))) return false;
  const assessments = new Set(store.listAutomaticRecoveryAssessments().map((entry) => entry.runId));
  const recovered = new Set(runs.filter((run) => run.source === "recovery").map((run) => run.parentRunId));
  // Deferred recovery has not yet published an assessment. Settled or blocked
  // historical assessments do not keep an otherwise idle graph forever.
  if (runs.some((run) => run.status === "interrupted" && waiting.has(run.threadId) && !assessments.has(run.id) && !recovered.has(run.id))) return false;
  if (store.listReceiptTrustAnchorDirectorySubscriptions().some((entry) => entry.status === "active")) return false;
  if (store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions()
    .some((entry) => entry.status === "active")) return false;
  return true;
}

export async function disposeWorkspaceRuntimeServices(
  services: NapierServices,
  beforeRuntimeShutdown?: () => Promise<void>,
): Promise<void> {
  // Invoke every stop before awaiting: no worker can schedule its next tick
  // while another worker is draining. Never close its ledger before it settles.
  const stopped = await Promise.allSettled([
    services.receiptTrustDirectorySubscriptions.stop(),
    services.recovery.stop(), services.automation.stop(), services.channels.stop(),
  ]);
  const failures = stopped.filter((entry) => entry.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((entry) => entry.reason), "Workspace workers did not drain");
  await beforeRuntimeShutdown?.();
  await services.shutdownLocalRuntime();
}
