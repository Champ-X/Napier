import {
  shouldUseBrowserFallback,
  validateBrowserFallbackCapture,
  validateBrowserFallbackCaptureBinding,
  validBrowserFallbackDiagnosis,
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
  let rendered;
  try {
    rendered = await input.browserFallback.captureUrl(
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
  if (
    !rendered.pageDiagnosis ||
    !validBrowserFallbackDiagnosis(rendered.pageDiagnosis)
  ) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_render_not_useful",
      browserFallbackCount,
    };
  }
  const bound = validateBrowserFallbackCaptureBinding({
    capture: rendered,
    expectedUrl: input.finalUrl,
    maxChars: MAX_WEB_FETCH_OUTPUT_CHARS,
  });
  if (!bound) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_render_not_useful",
      browserFallbackCount,
    };
  }
  if (rendered.pageDiagnosis.status !== "none") {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: rendered.pageDiagnosis.status,
      browserFallbackCount,
    };
  }
  const validated = validateBrowserFallbackCapture({
    capture: rendered,
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
    lines: [...rendered.lines],
    title: rendered.title || input.parsed.title,
    truncated: rendered.truncated,
    renderMode: "browser_fallback",
    status: "used",
    evidence: bound.evidence,
    browserFallbackCount,
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Web fetch was cancelled");
}
