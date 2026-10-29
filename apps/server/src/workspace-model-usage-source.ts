import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { readVerifiedModelUsageDelivery, type ModelUsageSource, type VerifiedModelUsageDelivery } from "@napier/runtime/internal";

/** A workspace-scoped host source. Physical observations are recorded by the
 * admission lease so its budget debit and durable outbox share one transaction. */
export function workspaceModelUsageSource(input: {
  source: ModelUsageSource;
  workspaceId: string;
  assertOpen(): void;
  transaction<T>(operation: () => T): T;
  undispatched(attribution: ModelCallAttributionV1, observation: ModelPhysicalObservationV1): "inserted" | "duplicate";
  acknowledge(delivery: VerifiedModelUsageDelivery): void;
}): ModelUsageSource {
  const scoped = (attribution: ModelCallAttributionV1 | undefined): ModelCallAttributionV1 => {
    input.assertOpen();
    if (!attribution || attribution.hostWorkspaceId !== input.workspaceId ||
        attribution.receiptSourceId !== input.source.sourceId) throw new Error("Model usage source workspace mismatch");
    return attribution;
  };
  return {
    sourceId: input.source.sourceId,
    reserve(attribution) {
      scoped(attribution);
      return input.transaction(() => input.source.reserve(attribution));
    },
    attribution(physicalId) {
      input.assertOpen();
      const attribution = input.source.attribution(physicalId);
      return attribution?.hostWorkspaceId === input.workspaceId ? attribution : undefined;
    },
    record(observation) {
      const attribution = scoped(input.source.attribution(observation.physicalId));
      if (observation.terminal !== "undispatched" || observation.usageStatus !== "known_zero_undispatched")
        throw new Error("Physical model observations require their host admission lease");
      return input.undispatched(attribution, observation);
    },
    pending(filter = {}) {
      input.assertOpen();
      if (filter.hostWorkspaceId !== undefined && filter.hostWorkspaceId !== input.workspaceId)
        throw new Error("Model usage source workspace mismatch");
      return input.source.pending({ ...filter, hostWorkspaceId: input.workspaceId });
    },
    acknowledge(delivery) {
      scoped(readVerifiedModelUsageDelivery(delivery).attribution);
      input.acknowledge(delivery);
    },
  };
}
