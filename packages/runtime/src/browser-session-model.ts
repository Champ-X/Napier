import type { Browser, LaunchOptions } from "playwright-core";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  FixedIpProxyBinding,
  FixedIpProxySnapshot,
} from "./fixed-ip-http-proxy.js";
import type { PublicHostLookup } from "./public-network.js";

export const MAX_ACTIVE_BROWSER_SESSIONS = 2;
export const MAX_BROWSER_SESSION_OPERATIONS = 64;
export const MAX_BROWSER_SNAPSHOT_CHARS = 32_000;
export const MAX_BROWSER_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const BROWSER_ACTION_TIMEOUT_MS = 15_000;
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;
export const BROWSER_LAUNCH_TIMEOUT_MS = 20_000;

export const BROWSER_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxActiveSessions: MAX_ACTIVE_BROWSER_SESSIONS,
    maxOperations: MAX_BROWSER_SESSION_OPERATIONS,
    maxSnapshotChars: MAX_BROWSER_SNAPSHOT_CHARS,
    maxScreenshotBytes: MAX_BROWSER_SCREENSHOT_BYTES,
    actionTimeoutMs: BROWSER_ACTION_TIMEOUT_MS,
    navigationTimeoutMs: BROWSER_NAVIGATION_TIMEOUT_MS,
    launchTimeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
    proxy: "authenticated_fixed_ip_public_http",
    proxyOutbound: "action_scoped_default_deny",
    executableFreshness: "device_inode_size_mtime_before_after_launch",
    topLevelCrossOrigin: "explicit_per_action",
    popups: "deny",
    dialogs: "dismiss",
    unsolicitedDownloads: "cancel",
    serviceWorkers: "block",
    browserProfile: "fresh_ephemeral",
  }),
);

export interface BrowserSessionOwner {
  threadId: string;
  runId: string;
}

export interface BrowserElementTarget {
  ref?: string;
  selector?: string;
}

export type BrowserSessionRequest =
  | {
      action: "start";
      url: string;
      allowCrossOrigin?: boolean;
    }
  | {
      action: "navigate";
      url: string;
      allowCrossOrigin?: boolean;
    }
  | {
      action: "back";
      allowCrossOrigin?: boolean;
    }
  | { action: "snapshot" }
  | {
      action: "click";
      target: BrowserElementTarget;
      allowCrossOrigin?: boolean;
    }
  | {
      action: "type";
      target: BrowserElementTarget;
      text: string;
    }
  | {
      action: "select";
      target: BrowserElementTarget;
      values: string[];
    }
  | {
      action: "upload";
      target: BrowserElementTarget;
      path: string;
    }
  | {
      action: "download";
      target: BrowserElementTarget;
      path: string;
      allowCrossOrigin?: boolean;
    }
  | { action: "screenshot" }
  | { action: "close" };

export interface BrowserSessionFileEvidence {
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
}

export interface BrowserSessionDetails {
  kind: "napier.browser-session-operation";
  schemaVersion: 1;
  action: BrowserSessionRequest["action"];
  sessionMode: "run_persistent";
  sessionReused: boolean;
  sessionOperation: number;
  sessionIdSha256: string;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  titleSha256: string;
  snapshotSha256?: string;
  snapshotChars?: number;
  snapshotTruncated?: boolean;
  screenshotSha256?: string;
  screenshotBytes?: number;
  file?: BrowserSessionFileEvidence;
  suggestedFilenameSha256?: string;
  blockedRequestCount: number;
  network: FixedIpProxySnapshot;
  crossOriginAuthorized: boolean;
}

export interface BrowserSessionOperationResult {
  output: string;
  details: BrowserSessionDetails;
  screenshot?: {
    data: string;
    mimeType: "image/png";
  };
}

export interface BrowserPageSourceCapture {
  url: string;
  title: string;
  lines: string[];
  textChars: number;
  truncated: boolean;
  capturedContentSha256: string;
  sessionOperation: number;
  sessionIdSha256: string;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  network: FixedIpProxySnapshot;
}

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
  executablePath?: string;
  lookup?: PublicHostLookup;
  createProxy?: () => BrowserNetworkProxy;
  resolveRuntime?: () => Promise<BrowserRuntimeBinding>;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}
