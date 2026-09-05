import type { Browser, LaunchOptions } from "playwright-core";
import { type BrowserPageDiagnosisEvidence } from "@napier/contracts/browser-live-view";
import { type BrowserTakeoverKey } from "@napier/contracts/browser-takeover";

import type {
  FixedIpProxyBinding,
  FixedIpProxySnapshot,
} from "./fixed-ip-http-proxy.js";
import type { PublicHostLookup } from "./public-network.js";
import type { RunLocalServiceLeaseRegistry } from "./run-local-service-leases.js";

export * from "./browser-session-limits.js";

export interface BrowserSessionOwner {
  threadId: string;
  runId: string;
  /**
   * Runtime-internal isolation lane. User-facing Browser tools omit this and
   * therefore use the interactive lane; helpers such as Web Fetch fallback
   * use a dedicated lane so they cannot navigate or close that session.
   */
  sessionLane?: string;
}

export interface BrowserElementTarget {
  ref?: string;
  selector?: string;
}

export interface BrowserSessionTabDescriptor {
  tabId: string;
  active: boolean;
  url: string;
  title: string;
}

export type BrowserSessionRequest =
  | {
      action: "start";
      url: string;
      allowCrossOrigin?: boolean;
    }
  | {
      action: "preview_workspace";
      path: string;
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
  | {
      action: "forward";
      allowCrossOrigin?: boolean;
    }
  | {
      action: "tab_new";
      url: string;
      allowCrossOrigin?: boolean;
    }
  | { action: "tab_list" }
  | { action: "tab_switch"; tabId: string }
  | { action: "tab_close"; tabId: string }
  | { action: "wait"; durationMs?: number }
  | { action: "find"; query: string }
  | {
      action: "scroll";
      direction: "up" | "down";
      pixels?: number;
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
  | {
      action: "save_screenshot";
      path: string;
      expectedLiveImageSha256: string;
    }
  | {
      action: "visual_click";
      x: number;
      y: number;
      allowCrossOrigin?: boolean;
    }
  | {
      action: "keypress";
      key: BrowserTakeoverKey;
      allowCrossOrigin?: boolean;
    }
  | { action: "screenshot" }
  | { action: "console" }
  | { action: "close" };

export interface BrowserConsoleObservation {
  entryCount: number;
  errorCount: number;
  warningCount: number;
  entriesSha256: string;
  truncated: boolean;
  output: string;
}

export interface BrowserSessionFileEvidence {
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
}

export interface BrowserFindObservation {
  querySha256: string;
  queryChars: number;
  matchCount: number;
  matchesSha256: string;
  scannedChars: number;
  truncated: boolean;
  output: string;
}

export interface BrowserScrollObservation {
  deltaY: number;
  positionY: number;
  viewportHeight: number;
  documentHeight: number;
  atStart: boolean;
  atEnd: boolean;
  viewportTextSha256: string;
  viewportTextChars: number;
  viewportTextTruncated: boolean;
  output: string;
}

export interface BrowserSessionDetails {
  kind: "napier.browser-session-operation";
  schemaVersion: 3;
  action: BrowserSessionRequest["action"];
  sessionMode: "run_persistent";
  sessionReused: boolean;
  sessionOperation: number;
  sessionIdSha256: string;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  titleSha256: string;
  pageDiagnosis: BrowserPageDiagnosisEvidence;
  snapshotSha256?: string;
  snapshotChars?: number;
  snapshotTruncated?: boolean;
  findQuerySha256?: string;
  findQueryChars?: number;
  findMatchCount?: number;
  findMatchesSha256?: string;
  findScannedChars?: number;
  findTruncated?: boolean;
  scrollDeltaY?: number;
  scrollPositionY?: number;
  scrollViewportHeight?: number;
  scrollDocumentHeight?: number;
  scrollAtStart?: boolean;
  scrollAtEnd?: boolean;
  viewportTextSha256?: string;
  viewportTextChars?: number;
  viewportTextTruncated?: boolean;
  consoleEntryCount?: number;
  consoleErrorCount?: number;
  consoleWarningCount?: number;
  consoleEntriesSha256?: string;
  consoleTruncated?: boolean;
  workspacePreviewEntryPathSha256?: string;
  workspacePreviewEntrySha256?: string;
  workspacePreviewEntryBytes?: number;
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
  snapshot?: string;
  tabs?: BrowserSessionTabDescriptor[];
  screenshot?: {
    data: string;
    mimeType: "image/png";
  };
}

export interface BrowserPageSourceCapture {
  url: string;
  title: string;
  pageDiagnosis?: BrowserPageDiagnosisEvidence;
  semanticAppControlCount?: number;
  lines: string[];
  textChars: number;
  truncated: boolean;
  capturedContentSha256: string;
  sessionOperation: number;
  sessionIdSha256: string;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
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
  localServiceLeases?: RunLocalServiceLeaseRegistry;
  executablePath?: string;
  lookup?: PublicHostLookup;
  createProxy?: () => BrowserNetworkProxy;
  resolveRuntime?: () => Promise<BrowserRuntimeBinding>;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}
