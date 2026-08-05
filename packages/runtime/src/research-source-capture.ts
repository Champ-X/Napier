import {
  MAX_BROWSER_SESSION_OPERATIONS,
  type BrowserPageSourceCapture,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_PROXY_REQUESTS,
  MAX_PROXY_TRANSFER_BYTES,
} from "./fixed-ip-http-proxy.js";
import { validatePublicHttpUrl } from "./public-network.js";
import { validBrowserFallbackEvidence } from "./web-fetch-browser-fallback.js";
import type {
  BrowserResearchCapture,
  ResearchSourceCapture,
  WebFetchResearchSourceCapture,
} from "./research-source-model.js";
import {
  WEB_FETCH_SOURCE_FORMATS,
  type WebFetchResearchCapture,
} from "./web-fetch-model.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export function validateResearchBrowserCapture(
  capture: BrowserPageSourceCapture,
  maxChars: number,
): URL {
  const normalized = browserResearchCapture(capture);
  const url = validateResearchSourceCapture(normalized, maxChars);
  const network = capture.network;
  if (
    !Number.isSafeInteger(capture.sessionOperation) ||
    capture.sessionOperation < 1 ||
    capture.sessionOperation > MAX_BROWSER_SESSION_OPERATIONS ||
    !SHA256.test(capture.sessionIdSha256) ||
    !/^tab_[1-9][0-9]{0,3}$/u.test(capture.activeTabId) ||
    !Number.isSafeInteger(capture.tabCount) ||
    capture.tabCount < 1 ||
    capture.tabCount > 4 ||
    !SHA256.test(capture.tabSetSha256) ||
    !SHA256.test(capture.browserExecutableSha256) ||
    !SHA256.test(capture.browserVersionSha256) ||
    !SHA256.test(capture.limitsSha256) ||
    !validNetworkCount(network.requestCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.connectCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.rejectedCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.destinationCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.transferredBytes, MAX_PROXY_TRANSFER_BYTES) ||
    network.connectCount > network.requestCount ||
    network.rejectedCount > network.requestCount ||
    network.destinationCount > network.requestCount ||
    !SHA256.test(network.destinationsSha256)
  ) {
    throw new Error("Browser Source capture binding is invalid");
  }
  return url;
}

export function browserResearchCapture(
  capture: BrowserPageSourceCapture,
): BrowserResearchCapture {
  return {
    kind: "browser",
    url: capture.url,
    title: capture.title,
    lines: [...capture.lines],
    textChars: capture.textChars,
    truncated: capture.truncated,
    capturedContentSha256: capture.capturedContentSha256,
    browser: {
      sessionOperation: capture.sessionOperation,
      sessionIdSha256: capture.sessionIdSha256,
      activeTabId: capture.activeTabId,
      tabCount: capture.tabCount,
      tabSetSha256: capture.tabSetSha256,
      executableSha256: capture.browserExecutableSha256,
      versionSha256: capture.browserVersionSha256,
      limitsSha256: capture.limitsSha256,
      network: structuredClone(capture.network),
    },
  };
}

export function validateResearchWebFetchCapture(
  capture: WebFetchResearchSourceCapture,
  maxChars: number,
): URL {
  const url = validateResearchSourceCapture(capture, maxChars);
  if (
    !SHA256.test(capture.webFetch.sourceContentSha256) ||
    !SHA256.test(capture.webFetch.sourceBodySha256) ||
    !WEB_FETCH_SOURCE_FORMATS.includes(capture.webFetch.sourceFormat) ||
    !Number.isSafeInteger(capture.webFetch.sourceLineCount) ||
    capture.webFetch.sourceLineCount < capture.lines.length ||
    capture.webFetch.sourceLineCount > 20_000 ||
    !validWebFetchRenderProvenance(capture)
  ) {
    throw new Error("Web Fetch Source capture binding is invalid");
  }
  return url;
}

export function webFetchResearchSourceCapture(
  fetched: WebFetchResearchCapture,
): WebFetchResearchSourceCapture {
  return {
    kind: "web_fetch",
    url: fetched.url,
    title: fetched.title,
    lines: [...fetched.lines],
    textChars: fetched.textChars,
    truncated: fetched.truncated,
    capturedContentSha256: captureContentSha256(fetched),
    webFetch: {
      sourceContentSha256: fetched.webSourceContentSha256,
      sourceBodySha256: fetched.webSourceBodySha256,
      sourceFormat: fetched.webSourceFormat,
      sourceLineCount: fetched.webSourceLineCount,
      renderMode: fetched.webSourceRenderMode,
      browserFallbackStatus: fetched.browserFallbackStatus,
      ...(fetched.browserFallbackDiagnostic
        ? { browserFallbackDiagnostic: fetched.browserFallbackDiagnostic }
        : {}),
      ...(fetched.browserFallback
        ? { browserFallback: structuredClone(fetched.browserFallback) }
        : {}),
    },
  };
}

function validWebFetchRenderProvenance(
  capture: WebFetchResearchSourceCapture,
): boolean {
  const webFetch = capture.webFetch;
  if (webFetch.browserFallbackStatus === "used") {
    return (
      webFetch.sourceFormat === "html" &&
      webFetch.renderMode === "browser_fallback" &&
      webFetch.browserFallbackDiagnostic === undefined &&
      webFetch.browserFallback !== undefined &&
      validBrowserFallbackEvidence(webFetch.browserFallback)
    );
  }
  if (webFetch.browserFallbackStatus === "unavailable") {
    return (
      webFetch.sourceFormat === "html" &&
      webFetch.renderMode === "static" &&
      webFetch.browserFallback === undefined &&
      (webFetch.browserFallbackDiagnostic === "browser_unavailable" ||
        webFetch.browserFallbackDiagnostic === "browser_render_not_useful" ||
        webFetch.browserFallbackDiagnostic === "fallback_limit_reached")
    );
  }
  return (
    webFetch.browserFallbackStatus === "not_needed" &&
    webFetch.renderMode === "static" &&
    webFetch.browserFallbackDiagnostic === undefined &&
    webFetch.browserFallback === undefined
  );
}

export function validateResearchSourceCapture(
  capture: ResearchSourceCapture,
  maxChars: number,
): URL {
  const url = validatePublicHttpUrl(capture.url);
  const text = capture.lines.join("\n");
  if (
    capture.url.length > 4_096 ||
    capture.title.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(capture.title) ||
    capture.lines.length < 1 ||
    capture.lines.length > 400 ||
    capture.lines.some(
      (line) =>
        !line ||
        line.length > 1_000 ||
        /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(line),
    ) ||
    !Number.isSafeInteger(capture.textChars) ||
    capture.textChars !== text.length ||
    capture.textChars > maxChars ||
    typeof capture.truncated !== "boolean" ||
    captureContentSha256(capture) !== capture.capturedContentSha256
  ) {
    throw new Error("Research Source capture binding is invalid");
  }
  return url;
}

export function captureContentSha256(
  capture: Pick<ResearchSourceCapture, "url" | "title" | "lines" | "truncated">,
): string {
  return sha256(
    canonicalJson({
      url: capture.url,
      title: capture.title,
      lines: capture.lines,
      truncated: capture.truncated,
    }),
  );
}

function validNetworkCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
