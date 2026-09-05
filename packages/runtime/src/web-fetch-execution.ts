import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { parseWebFetchBody } from "./web-fetch-content.js";
import {
  resolveWebFetchBrowserFallback,
  resolveWebFetchRequestFailureBrowserFallback,
  type WebFetchRequestFailureFallbackResult,
} from "./web-fetch-fallback-execution.js";
import {
  MAX_WEB_FETCH_BODY_BYTES,
  type WebFetchBrowserFallbackProvider,
  type WebFetchExecutionOptions,
  type WebFetchSource,
} from "./web-fetch-model.js";
import type { PublicHttpClient } from "./public-http-client.js";
import { validatePublicHttpUrl } from "./public-network.js";
import {
  normalizeTransportAbortFailure,
  structuredTransportFailureClass,
} from "./tool-failure-semantics.js";
import {
  WEB_FETCH_FAILURE_DEFINITION_SHA256,
  webFetchFailure,
  webFetchFailureReceipt,
  webFetchOriginBinding,
  webFetchRouteBinding,
  webFetchTargetBinding,
  type WebFetchFailureModeId,
} from "./web-fetch-failure.js";
import type {
  ToolOperationLifecycle,
  ToolOperationObserver,
} from "./tool-operation-journal.js";

export interface ExecuteWebFetchSourceInput {
  http: Pick<PublicHttpClient, "request">;
  browserFallback?: WebFetchBrowserFallbackProvider;
  browserFallbackCount: number;
  reserveBrowserFallback?: () => Promise<number | undefined>;
  owner: { threadId: string; runId: string };
  url: string;
  signal: AbortSignal;
  options: WebFetchExecutionOptions;
  now: () => Date;
  allowPdfWithoutText?: boolean;
  operations?: ToolOperationObserver;
  /** Lets a containing pipeline reserve stable ordinals for earlier stages. */
  operationOrdinalBase?: number;
}

export interface ExecutedWebFetchSource {
  source: WebFetchSource;
  body: Buffer;
  browserFallbackCount: number;
}

export async function executeWebFetchSource(
  input: ExecuteWebFetchSourceInput,
): Promise<ExecutedWebFetchSource> {
  const requestedValue = normalizeRequestedUrl(input.url);
  const operationOrdinalBase = input.operationOrdinalBase ?? 0;
  const publicOriginBinding = webFetchOriginBinding(requestedValue);
  const staticRouteBinding = webFetchRouteBinding(
    requestedValue,
    "static_http",
  );
  const httpOperation = input.operations?.operation({
    ordinal: operationOrdinalBase + 1,
    mode: "primary",
    route: "static_http",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKey: { kind: "public-url", url: requestedValue },
    failureBindings: {
      target: { kind: "public-url", url: requestedValue },
      origin: publicOriginBinding,
      route: staticRouteBinding,
      capability: {
        kind: "web-fetch-capability",
        capability: "public_document_acquisition",
      },
    },
    failureDefinitionSha256: WEB_FETCH_FAILURE_DEFINITION_SHA256,
    failureDomainKey: staticRouteBinding,
  });
  await httpOperation?.proposed();
  let requestedUrl: string;
  try {
    requestedUrl = validatePublicHttpUrl(requestedValue).href;
  } catch (error) {
    const failure = webFetchFailure(
      error instanceof Error ? error.message : "Web fetch URL was not admitted",
      "policy_denied",
      undefined,
      { cause: error },
    );
    await rejectOperation(
      httpOperation,
      failure,
      "url_not_admitted",
      failureReceipt(requestedValue, failure),
    );
    throw failure;
  }
  const admissionRejection = await admitAndStartOperation(httpOperation);
  if (admissionRejection) {
    const fallback = await requestFailureFallback(
      input,
      requestedUrl,
      operationOrdinalBase + 2,
    );
    if (fallback) return browserFallbackSource(input, requestedUrl, fallback);
    throw webFetchFailure(admissionRejection, "policy_denied");
  }
  let response;
  try {
    response = await input.http.request(
      {
        url: requestedUrl,
        headers: {
          accept:
            "text/html, text/markdown, application/json, application/pdf, text/plain;q=0.9, */*;q=0.1",
        },
        maxResponseBytes: MAX_WEB_FETCH_BODY_BYTES,
      },
      input.signal,
    );
  } catch (error) {
    const failure = normalizeTransportAbortFailure(error, input.signal);
    await failOperation(
      httpOperation,
      failure,
      "http_request_failed",
      undefined,
      failureReceipt(requestedUrl, failure),
    );
    throwIfAborted(input.signal);
    if (!recoverableRequestFailure(error)) throw failure;
    const fallback = await requestFailureFallback(
      input,
      requestedUrl,
      operationOrdinalBase + 2,
    );
    if (fallback) return browserFallbackSource(input, requestedUrl, fallback);
    throw failure;
  }
  if (response.status < 200 || response.status >= 300) {
    const error = httpStatusFailure(response.finalUrl, response.status);
    await failOperation(
      httpOperation,
      error,
      "http_status_failed",
      {
        status: response.status,
      },
      failureReceipt(response.finalUrl, error),
    );
    const fallback = recoverableHttpStatus(response.status)
      ? await requestFailureFallback(
          input,
          response.finalUrl,
          operationOrdinalBase + 2,
        )
      : undefined;
    if (fallback) {
      return browserFallbackSource(input, response.finalUrl, fallback);
    }
    throw error;
  }
  const contentType = header(response.headers["content-type"]);
  let parsed;
  try {
    parsed = await parseWebFetchBody({
      body: response.body,
      contentType,
      finalUrl: response.finalUrl,
      signal: input.signal,
      ...(input.allowPdfWithoutText ? { allowPdfWithoutText: true } : {}),
    });
  } catch (error) {
    const failure = webFetchFailure(
      error instanceof Error
        ? error.message
        : "Web fetch response could not be parsed",
      "response_invalid",
      webFetchTargetBinding(response.finalUrl),
      { cause: error },
    );
    await failOperation(
      httpOperation,
      failure,
      "response_parse_failed",
      undefined,
      failureReceipt(response.finalUrl, failure),
    );
    throw failure;
  }
  const staticContentSha256 = sha256(canonicalJson(parsed.lines));
  await httpOperation?.settled({
    outcome: "succeeded",
    state: {
      bodySha256: sha256(response.body),
      contentSha256: staticContentSha256,
    },
    effect: {
      route: "static_http",
      status: response.status,
      bodySha256: sha256(response.body),
      contentSha256: staticContentSha256,
    },
  });
  throwIfAborted(input.signal);
  const fallback = await resolveWebFetchBrowserFallback({
    ...(input.browserFallback
      ? { browserFallback: input.browserFallback }
      : {}),
    browserFallbackCount: input.browserFallbackCount,
    ...(input.reserveBrowserFallback
      ? { reserveBrowserFallback: input.reserveBrowserFallback }
      : {}),
    owner: input.owner,
    body: response.body,
    finalUrl: response.finalUrl,
    parsed,
    contentType,
    signal: input.signal,
    allowed: input.options.browserFallbackAllowed === true,
    ...(input.operations ? { operations: input.operations } : {}),
    operationOrdinal: operationOrdinalBase + 2,
  });
  const lines = fallback.lines;
  return {
    body: response.body,
    browserFallbackCount: fallback.browserFallbackCount,
    source: {
      id: createId("websource"),
      finalUrl: response.finalUrl,
      title: fallback.title,
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.publishedAt ? { publishedAt: parsed.publishedAt } : {}),
      retrievedAt: input.now().toISOString(),
      contentType,
      format: parsed.format,
      bodySha256: sha256(response.body),
      contentSha256: sha256(canonicalJson(lines)),
      bodyBytes: response.body.byteLength,
      lineCount: lines.length,
      textChars: lines.join("\n").length,
      truncated: fallback.truncated,
      redirectCount: response.redirectCount,
      ...(parsed.pageCount !== undefined
        ? { pageCount: parsed.pageCount }
        : {}),
      renderMode: fallback.renderMode,
      browserFallbackStatus: fallback.status,
      ...(fallback.diagnostic
        ? { browserFallbackDiagnostic: fallback.diagnostic }
        : {}),
      ...(fallback.evidence ? { browserFallback: fallback.evidence } : {}),
      lines,
    },
  };
}

async function requestFailureFallback(
  input: ExecuteWebFetchSourceInput,
  url: string,
  operationOrdinal: number,
): Promise<WebFetchRequestFailureFallbackResult | undefined> {
  return resolveWebFetchRequestFailureBrowserFallback({
    ...(input.browserFallback
      ? { browserFallback: input.browserFallback }
      : {}),
    browserFallbackCount: input.browserFallbackCount,
    ...(input.reserveBrowserFallback
      ? { reserveBrowserFallback: input.reserveBrowserFallback }
      : {}),
    owner: input.owner,
    url,
    signal: input.signal,
    allowed: input.options.browserFallbackAllowed === true,
    ...(input.operations ? { operations: input.operations } : {}),
    operationOrdinal,
  });
}

async function admitAndStartOperation(
  operation: ToolOperationLifecycle | undefined,
): Promise<string | undefined> {
  const admission = await operation?.admit();
  if (admission && !admission.admitted) {
    return admission.reason ?? "Web fetch route failure circuit is open";
  }
  await operation?.started();
  return undefined;
}

async function rejectOperation(
  operation: ToolOperationLifecycle | undefined,
  diagnostic: unknown,
  reason: string,
  failure: ReturnType<typeof webFetchFailureReceipt>,
): Promise<void> {
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

async function failOperation(
  operation: ToolOperationLifecycle | undefined,
  diagnostic: unknown,
  reason: string,
  details?: unknown,
  failure?: ReturnType<typeof webFetchFailureReceipt>,
): Promise<void> {
  await operation?.settled({
    outcome: "failed",
    diagnostic,
    details,
    ...(failure ? { failure } : {}),
    effect: { outcome: "failed", reason },
  });
}

function browserFallbackSource(
  input: ExecuteWebFetchSourceInput,
  finalUrl: string,
  fallback: WebFetchRequestFailureFallbackResult,
): ExecutedWebFetchSource {
  const body = Buffer.alloc(0);
  return {
    body,
    browserFallbackCount: fallback.browserFallbackCount,
    source: {
      id: createId("websource"),
      finalUrl,
      title: fallback.title,
      retrievedAt: input.now().toISOString(),
      contentType: "text/html",
      format: "html",
      bodySha256: sha256(body),
      contentSha256: sha256(canonicalJson(fallback.lines)),
      bodyBytes: 0,
      lineCount: fallback.lines.length,
      textChars: fallback.lines.join("\n").length,
      truncated: fallback.truncated,
      redirectCount: 0,
      renderMode: "browser_fallback",
      browserFallbackStatus: "used",
      browserFallback: fallback.evidence,
      lines: [...fallback.lines],
    },
  };
}

function recoverableHttpStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function recoverableRequestFailure(error: unknown): boolean {
  return structuredTransportFailureClass(error) !== undefined;
}

function normalizeRequestedUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_096) {
    throw webFetchFailure("Web fetch URL is invalid", "invalid_input");
  }
  return normalized;
}

function header(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw webFetchFailure("Web fetch was cancelled", "cancelled");
}

function failureReceipt(url: string, failure: unknown) {
  return webFetchFailureReceipt(
    { action: "fetch", url, attemptedRoute: "static_http" },
    failure,
  );
}

function httpStatusFailure(url: string, status: number) {
  const mode: WebFetchFailureModeId =
    status === 401
      ? "route_unauthorized"
      : status === 403
        ? "route_forbidden"
        : status === 404
          ? "target_not_found"
          : status === 429
            ? "route_rate_limited"
            : status === 408 || status === 504
              ? "origin_timeout"
              : status >= 500
                ? "origin_network"
                : "response_invalid";
  const binding =
    mode === "target_not_found" || mode === "response_invalid"
      ? webFetchTargetBinding(url)
      : mode === "origin_timeout" || mode === "origin_network"
        ? webFetchOriginBinding(url)
        : webFetchRouteBinding(url, "static_http");
  return webFetchFailure(`Web fetch returned HTTP ${status}`, mode, binding);
}
