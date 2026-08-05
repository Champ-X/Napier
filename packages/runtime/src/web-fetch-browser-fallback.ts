import {
  MAX_BROWSER_SESSION_OPERATIONS,
  type BrowserPageSourceCapture,
  type BrowserSessionOwner,
} from "./browser-session-model.js";
import type { RunBrowserSessionManager } from "./browser-session.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_PROXY_REQUESTS,
  MAX_PROXY_TRANSFER_BYTES,
} from "./fixed-ip-http-proxy.js";
import { validatePublicHttpUrl } from "./public-network.js";
import type {
  ParsedWebContent,
  WebFetchBrowserFallbackEvidence,
  WebFetchBrowserFallbackProvider,
} from "./web-fetch-model.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_STATIC_SHELL_TEXT_CHARS = 1_000;
const MIN_RENDERED_TEXT_CHARS = 80;
const MIN_RENDERED_GROWTH_CHARS = 80;

export function createWebFetchBrowserFallbackProvider(
  manager: Pick<RunBrowserSessionManager, "execute" | "capturePage">,
): WebFetchBrowserFallbackProvider {
  return {
    captureUrl: (owner, request, signal) =>
      captureBrowserFallback(manager, owner, request, signal),
  };
}

export function shouldUseBrowserFallback(input: {
  contentType: string;
  body: Buffer;
  parsed: ParsedWebContent;
}): boolean {
  if (input.parsed.format !== "html") return false;
  const mime = input.contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (mime && mime !== "text/html" && mime !== "application/xhtml+xml") {
    return false;
  }
  const staticTextChars = input.parsed.lines.join("\n").length;
  if (staticTextChars < 1 || staticTextChars > MAX_STATIC_SHELL_TEXT_CHARS) {
    return false;
  }
  const html = input.body.toString("utf8");
  return (
    /<script\b/iu.test(html) &&
    /\bdocument\.(?:write|writeln)\s*\(/iu.test(html) &&
    !/<input\b[^>]*\btype\s*=\s*["']?password\b/iu.test(html)
  );
}

export function validateBrowserFallbackCapture(input: {
  capture: BrowserPageSourceCapture;
  expectedUrl: string;
  maxChars: number;
  staticTextChars: number;
}): { evidence: WebFetchBrowserFallbackEvidence } | undefined {
  const capture = input.capture;
  const expectedUrl = validatePublicHttpUrl(input.expectedUrl);
  const capturedUrl = validatePublicHttpUrl(capture.url);
  const text = capture.lines.join("\n");
  if (
    capturedUrl.href !== expectedUrl.href ||
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
    capture.textChars !== text.length ||
    capture.textChars > input.maxChars ||
    capture.textChars < MIN_RENDERED_TEXT_CHARS ||
    capture.textChars - input.staticTextChars < MIN_RENDERED_GROWTH_CHARS ||
    capture.capturedContentSha256 !==
      sha256(
        canonicalJson({
          url: capture.url,
          title: capture.title,
          lines: capture.lines,
          truncated: capture.truncated,
        }),
      ) ||
    !validBrowserFallbackEvidence({
      sessionOperation: capture.sessionOperation,
      sessionIdSha256: capture.sessionIdSha256,
      activeTabId: capture.activeTabId,
      tabCount: capture.tabCount,
      tabSetSha256: capture.tabSetSha256,
      browserExecutableSha256: capture.browserExecutableSha256,
      browserVersionSha256: capture.browserVersionSha256,
      limitsSha256: capture.limitsSha256,
      network: capture.network,
    })
  ) {
    return undefined;
  }
  return {
    evidence: {
      sessionOperation: capture.sessionOperation,
      sessionIdSha256: capture.sessionIdSha256,
      activeTabId: capture.activeTabId,
      tabCount: capture.tabCount,
      tabSetSha256: capture.tabSetSha256,
      browserExecutableSha256: capture.browserExecutableSha256,
      browserVersionSha256: capture.browserVersionSha256,
      limitsSha256: capture.limitsSha256,
      network: structuredClone(capture.network),
    },
  };
}

export function validBrowserFallbackEvidence(
  evidence: WebFetchBrowserFallbackEvidence,
): boolean {
  const network = evidence.network;
  return (
    Number.isSafeInteger(evidence.sessionOperation) &&
    evidence.sessionOperation >= 1 &&
    evidence.sessionOperation <= MAX_BROWSER_SESSION_OPERATIONS &&
    SHA256.test(evidence.sessionIdSha256) &&
    /^tab_[1-9][0-9]{0,3}$/u.test(evidence.activeTabId) &&
    Number.isSafeInteger(evidence.tabCount) &&
    evidence.tabCount >= 1 &&
    evidence.tabCount <= 4 &&
    SHA256.test(evidence.tabSetSha256) &&
    SHA256.test(evidence.browserExecutableSha256) &&
    SHA256.test(evidence.browserVersionSha256) &&
    SHA256.test(evidence.limitsSha256) &&
    validNetworkCount(network.requestCount, MAX_PROXY_REQUESTS) &&
    validNetworkCount(network.connectCount, MAX_PROXY_REQUESTS) &&
    validNetworkCount(network.rejectedCount, MAX_PROXY_REQUESTS) &&
    validNetworkCount(network.destinationCount, MAX_PROXY_REQUESTS) &&
    validNetworkCount(network.transferredBytes, MAX_PROXY_TRANSFER_BYTES) &&
    network.connectCount <= network.requestCount &&
    network.rejectedCount <= network.requestCount &&
    network.destinationCount <= network.requestCount &&
    SHA256.test(network.destinationsSha256)
  );
}

async function captureBrowserFallback(
  manager: Pick<RunBrowserSessionManager, "execute" | "capturePage">,
  owner: BrowserSessionOwner,
  request: { url: string; maxChars: number; waitMs: number },
  signal?: AbortSignal,
): Promise<BrowserPageSourceCapture> {
  let started = false;
  try {
    await manager.execute(owner, { action: "start", url: request.url }, signal);
    started = true;
    await manager.execute(
      owner,
      { action: "wait", durationMs: request.waitMs },
      signal,
    );
    return await manager.capturePage(owner, request.maxChars, signal);
  } finally {
    if (started) {
      await manager
        .execute(owner, { action: "close" }, signal)
        .catch(() => undefined);
    }
  }
}

function validNetworkCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
