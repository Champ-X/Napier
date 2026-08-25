import type { KeychainSecretStore } from "@napier/runtime/governance";
import type { OsSandboxAdapter } from "@napier/runtime/code";
import type { SandboxSetupServiceDependencies } from "@napier/runtime/sandbox-setup-service";

import type { ReceiptTrustAnchorDirectoryDiscoveryOptions } from "./receipt-trust-directory-discovery.js";
import type { ReceiptTrustAnchorDirectorySubscriptionServiceOptions } from "./receipt-trust-directory-subscriptions.js";

export interface ServerServiceOptions {
  dataRoot?: string;
  workspaceRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
  startAutomation?: boolean;
  keychain?: KeychainSecretStore;
  sandbox?: OsSandboxAdapter;
  sandboxSetup?: SandboxSetupServiceDependencies;
  receiptTrustDirectoryDiscovery?: ReceiptTrustAnchorDirectoryDiscoveryOptions;
  receiptTrustDirectorySubscriptions?: ReceiptTrustAnchorDirectorySubscriptionServiceOptions;
}
