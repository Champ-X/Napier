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
import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  ToolOperationLifecycle,
  ToolOperationObserver,
} from "./tool-operation-journal.js";
import { structuredTransportFailureClass } from "./tool-failure-semantics.js";
import {
  WEB_FETCH_FAILURE_DEFINITION_SHA256,
  webFetchCapabilityBinding,
  webFetchFailure,
  webFetchFailureReceipt,
  webFetchOriginBinding,
  webFetchRouteBinding,
  webFetchSessionBinding,
  webFetchTargetBinding,
} from "./web-fetch-failure.js";

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

export type WebFetchRequestFailureFallbackResult = WebFetchFallbackResult & {
  renderMode: "browser_fallback";
  status: "used";
  evidence: WebFetchBrowserFallbackEvidence;
};

export async function resolveWebFetchBrowserFallback(input: {
  browserFallback?: WebFetchBrowserFallbackProvider;
  browserFallbackCount: number;
  reserveBrowserFallback?: () => Promise<number | undefined>;
  owner: { threadId: string; runId: string };
  body: Buffer;
  finalUrl: string;
  parsed: ParsedWebContent;
  contentType: string;
  signal: AbortSignal;
  allowed: boolean;
  operations?: ToolOperationObserver;
  operationOrdinal: number;
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
  const operation = browserFallbackOperation(
    input.operations,
    input.operationOrdinal,
    input.finalUrl,
  );
  await operation?.proposed();
  const preflight = await operation?.preflight();
  if (preflight && !preflight.admitted) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "failure_circuit_open",
    };
  }
  const admission = await operation?.admit();
  if (admission && !admission.admitted) {
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "failure_circuit_open",
    };
  }
  let browserFallbackCount;
  try {
    browserFallbackCount = await reserveBrowserFallback(input);
  } catch (error) {
    await rejectBrowserOperation(
      operation,
      input.finalUrl,
      error,
      "reservation_failed",
    );
    throw error;
  }
  if (browserFallbackCount === undefined) {
    await rejectBrowserOperation(
      operation,
      input.finalUrl,
      "Browser fallback limit reached",
      "fallback_limit_reached",
    );
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "fallback_limit_reached",
      browserFallbackCount: Math.max(
        input.browserFallbackCount,
        MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN,
      ),
    };
  }
  await operation?.started();
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
  } catch (error) {
    await failBrowserOperation(
      operation,
      input.finalUrl,
      error,
      "browser_unavailable",
    );
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
    await failBrowserOperation(
      operation,
      input.finalUrl,
      "Browser diagnosis is absent or invalid",
      "browser_render_not_useful",
    );
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
    await failBrowserOperation(
      operation,
      input.finalUrl,
      "Browser capture is not bound to the requested URL",
      "browser_render_not_useful",
    );
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_render_not_useful",
      browserFallbackCount,
    };
  }
  if (rendered.pageDiagnosis.status !== "none") {
    await failBrowserOperation(
      operation,
      input.finalUrl,
      `Browser page diagnosis: ${rendered.pageDiagnosis.status}`,
      rendered.pageDiagnosis.status,
    );
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
    await failBrowserOperation(
      operation,
      input.finalUrl,
      "Browser capture did not add useful bounded content",
      "browser_render_not_useful",
    );
    return {
      ...staticResult,
      status: "unavailable",
      diagnostic: "browser_render_not_useful",
      browserFallbackCount,
    };
  }
  await succeedBrowserOperation(operation, rendered.lines, bound.evidence);
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

export async function resolveWebFetchRequestFailureBrowserFallback(input: {
  browserFallback?: WebFetchBrowserFallbackProvider;
  browserFallbackCount: number;
  reserveBrowserFallback?: () => Promise<number | undefined>;
  owner: { threadId: string; runId: string };
  url: string;
  signal: AbortSignal;
  allowed: boolean;
  operations?: ToolOperationObserver;
  operationOrdinal: number;
}): Promise<WebFetchRequestFailureFallbackResult | undefined> {
  if (!input.allowed || !input.browserFallback) {
    return undefined;
  }
  const operation = browserFallbackOperation(
    input.operations,
    input.operationOrdinal,
    input.url,
  );
  await operation?.proposed();
  const preflight = await operation?.preflight();
  if (preflight && !preflight.admitted) return undefined;
  const admission = await operation?.admit();
  if (admission && !admission.admitted) return undefined;
  let browserFallbackCount;
  try {
    browserFallbackCount = await reserveBrowserFallback(input);
  } catch (error) {
    await rejectBrowserOperation(
      operation,
      input.url,
      error,
      "reservation_failed",
    );
    throw error;
  }
  if (browserFallbackCount === undefined) {
    await rejectBrowserOperation(
      operation,
      input.url,
      "Browser fallback limit reached",
      "fallback_limit_reached",
    );
    return undefined;
  }
  await operation?.started();
  let rendered;
  try {
    rendered = await input.browserFallback.captureUrl(
      input.owner,
      {
        url: input.url,
        maxChars: MAX_WEB_FETCH_OUTPUT_CHARS,
        waitMs: WEB_FETCH_BROWSER_FALLBACK_WAIT_MS,
      },
      input.signal,
    );
  } catch (error) {
    await failBrowserOperation(
      operation,
      input.url,
      error,
      "browser_unavailable",
    );
    assertNotAborted(input.signal);
    return undefined;
  }
  const validated = validateBrowserFallbackCapture({
    capture: rendered,
    expectedUrl: input.url,
    maxChars: MAX_WEB_FETCH_OUTPUT_CHARS,
    staticTextChars: 0,
  });
  if (!validated) {
    await failBrowserOperation(
      operation,
      input.url,
      "Browser capture did not produce valid bounded content",
      "browser_render_not_useful",
    );
    return undefined;
  }
  await succeedBrowserOperation(operation, rendered.lines, validated.evidence);
  return {
    lines: [...rendered.lines],
    title: rendered.title,
    truncated: rendered.truncated,
    renderMode: "browser_fallback",
    status: "used",
    evidence: validated.evidence,
    browserFallbackCount,
  };
}

function browserFallbackOperation(
  operations: ToolOperationObserver | undefined,
  ordinal: number,
  url: string,
): ToolOperationLifecycle | undefined {
  const publicOriginBinding = webFetchOriginBinding(url);
  const browserRouteBinding = webFetchRouteBinding(url, "browser_render");
  return operations?.operation({
    ordinal,
    mode: "fallback",
    route: "browser_render",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKey: { kind: "public-url", url },
    failureBindings: {
      target: webFetchTargetBinding(url),
      origin: publicOriginBinding,
      route: browserRouteBinding,
      capability: webFetchCapabilityBinding("browser_render"),
      session: webFetchSessionBinding(),
    },
    failureDefinitionSha256: WEB_FETCH_FAILURE_DEFINITION_SHA256,
    failureDomainKey: browserRouteBinding,
  });
}

async function rejectBrowserOperation(
  operation: ToolOperationLifecycle | undefined,
  url: string,
  diagnostic: unknown,
  reason: string,
): Promise<void> {
  const error = browserFallbackFailure(url, reason, diagnostic);
  const failure = browserFailureReceipt(url, error);
  const admission = await operation?.admit({
    admitted: false,
    diagnostic,
    failure,
  });
  if (!admission || admission.source === "caller") {
    await operation?.settled({
      outcome: "skipped",
      diagnostic,
      failure,
      effect: { admission: "rejected", reason },
    });
  }
}

async function failBrowserOperation(
  operation: ToolOperationLifecycle | undefined,
  url: string,
  diagnostic: unknown,
  reason: string,
): Promise<void> {
  const error = browserFallbackFailure(url, reason, diagnostic);
  await operation?.settled({
    outcome: "failed",
    diagnostic,
    failure: browserFailureReceipt(url, error),
    effect: { outcome: "failed", reason },
  });
}

async function succeedBrowserOperation(
  operation: ToolOperationLifecycle | undefined,
  lines: readonly string[],
  evidence: WebFetchBrowserFallbackEvidence,
): Promise<void> {
  const contentSha256 = sha256(canonicalJson(lines));
  await operation?.settled({
    outcome: "succeeded",
    state: {
      contentSha256,
      networkDestinationsSha256: evidence.network.destinationsSha256,
    },
    effect: {
      route: "browser_render",
      contentSha256,
      networkDestinationsSha256: evidence.network.destinationsSha256,
    },
  });
}

async function reserveBrowserFallback(input: {
  browserFallbackCount: number;
  reserveBrowserFallback?: () => Promise<number | undefined>;
}): Promise<number | undefined> {
  if (input.reserveBrowserFallback) return input.reserveBrowserFallback();
  return input.browserFallbackCount >= MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN
    ? undefined
    : input.browserFallbackCount + 1;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw webFetchFailure("Web fetch was cancelled", "cancelled");
}

function browserFailureReceipt(url: string, failure: unknown) {
  return webFetchFailureReceipt(
    { action: "fetch", url, attemptedRoute: "browser_render" },
    failure,
  );
}

function browserFallbackFailure(
  url: string,
  reason: string,
  diagnostic: unknown,
) {
  const transport = structuredTransportFailureClass(diagnostic);
  if (transport === "timeout" || transport === "network") {
    return webFetchFailure(
      String(reason),
      transport === "timeout" ? "origin_timeout" : "origin_network",
      webFetchOriginBinding(url),
      diagnostic instanceof Error ? { cause: diagnostic } : undefined,
    );
  }
  if (transport === "cancelled") {
    return webFetchFailure(
      "Web fetch browser fallback was cancelled",
      "cancelled",
    );
  }
  if (
    diagnostic instanceof Error &&
    diagnostic.name === "BrowserSessionInactiveError"
  ) {
    return webFetchFailure(
      String(reason),
      "session_inactive",
      webFetchSessionBinding(),
      { cause: diagnostic },
    );
  }
  if (reason === "fallback_limit_reached" || reason === "reservation_failed") {
    return webFetchFailure(String(reason), "resource_limit");
  }
  if (reason === "browser_unavailable") {
    return webFetchFailure(
      String(reason),
      "capability_unavailable",
      webFetchCapabilityBinding("browser_render"),
    );
  }
  if (reason === "login_required" || reason === "challenge_detected") {
    return webFetchFailure(
      String(reason),
      "route_forbidden",
      webFetchRouteBinding(url, "browser_render"),
    );
  }
  return webFetchFailure(
    String(reason),
    "response_invalid",
    webFetchTargetBinding(url),
  );
}
