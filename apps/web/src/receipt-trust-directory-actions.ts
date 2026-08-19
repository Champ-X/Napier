import type { ReceiptTrustAnchorDirectorySubscription } from "@napier/contracts";

import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  createReceiptTrustAnchorDirectorySubscription,
  discoverReceiptTrustAnchorDirectory,
  refreshReceiptTrustAnchorDirectorySubscription,
  updateReceiptTrustAnchorDirectorySubscription,
} from "./receipt-trust-api";
import {
  activateDirectorySubscriptionState,
  clearBaselineActivationEvidenceState,
  clearExternalDirectoryState,
  upsertDirectorySubscriptionState,
} from "./receipt-trust-state-actions";

export async function discoverTrustDirectory(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const request = context.projection.discoveryRequest;
  if (!request || !context.projection.canDiscover) return;
  context.patch({
    directoryDiscovery: undefined,
    directoryVerification: undefined,
    directoryMetadataVerification: undefined,
  });
  const discovery = await context.operation.run("discover-directory", () =>
    discoverReceiptTrustAnchorDirectory(request),
  );
  if (!discovery) return;
  const accepted =
    discovery.status === "valid" ? discovery.directory : undefined;
  context.patch({
    directoryDiscovery: discovery,
    directoryVerification: discovery.verification,
    externalDirectory: accepted,
    externalDirectoryPolicy: accepted ? request.policy : undefined,
    externalDirectorySubscriptionId: undefined,
  });
}

export async function createTrustDirectorySubscription(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const request = context.projection.subscriptionRequest;
  if (!request || !context.projection.canSubscribe) return;
  const subscription = await context.operation.run("subscribe-directory", () =>
    createReceiptTrustAnchorDirectorySubscription(request),
  );
  if (!subscription) return;
  context.update((current) => {
    const next = clearBaselineActivationEvidenceState(
      upsertDirectorySubscriptionState(current, subscription),
    );
    return activateDirectorySubscriptionState(
      {
        ...next,
        directoryQuorum: undefined,
        directorySubscriptionLabel: "",
      },
      subscription,
    );
  });
}

export async function refreshTrustDirectorySubscription(
  context: ReceiptTrustActionContext,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): Promise<void> {
  const result = await context.operation.run(
    `refresh-subscription:${subscription.id}`,
    () =>
      refreshReceiptTrustAnchorDirectorySubscription(
        subscription.id,
        subscription.auditThreadId,
        subscription.revision,
      ),
  );
  if (!result) return;
  context.update((current) => {
    let next = clearBaselineActivationEvidenceState(
      upsertDirectorySubscriptionState(current, result.subscription),
    );
    next = { ...next, directoryQuorum: undefined };
    if (result.discovery) {
      next = {
        ...next,
        directoryDiscovery: result.discovery,
        directoryVerification: result.discovery.verification,
      };
    }
    return result.subscription.status === "active" &&
      result.subscription.lastGoodDiscovery?.directory
      ? activateDirectorySubscriptionState(next, result.subscription)
      : next;
  });
}

export async function toggleTrustDirectorySubscription(
  context: ReceiptTrustActionContext,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): Promise<void> {
  const updated = await context.operation.run(
    `toggle-subscription:${subscription.id}`,
    () =>
      updateReceiptTrustAnchorDirectorySubscription(subscription.id, {
        threadId: subscription.auditThreadId,
        expectedRevision: subscription.revision,
        status: subscription.status === "active" ? "paused" : "active",
      }),
  );
  if (!updated) return;
  context.update((current) => {
    let next = clearBaselineActivationEvidenceState(
      upsertDirectorySubscriptionState(current, updated),
    );
    next = { ...next, directoryQuorum: undefined };
    if (updated.status === "active" && updated.lastGoodDiscovery?.directory) {
      return activateDirectorySubscriptionState(next, updated);
    }
    return current.externalDirectorySubscriptionId === updated.id
      ? clearExternalDirectoryState(next)
      : next;
  });
}

export function activateTrustDirectorySubscription(
  context: ReceiptTrustActionContext,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): void {
  context.update((current) =>
    activateDirectorySubscriptionState(current, subscription),
  );
}

export function clearExternalTrustDirectory(
  context: ReceiptTrustActionContext,
): void {
  context.update(clearExternalDirectoryState);
}
