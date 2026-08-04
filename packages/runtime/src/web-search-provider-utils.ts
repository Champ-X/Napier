import { validatePublicHttpUrl } from "./public-network.js";
import type {
  NormalizedWebSearchRequest,
  WebSearchResult,
} from "./web-search-model.js";

export function sanitizeWebSearchResults(
  input: readonly WebSearchResult[],
  limit: number,
  site?: string,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const candidate of input) {
    let url: URL;
    try {
      url = validatePublicHttpUrl(candidate.url);
    } catch {
      continue;
    }
    if (site && !matchesSite(url.hostname, site)) continue;
    url.hash = "";
    const key = url.href;
    if (seen.has(key)) continue;
    const title = boundedText(candidate.title, 300);
    if (!title) continue;
    seen.add(key);
    results.push({
      title,
      url: key,
      ...(candidate.snippet
        ? { snippet: boundedText(candidate.snippet, 1_000) }
        : {}),
      ...(candidate.publishedAt
        ? { publishedAt: boundedText(candidate.publishedAt, 120) }
        : {}),
      source: boundedText(candidate.source, 120),
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function braveSafeSearch(
  value: NormalizedWebSearchRequest["safeSearch"],
): string {
  return value === "off" ? "off" : value === "strict" ? "strict" : "moderate";
}

export function braveFreshness(
  value: NonNullable<NormalizedWebSearchRequest["timeRange"]>,
): string {
  return { day: "pd", week: "pw", month: "pm", year: "py" }[value];
}

export function tavilyTimeRange(
  value: NonNullable<NormalizedWebSearchRequest["timeRange"]>,
): string {
  return { day: "day", week: "week", month: "month", year: "year" }[value];
}

export function bingFreshness(
  value: NonNullable<NormalizedWebSearchRequest["timeRange"]>,
): string {
  return { day: "Day", week: "Week", month: "Month", year: "Year" }[value];
}

export function duckDuckGoFreshness(
  value: NonNullable<NormalizedWebSearchRequest["timeRange"]>,
): string {
  return { day: "d", week: "w", month: "m", year: "y" }[value];
}

export function elementText(xml: string, name: string): string {
  return (
    new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "iu").exec(xml)?.[1] ?? ""
  );
}

export function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/gu, "")
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .trim();
}

export function decodeHtml(value: string): string {
  return stripMarkup(decodeXml(value).replace(/&nbsp;/giu, " "));
}

export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

export function unwrapDuckDuckGoUrl(value: string): string | undefined {
  const decoded = value.replace(/&amp;/giu, "&");
  const wrapped = /[?&]uddg=([^&]+)/u.exec(decoded);
  if (wrapped) {
    try {
      return decodeURIComponent(wrapped[1] ?? "");
    } catch {
      return undefined;
    }
  }
  if (decoded.startsWith("//")) return `https:${decoded}`;
  return /^https?:\/\//iu.test(decoded) ? decoded : undefined;
}

export function jsonRecord(value: Buffer): Record<string, unknown> {
  const parsed = JSON.parse(value.toString("utf8")) as unknown;
  const result = record(parsed);
  if (!result) throw new Error("Search provider returned invalid JSON");
  return result;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const item = record(entry);
        return item ? [item] : [];
      })
    : [];
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function providerDiagnostic(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "unknown provider error";
  return message
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]")
    .slice(0, 300);
}

export function throwIfSearchAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Web search was cancelled");
}

function matchesSite(hostname: string, site: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/u, "");
  const normalizedSite = site.toLowerCase().replace(/\.$/u, "");
  return (
    normalizedHostname === normalizedSite ||
    normalizedHostname.endsWith(`.${normalizedSite}`)
  );
}

function boundedText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= limit ? normalized : normalized.slice(0, limit);
}
