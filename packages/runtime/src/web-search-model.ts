import { canonicalJson, sha256 } from "./ed25519.js";

export const WEB_SEARCH_PROVIDER_IDS = [
  "firecrawl",
  "brave",
  "tavily",
  "bing",
  "duckduckgo",
] as const;

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];
export type WebSearchCategory = "general" | "news" | "images";
export type WebSearchTimeRange = "day" | "week" | "month" | "year";
export type WebSearchSafeSearch = "strict" | "moderate" | "off";

export interface WebSearchRequest {
  query: string;
  category?: WebSearchCategory;
  timeRange?: WebSearchTimeRange;
  language?: string;
  region?: string;
  site?: string;
  count?: number;
  safeSearch?: WebSearchSafeSearch;
  provider?: "auto" | WebSearchProviderId;
}

export interface NormalizedWebSearchRequest {
  query: string;
  category: WebSearchCategory;
  timeRange?: WebSearchTimeRange;
  language: string;
  region: string;
  site?: string;
  count: number;
  safeSearch: WebSearchSafeSearch;
  provider: "auto" | WebSearchProviderId;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  source: string;
}

export interface WebSearchProviderAttempt {
  provider: WebSearchProviderId;
  status: "succeeded" | "failed" | "unavailable" | "unsupported";
  diagnostic?: string;
}

export interface WebSearchResponse {
  provider: WebSearchProviderId;
  results: WebSearchResult[];
  attempts: WebSearchProviderAttempt[];
  retrievedAt: string;
}

export interface WebSearchToolDetails {
  kind: "napier.web-search";
  schemaVersion: 1;
  provider: WebSearchProviderId;
  category: WebSearchCategory;
  resultCount: number;
  attemptedProviderCount: number;
  failedProviderCount: number;
  unavailableProviderCount: number;
  querySha256: string;
  resultSetSha256: string;
  retrievedAt: string;
}

export interface WebSearchExecutor {
  search(
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResponse>;
}

export function normalizeWebSearchRequest(
  request: WebSearchRequest,
): NormalizedWebSearchRequest {
  const query = request.query.replace(/\s+/gu, " ").trim();
  if (!query || query.length > 500) {
    throw new Error("Web search query must be 1-500 characters");
  }
  const category = request.category ?? "general";
  const language = normalizeLocalePart(request.language, "en", 2, 16);
  const region = normalizeLocalePart(request.region, "US", 2, 8).toUpperCase();
  const site = request.site?.trim().toLowerCase();
  if (
    site &&
    (site.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(site))
  ) {
    throw new Error("Web search site must be a valid DNS hostname");
  }
  const count = request.count ?? 8;
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("Web search count must be an integer from 1 to 20");
  }
  const provider = request.provider ?? "auto";
  if (
    provider !== "auto" &&
    !WEB_SEARCH_PROVIDER_IDS.includes(provider as WebSearchProviderId)
  ) {
    throw new Error("Web search provider is unsupported");
  }
  return {
    query,
    category,
    ...(request.timeRange ? { timeRange: request.timeRange } : {}),
    language,
    region,
    ...(site ? { site } : {}),
    count,
    safeSearch: request.safeSearch ?? "moderate",
    provider,
  };
}

export function webSearchQueryText(
  request: NormalizedWebSearchRequest,
): string {
  return request.site ? `${request.query} site:${request.site}` : request.query;
}

export function webSearchResultSetSha256(
  results: readonly WebSearchResult[],
): string {
  return sha256(
    canonicalJson(
      results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet ?? "",
        publishedAt: result.publishedAt ?? "",
        source: result.source,
      })),
    ),
  );
}

function normalizeLocalePart(
  value: string | undefined,
  fallback: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = value?.trim() || fallback;
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/u.test(normalized)
  ) {
    throw new Error("Web search locale constraint is invalid");
  }
  return normalized;
}
