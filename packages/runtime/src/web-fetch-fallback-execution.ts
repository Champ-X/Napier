import {
  shouldUseBrowserFallback,
  validateBrowserFallbackCapture,
} from "./web-fetch-browser-fallback.js";
import {
  MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN,
  MAX_WEB_FETCH_OUTPUT_CHARS,
  WEB_FETCH_BROWSER_FALLBACK_WAIT_MS,
  type ParsedWebContent,
  type WebFetchBrowserFallbackDiagnostic,
  type WebFetchBrowserFallbackEvidence,
  type WebFetchBrowserFallbackProvider,
  type WebFetchBrowserFallbackStatus,
  type WebFetchRenderMode,
} from "./web-fetch-model.js";

export interface WebFetchFallbackResult {
  lines: string[];
  title: string;
  truncated: boolean;
  renderMode: WebFetchRenderMode;
  status: WebFetchBrowserFallbackStatus;
  diagnostic?: WebFetchBrowserFallbackDiagnostic;
  evidence?: WebFetchBrowserFallbackEvidence;
  browserFallbackCount: number;
}

export async function resolveWebFetchBrowserFallback(input: {
  browserFallback?: WebFetchBrowserFallbackProvider;
  browserFallbackCount: number;
  owner: { threadId: string; runId: string };
  body: Buffer;
  finalUrl: string;
  parsed: ParsedWebContent;
  contentType: string;
  signal: AbortSignal;
  allowed: boolean;
}): Promise<WebFetchFallbackResult> {
  const staticResult = {
    lines: input.parsed.lines,
    title: input.parsed.title,
    truncated: input.parsed.truncated,
    renderMode: "static" as const,
    status: "not_needed" as const,
    browserFallbackCount: input.browserFallbackCount,
  };
  if (
    !input.allowed ||
    !input.browserFallback ||
    !shouldUseBrowserFallback({
      contentType: input.contentType,
      body: input.body,
      parsed: input.parsed,
    })
  ) {
    return staticResult;
  }
  if (input.browserFallbackCount >= MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "fallback_limit_reached",
    };
  }
  const browserFallbackCount = input.browserFallbackCount + 1;
  let capture;
  try {
    capture = await input.browserFallback.captureUrl(
      input.owner,
      {
        url: input.finalUrl,
        maxChars: MAX_WEB_FETCH_OUTPUT_CHARS,
        waitMs: WEB_FETCH_BROWSER_FALLBACK_WAIT_MS,
      },
      input.signal,
    );
  } catch {
    assertNotAborted(input.signal);
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_unavailable",
      browserFallbackCount,
    };
  }
  const validated = validateBrowserFallbackCapture({
    capture,
    expectedUrl: input.finalUrl,
    maxChars: MAX_WEB_FETCH_OUTPUT_CHARS,
    staticTextChars: input.parsed.lines.join("\n").length,
  });
  if (!validated) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_render_not_useful",
      browserFallbackCount,
    };
  }
  return {
    lines: [...capture.lines],
    title: capture.title || input.parsed.title,
    truncated: capture.truncated,
    renderMode: "browser_fallback",
    status: "used",
    evidence: validated.evidence,
    browserFallbackCount,
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Web fetch was cancelled");
}
