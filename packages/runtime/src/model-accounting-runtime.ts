import path from "node:path";
import type { LocalStore } from "./store.js";
import { ModelUsageReceiptSpool } from "./model-usage-source.js";
import { createLocalModelCallAdmission } from "./model-call-local-admission.js";
import { drainModelCallAccounting, type ModelCallAdmission } from "./model-call-admission.js";
import { projectPendingModelUsage } from "./model-usage-projection.js";
import { nativeAccountingDestination } from "./model-accounting-destination.js";
import { modelAccountingBinding } from "./model-accounting-binding.js";

/** The standalone runtime owns its source; a host-owned source outlives eviction. */
export async function initializeModelAccountingRuntime(store: LocalStore, configured?: ModelCallAdmission) {
  const destination = nativeAccountingDestination(store);
  const configuredBinding = modelAccountingBinding(configured);
  const owned = configuredBinding ? undefined : await ModelUsageReceiptSpool.open(path.join(store.dataRoot, "model-usage.sqlite"));
  const source = configuredBinding?.source ?? owned!;
  const admission = configuredBinding ? configured! : createLocalModelCallAdmission(source, configured);
  const project = () => projectPendingModelUsage(source, store.modelAccountingRepository,
    { workspaceLedgerId: destination.workspaceLedgerId() });
  try {
    destination.configureSource({ source,
      ...(configuredBinding?.hostWorkspaceId ? { hostWorkspaceId: configuredBinding.hostWorkspaceId } : {}),
      ...(admission.isDeclaredZeroCost ? { isDeclaredZeroCost: admission.isDeclaredZeroCost } : {}) });
    await project();
    return { admission, close: () => owned?.close(), async drain(registry: object) {
      await drainModelCallAccounting(registry);
      await project();
    } };
  } catch (error) { owned?.close(); throw error; }
}
