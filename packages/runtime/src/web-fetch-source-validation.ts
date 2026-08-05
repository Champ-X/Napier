import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_BROWSER_SESSION_OPERATIONS } from "./browser-session-model.js";
import {
  MAX_PROXY_REQUESTS,
  MAX_PROXY_TRANSFER_BYTES,
} from "./fixed-ip-http-proxy.js";
import { PUBLIC_HTTP_MAX_REDIRECTS } from "./public-http-client.js";
import { validatePublicHttpUrl } from "./public-network.js";
import {
  MAX_WEB_FETCH_BODY_BYTES,
  MAX_WEB_FETCH_CONTENT_CHARS,
  MAX_WEB_FETCH_LINES,
  MAX_WEB_FETCH_PDF_PAGES,
  WEB_FETCH_SOURCE_FORMATS,
  type WebFetchSource,
} from "./web-fetch-model.js";

const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_ID = /^websource_[a-z0-9]{8,80}$/u;
const SOURCE_KEYS = [
  "id",
  "finalUrl",
  "title",
  "author",
  "publishedAt",
  "retrievedAt",
  "contentType",
  "format",
  "bodySha256",
  "contentSha256",
  "bodyBytes",
  "lineCount",
  "textChars",
  "truncated",
  "redirectCount",
  "pageCount",
  "renderMode",
  "browserFallbackStatus",
  "browserFallbackDiagnostic",
  "browserFallback",
  "lines",
] as const;

export function validateWebFetchSource(input: unknown): WebFetchSource {
  const source = structuredClone(record(input)) as unknown as WebFetchSource;
  const url = validatePublicHttpUrl(source.finalUrl);
  const lines = source.lines;
  const text = Array.isArray(lines) ? lines.join("\n") : "";
  if (
    !exactSourceKeys(source) ||
    !validSourceIdentity(source, url.href) ||
    !validSourceText(source, lines, text) ||
    !validSourceMetadata(source) ||
    !validFallback(source) ||
    sha256(canonicalJson(lines)) !== source.contentSha256
  ) {
    throw new Error("Web Fetch persisted Source binding is invalid");
  }
  return source;
}

function exactSourceKeys(source: WebFetchSource): boolean {
  const allowed = new Set(SOURCE_KEYS);
  const required = SOURCE_KEYS.filter(
    (key) =>
      ![
        "author",
        "publishedAt",
        "pageCount",
        "browserFallbackDiagnostic",
        "browserFallback",
      ].includes(key),
  );
  return (
    Object.keys(source).every((key) => allowed.has(key as never)) &&
    required.every((key) => Object.hasOwn(source, key))
  );
}

function validSourceIdentity(source: WebFetchSource, normalizedUrl: string) {
  return (
    SOURCE_ID.test(source.id) &&
    source.finalUrl === normalizedUrl &&
    source.title.length <= 500 &&
    !control(source.title) &&
    (source.author === undefined ||
      (source.author.length <= 300 && !control(source.author))) &&
    (source.publishedAt === undefined ||
      (source.publishedAt.length <= 120 && !control(source.publishedAt))) &&
    isoDate(source.retrievedAt) &&
    source.contentType.length <= 500 &&
    !control(source.contentType)
  );
}

function validSourceText(source: WebFetchSource, lines: unknown, text: string) {
  return (
    WEB_FETCH_SOURCE_FORMATS.includes(source.format) &&
    hash(source.bodySha256) &&
    hash(source.contentSha256) &&
    integerBetween(source.bodyBytes, 0, MAX_WEB_FETCH_BODY_BYTES) &&
    Array.isArray(lines) &&
    lines.length >= 1 &&
    lines.length <= MAX_WEB_FETCH_LINES &&
    lines.every((line) => typeof line === "string" && !lineControl(line)) &&
    source.lineCount === lines.length &&
    source.textChars === text.length &&
    source.textChars <= MAX_WEB_FETCH_CONTENT_CHARS &&
    typeof source.truncated === "boolean"
  );
}

function validSourceMetadata(source: WebFetchSource) {
  return (
    integerBetween(source.redirectCount, 0, PUBLIC_HTTP_MAX_REDIRECTS) &&
    (source.pageCount === undefined ||
      integerBetween(source.pageCount, 1, MAX_WEB_FETCH_PDF_PAGES)) &&
    (source.renderMode === "static" || source.renderMode === "browser_fallback")
  );
}

function validFallback(source: WebFetchSource): boolean {
  if (source.browserFallbackStatus === "used") {
    return (
      source.format === "html" &&
      source.renderMode === "browser_fallback" &&
      source.browserFallbackDiagnostic === undefined &&
      validFallbackEvidence(source.browserFallback)
    );
  }
  if (source.browserFallback !== undefined) return false;
  if (source.browserFallbackStatus === "unavailable") {
    return (
      source.format === "html" &&
      source.renderMode === "static" &&
      (source.browserFallbackDiagnostic === "browser_unavailable" ||
        source.browserFallbackDiagnostic === "browser_render_not_useful" ||
        source.browserFallbackDiagnostic === "fallback_limit_reached")
    );
  }
  return (
    source.browserFallbackStatus === "not_needed" &&
    source.renderMode === "static" &&
    source.browserFallbackDiagnostic === undefined
  );
}

function validFallbackEvidence(
  value: WebFetchSource["browserFallback"],
): boolean {
  const network = value?.network;
  return Boolean(
    value &&
    network &&
    exactKeys(value, [
      "sessionOperation",
      "sessionIdSha256",
      "activeTabId",
      "tabCount",
      "tabSetSha256",
      "browserExecutableSha256",
      "browserVersionSha256",
      "limitsSha256",
      "network",
    ]) &&
    exactKeys(network, [
      "requestCount",
      "connectCount",
      "rejectedCount",
      "transferredBytes",
      "destinationCount",
      "destinationsSha256",
    ]) &&
    integerBetween(value.sessionOperation, 1, MAX_BROWSER_SESSION_OPERATIONS) &&
    hash(value.sessionIdSha256) &&
    /^tab_[1-9][0-9]{0,3}$/u.test(value.activeTabId) &&
    integerBetween(value.tabCount, 1, 4) &&
    hash(value.tabSetSha256) &&
    hash(value.browserExecutableSha256) &&
    hash(value.browserVersionSha256) &&
    hash(value.limitsSha256) &&
    integerBetween(network.requestCount, 0, MAX_PROXY_REQUESTS) &&
    integerBetween(network.connectCount, 0, MAX_PROXY_REQUESTS) &&
    integerBetween(network.rejectedCount, 0, MAX_PROXY_REQUESTS) &&
    integerBetween(network.transferredBytes, 0, MAX_PROXY_TRANSFER_BYTES) &&
    integerBetween(network.destinationCount, 0, MAX_PROXY_REQUESTS) &&
    network.connectCount <= network.requestCount &&
    network.rejectedCount <= network.requestCount &&
    network.destinationCount <= network.requestCount &&
    hash(network.destinationsSha256),
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Web Fetch persisted Source must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function integerBetween(value: unknown, minimum: number, maximum: number) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function control(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function lineControl(value: string): boolean {
  return /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
    value,
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
