import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { parseWebFetchBody } from "./web-fetch-content.js";
import { resolveWebFetchBrowserFallback } from "./web-fetch-fallback-execution.js";
import {
  MAX_WEB_FETCH_BODY_BYTES,
  type WebFetchBrowserFallbackProvider,
  type WebFetchExecutionOptions,
  type WebFetchSource,
} from "./web-fetch-model.js";
import type { PublicHttpClient } from "./public-http-client.js";

export interface ExecuteWebFetchSourceInput {
  http: Pick<PublicHttpClient, "request">;
  browserFallback?: WebFetchBrowserFallbackProvider;
  browserFallbackCount: number;
  owner: { threadId: string; runId: string };
  url: string;
  signal: AbortSignal;
  options: WebFetchExecutionOptions;
  now: () => Date;
  allowPdfWithoutText?: boolean;
}

export interface ExecutedWebFetchSource {
  source: WebFetchSource;
  body: Buffer;
  browserFallbackCount: number;
}

export async function executeWebFetchSource(
  input: ExecuteWebFetchSourceInput,
): Promise<ExecutedWebFetchSource> {
  const response = await input.http.request(
    {
      url: normalizeRequestedUrl(input.url),
      headers: {
        accept:
          "text/html, text/markdown, application/json, application/pdf, text/plain;q=0.9, */*;q=0.1",
      },
      maxResponseBytes: MAX_WEB_FETCH_BODY_BYTES,
    },
    input.signal,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Web fetch returned HTTP ${response.status}`);
  }
  const contentType = header(response.headers["content-type"]);
  const parsed = await parseWebFetchBody({
    body: response.body,
    contentType,
    finalUrl: response.finalUrl,
    signal: input.signal,
    ...(input.allowPdfWithoutText ? { allowPdfWithoutText: true } : {}),
  });
  throwIfAborted(input.signal);
  const fallback = await resolveWebFetchBrowserFallback({
    ...(input.browserFallback
      ? { browserFallback: input.browserFallback }
      : {}),
    browserFallbackCount: input.browserFallbackCount,
    owner: input.owner,
    body: response.body,
    finalUrl: response.finalUrl,
    parsed,
    contentType,
    signal: input.signal,
    allowed: input.options.browserFallbackAllowed === true,
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

function normalizeRequestedUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_096) {
    throw new Error("Web fetch URL is invalid");
  }
  return normalized;
}

function header(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Web fetch was cancelled");
}
