import type {
  BrowserPageSourceCapture,
  BrowserSessionOwner,
} from "./browser-session-model.js";
import type { FixedIpProxySnapshot } from "./fixed-ip-http-proxy.js";

export const WEB_FETCH_SOURCE_FORMATS = [
  "html",
  "markdown",
  "json",
  "text",
  "pdf",
] as const;

export type WebFetchSourceFormat = (typeof WEB_FETCH_SOURCE_FORMATS)[number];
export type WebFetchRenderMode = "static" | "browser_fallback";
export type WebFetchBrowserFallbackStatus =
  | "not_needed"
  | "used"
  | "unavailable";
export type WebFetchBrowserFallbackDiagnostic =
  | "browser_unavailable"
  | "browser_render_not_useful"
  | "fallback_limit_reached";

export interface WebFetchBrowserFallbackEvidence {
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

export interface WebFetchBrowserFallbackProvider {
  captureUrl(
    owner: BrowserSessionOwner,
    request: {
      url: string;
      maxChars: number;
      waitMs: number;
    },
    signal?: AbortSignal,
  ): Promise<BrowserPageSourceCapture>;
}

export interface WebFetchExecutionOptions {
  browserFallbackAllowed?: boolean;
}

export type WebFetchRequest =
  | {
      action: "fetch";
      url: string;
    }
  | {
      action: "read";
      sourceId: string;
      sourceContentSha256: string;
      startLine: number;
      endLine: number;
    }
  | {
      action: "find";
      sourceId: string;
      sourceContentSha256: string;
      query: string;
      maxResults?: number;
    }
  | { action: "list" };

export interface ParsedWebContent {
  format: WebFetchSourceFormat;
  title: string;
  author?: string;
  publishedAt?: string;
  lines: string[];
  truncated: boolean;
  pageCount?: number;
}

export interface WebFetchSource {
  id: string;
  finalUrl: string;
  title: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  contentType: string;
  format: WebFetchSourceFormat;
  bodySha256: string;
  contentSha256: string;
  bodyBytes: number;
  lineCount: number;
  textChars: number;
  truncated: boolean;
  redirectCount: number;
  pageCount?: number;
  renderMode: WebFetchRenderMode;
  browserFallbackStatus: WebFetchBrowserFallbackStatus;
  browserFallbackDiagnostic?: WebFetchBrowserFallbackDiagnostic;
  browserFallback?: WebFetchBrowserFallbackEvidence;
  lines: string[];
}

export interface WebFetchToolDetails {
  kind: "napier.web-fetch";
  schemaVersion: 1;
  action: WebFetchRequest["action"];
  sourceId?: string;
  sourceFormat?: WebFetchSourceFormat;
  sourceContentSha256?: string;
  sourceUrlSha256?: string;
  sourceOriginSha256?: string;
  sourceTitleSha256?: string;
  sourceAuthorSha256?: string;
  sourcePublishedAtSha256?: string;
  sourceBodySha256?: string;
  sourceBodyBytes?: number;
  sourceLineCount?: number;
  sourceTextChars?: number;
  sourceTruncated?: boolean;
  sourcePageCount?: number;
  sourceRenderMode?: WebFetchRenderMode;
  browserFallbackStatus?: WebFetchBrowserFallbackStatus;
  browserFallbackDiagnostic?: WebFetchBrowserFallbackDiagnostic;
  browserFallbackCount?: number;
  browserSessionOperation?: number;
  browserSessionIdSha256?: string;
  browserActiveTabId?: string;
  browserTabCount?: number;
  browserTabSetSha256?: string;
  browserExecutableSha256?: string;
  browserVersionSha256?: string;
  browserLimitsSha256?: string;
  browserNetworkRequestCount?: number;
  browserNetworkConnectCount?: number;
  browserNetworkRejectedCount?: number;
  browserNetworkTransferredBytes?: number;
  browserNetworkDestinationCount?: number;
  browserNetworkDestinationsSha256?: string;
  redirectCount?: number;
  readStartLine?: number;
  readEndLine?: number;
  readLineCount?: number;
  findMatchCount?: number;
  findQuerySha256?: string;
  sourceCount: number;
  sourceSetSha256: string;
  retrievedAt?: string;
}

export interface WebFetchResult {
  output: string;
  details: WebFetchToolDetails;
}

export interface WebFetchExecutor {
  execute(
    owner: { threadId: string; runId: string },
    request: WebFetchRequest,
    signal?: AbortSignal,
    options?: WebFetchExecutionOptions,
  ): Promise<WebFetchResult>;
  cancelRun(owner: { threadId: string; runId: string }): Promise<void>;
  captureWebSource?(
    owner: { threadId: string; runId: string },
    request: {
      webSourceId: string;
      webSourceContentSha256: string;
      maxChars: number;
    },
    signal?: AbortSignal,
  ): Promise<WebFetchResearchCapture>;
}

export interface WebFetchResearchCapture {
  url: string;
  title: string;
  lines: string[];
  textChars: number;
  truncated: boolean;
  webSourceContentSha256: string;
  webSourceBodySha256: string;
  webSourceFormat: WebFetchSourceFormat;
  webSourceLineCount: number;
  webSourceRenderMode: WebFetchRenderMode;
  browserFallbackStatus: WebFetchBrowserFallbackStatus;
  browserFallbackDiagnostic?: WebFetchBrowserFallbackDiagnostic;
  browserFallback?: WebFetchBrowserFallbackEvidence;
}

export interface WebFetchResearchCaptureProvider {
  captureWebSource(
    owner: { threadId: string; runId: string },
    request: {
      webSourceId: string;
      webSourceContentSha256: string;
      maxChars: number;
    },
    signal?: AbortSignal,
  ): Promise<WebFetchResearchCapture>;
}

export const MAX_WEB_FETCH_SOURCES_PER_RUN = 16;
export const MAX_WEB_FETCH_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_WEB_FETCH_CONTENT_CHARS = 2_000_000;
export const MAX_WEB_FETCH_LINES = 20_000;
export const MAX_WEB_FETCH_OUTPUT_CHARS = 24_000;
export const MAX_WEB_FETCH_READ_LINES = 400;
export const MAX_WEB_FETCH_FIND_RESULTS = 20;
export const MAX_WEB_FETCH_PDF_PAGES = 200;
export const WEB_FETCH_PARSE_TIMEOUT_MS = 15_000;
export const MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN = 2;
export const WEB_FETCH_BROWSER_FALLBACK_WAIT_MS = 1_000;
