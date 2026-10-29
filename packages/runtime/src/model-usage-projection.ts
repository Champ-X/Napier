import { nativeAccountingDestination } from "./model-accounting-destination.js";
import type { VerifiedModelUsageDelivery } from "./model-usage-delivery.js";
import type { ModelUsagePendingFilter, ModelUsageSource } from "./model-usage-source.js";

export interface ModelUsageProjectionPort {
  reconcile(delivery: VerifiedModelUsageDelivery): Promise<unknown>;
}

/** The source acknowledgement is deliberately after the workspace transaction. */
export async function projectPendingModelUsage(
  source: ModelUsageSource,
  repository: ModelUsageProjectionPort,
  filter: ModelUsagePendingFilter = {},
): Promise<void> {
  const destination = nativeAccountingDestination(repository);
  for (;;) {
    const pending = source.pending(filter);
    if (!pending.length) return;
    for (const delivery of pending) {
      await destination.reconcile(delivery);
      source.acknowledge(delivery);
    }
  }
}
