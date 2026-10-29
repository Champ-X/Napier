import { LocalStore } from "@napier/runtime/store";
import { readVerifiedModelUsageDelivery } from "@napier/runtime/internal";
import type { WorkspaceModelAdmission } from "./workspace-model-admission.js";
import { verifyWorkspaceRuntimeIdentity, type WorkspaceRuntimeIdentity } from "./workspace-runtime-identity.js";

/** Replays accounting without constructing a model registry, AgentRuntime,
 * automation worker, or execution recovery service. Never redispatches a call. */
export async function reconcileWorkspaceModelUsage(
  identity: WorkspaceRuntimeIdentity,
  admission: WorkspaceModelAdmission,
): Promise<void> {
  if (!admission.hasPendingUsage(identity.workspaceId)) return;
  await verifyWorkspaceRuntimeIdentity(identity);
  const source = admission.usageSource(identity.workspaceId);
  const store = new LocalStore({ workspaceRoot: identity.root, dataRoot: identity.dataRoot });
  try {
    await store.initializeAccounting();
    const repository = store.modelAccountingRepository;
    await repository.configureSource({ source, hostWorkspaceId: identity.workspaceId });
    const ledgerId = repository.workspaceLedgerId();
    // Source/ledger identity conflicts above block this destination as a whole.
    // Within an identity-verified batch, try valid siblings even if another
    // receipt conflicts with sealed execution evidence.
    for (let batch = 0; batch < 10; batch += 1) {
      const deliveries = source.pending({ limit: 128 });
      if (!deliveries.length) return;
      const failures: unknown[] = [];
      for (const delivery of deliveries) {
        try {
          const { attribution } = readVerifiedModelUsageDelivery(delivery);
          if (attribution.workspaceLedgerId !== ledgerId)
            throw new Error("Model usage destination ledger changed");
          await repository.reconcile(delivery);
          source.acknowledge(delivery);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Workspace model usage requires reconciliation");
    }
    if (admission.hasPendingUsage(identity.workspaceId))
      throw new Error("Workspace model usage replay batch limit reached; durable receipts remain pending");
  } finally { store.close(); }
}
