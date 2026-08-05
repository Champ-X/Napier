import type { BrowserSessionOwner } from "./browser-session-model.js";
import type { FixedIpProxySnapshot } from "./fixed-ip-http-proxy.js";
import type { WebFetchSourceFormat } from "./web-fetch-model.js";
import type {
  WebFetchBrowserFallbackDiagnostic,
  WebFetchBrowserFallbackEvidence,
  WebFetchBrowserFallbackStatus,
  WebFetchRenderMode,
} from "./web-fetch-model.js";
import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";

export type ResearchSourceRequest =
  | { action: "capture"; maxChars?: number }
  | {
      action: "capture_fetch";
      webSourceId: string;
      webSourceContentSha256: string;
      maxChars?: number;
    }
  | {
      action: "cite";
      sourceId: string;
      sourceContentSha256: string;
      startLine: number;
      endLine: number;
      claim: string;
    }
  | { action: "verify_report"; path: string; expectedSha256: string }
  | { action: "list" };

export interface ResearchSourceToolDetails {
  kind: "napier.research-source";
  schemaVersion: 1;
  action: ResearchSourceRequest["action"];
  sourceKind?: "browser" | "web_fetch";
  sourceId?: string;
  citationId?: string;
  citationTokenSha256?: string;
  sourceContentSha256?: string;
  sourceUrlSha256?: string;
  sourceOriginSha256?: string;
  sourceTitleSha256?: string;
  sourceTextSha256?: string;
  sourceLineCount?: number;
  sourceTextChars?: number;
  sourceTruncated?: boolean;
  citationStartLine?: number;
  citationEndLine?: number;
  citationQuoteSha256?: string;
  citationClaimSha256?: string;
  reportPathSha256?: string;
  reportFileSha256?: string;
  reportFileBytes?: number;
  reportCitationCount?: number;
  reportCitationSetSha256?: string;
  sourceCount: number;
  citationCount: number;
  sourceSetSha256: string;
  stateCapsule?: ResearchSourceCapsuleReceipt;
  browserSessionOperation?: number;
  browserSessionIdSha256?: string;
  browserActiveTabId?: string;
  browserTabCount?: number;
  browserTabSetSha256?: string;
  browserExecutableSha256?: string;
  browserVersionSha256?: string;
  browserLimitsSha256?: string;
  browserNetworkDestinationsSha256?: string;
  webSourceContentSha256?: string;
  webSourceBodySha256?: string;
  webSourceFormat?: WebFetchSourceFormat;
  webSourceLineCount?: number;
  webSourceRenderMode?: WebFetchRenderMode;
  browserFallbackStatus?: WebFetchBrowserFallbackStatus;
  browserFallbackDiagnostic?: WebFetchBrowserFallbackDiagnostic;
  webFetchBrowserSessionOperation?: number;
  webFetchBrowserSessionIdSha256?: string;
  webFetchBrowserActiveTabId?: string;
  webFetchBrowserTabCount?: number;
  webFetchBrowserTabSetSha256?: string;
  webFetchBrowserExecutableSha256?: string;
  webFetchBrowserVersionSha256?: string;
  webFetchBrowserLimitsSha256?: string;
  webFetchBrowserNetworkDestinationsSha256?: string;
}

export interface ResearchSourceResult {
  output: string;
  details: ResearchSourceToolDetails;
}

export interface BrowserSourceCaptureProvider {
  capturePage(
    owner: BrowserSessionOwner,
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<import("./browser-session-model.js").BrowserPageSourceCapture>;
}

export interface ResearchSourceCaptureBase {
  url: string;
  title: string;
  lines: string[];
  textChars: number;
  truncated: boolean;
  capturedContentSha256: string;
}

export interface BrowserResearchCapture extends ResearchSourceCaptureBase {
  kind: "browser";
  browser: {
    sessionOperation: number;
    sessionIdSha256: string;
    activeTabId: string;
    tabCount: number;
    tabSetSha256: string;
    executableSha256: string;
    versionSha256: string;
    limitsSha256: string;
    network: FixedIpProxySnapshot;
  };
}

export interface WebFetchResearchSourceCapture extends ResearchSourceCaptureBase {
  kind: "web_fetch";
  webFetch: {
    sourceContentSha256: string;
    sourceBodySha256: string;
    sourceFormat: WebFetchSourceFormat;
    sourceLineCount: number;
    renderMode: WebFetchRenderMode;
    browserFallbackStatus: WebFetchBrowserFallbackStatus;
    browserFallbackDiagnostic?: WebFetchBrowserFallbackDiagnostic;
    browserFallback?: WebFetchBrowserFallbackEvidence;
  };
}

export type ResearchSourceCapture =
  | BrowserResearchCapture
  | WebFetchResearchSourceCapture;
