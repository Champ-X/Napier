import type { LocalStore } from "@napier/runtime/store";

import { ReceiptTrustAnchorDirectoryDiscoveryService } from "./receipt-trust-directory-discovery.js";
import { ReceiptTrustAnchorDirectorySubscriptionService } from "./receipt-trust-directory-subscriptions.js";

export function createReceiptTrustServices(
  store: LocalStore,
  options?: {
    receiptTrustDirectoryDiscovery?: ConstructorParameters<
      typeof ReceiptTrustAnchorDirectoryDiscoveryService
    >[0];
    receiptTrustDirectorySubscriptions?: ConstructorParameters<
      typeof ReceiptTrustAnchorDirectorySubscriptionService
    >[2];
  },
) {
  const receiptTrustDirectories =
    new ReceiptTrustAnchorDirectoryDiscoveryService(
      options?.receiptTrustDirectoryDiscovery,
    );
  return {
    receiptTrustDirectories,
    receiptTrustDirectorySubscriptions:
      new ReceiptTrustAnchorDirectorySubscriptionService(
        store,
        receiptTrustDirectories,
        options?.receiptTrustDirectorySubscriptions,
      ),
  };
}
