import type { Browser, LaunchOptions } from "playwright-core";
import type { ExecutionResourceAdmission } from "./execution-resource-admission.js";
import type { FixedIpProxyBinding, FixedIpProxySnapshot } from "./fixed-ip-http-proxy.js";
import type { PublicHostLookup } from "./public-network.js";
import type { RunLocalServiceLeaseRegistry } from "./run-local-service-leases.js";

export interface BrowserNetworkProxy {
  start(): Promise<FixedIpProxyBinding>;
  setOutboundEnabled(enabled: boolean): void;
  snapshot(): FixedIpProxySnapshot;
  close(): Promise<void>;
}

export interface BrowserRuntimeBinding {
  executablePath: string;
  executableSha256: string;
  identity?: {
    device: number;
    inode: number;
    size: number;
    modifiedAtMs: number;
  };
}

export interface RunBrowserSessionManagerOptions {
  workspaceRoot: string;
  localServiceLeases?: RunLocalServiceLeaseRegistry;
  executablePath?: string;
  lookup?: PublicHostLookup;
  createProxy?: () => BrowserNetworkProxy;
  resolveRuntime?: () => Promise<BrowserRuntimeBinding>;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
  resourceAdmission?: ExecutionResourceAdmission;
}
