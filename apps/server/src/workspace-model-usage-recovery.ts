import { LocalStore } from "@napier/runtime/store";
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
  const store = new LocalStore({ workspaceRoot: identity.root, dataRoot: identity.dataRoot });
  try {
    await store.initializeAccounting();
    await admission.reconcileUsage(identity.workspaceId, store);
  } finally { store.close(); }
}
