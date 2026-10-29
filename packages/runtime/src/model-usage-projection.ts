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
  for (;;) {
    const pending = source.pending(filter);
    if (!pending.length) return;
    for (const delivery of pending) {
      await repository.reconcile(delivery);
      source.acknowledge(delivery);
    }
  }
}
