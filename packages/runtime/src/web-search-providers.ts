import {
  PublicHttpClient,
  type PublicHttpRequest,
  type PublicHttpResponse,
} from "./public-http-client.js";
import {
  type NormalizedWebSearchRequest,
  type WebSearchProviderAttempt,
  type WebSearchProviderId,
  type WebSearchResponse,
  type WebSearchResult,
  webSearchQueryText,
} from "./web-search-model.js";
import {
  bingFreshness,
  braveFreshness,
  braveSafeSearch,
  decodeHtml,
  decodeXml,
  duckDuckGoFreshness,
  elementText,
  firecrawlTimeBasedSearch,
  jsonRecord,
  providerDiagnostic,
  record,
  recordArray,
  sanitizeWebSearchResults,
  stripMarkup,
  tavilyTimeRange,
  text,
  throwIfSearchAborted,
  unwrapDuckDuckGoUrl,
} from "./web-search-provider-utils.js";

interface WebSearchProvider {
  readonly id: WebSearchProviderId;
  available(): boolean;
  search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]>;
}

export interface PublicHttpRequester {
  request(
    request: PublicHttpRequest,
    signal?: AbortSignal,
  ): Promise<PublicHttpResponse>;
}

export interface WebSearchProviderRegistryOptions {
  env?: Readonly<Record<string, string | undefined>>;
  http?: PublicHttpRequester;
  providers?: readonly WebSearchProvider[];
  now?: () => Date;
}

export class WebSearchProviderRegistry {
  private readonly providers: readonly WebSearchProvider[];
  private readonly now: () => Date;

  constructor(options: WebSearchProviderRegistryOptions = {}) {
    const env = options.env ?? process.env;
    const http = options.http ?? new PublicHttpClient();
    this.providers = options.providers ?? [
      new FirecrawlWebSearchProvider(http, env["FIRECRAWL_API_KEY"]),
      new BraveWebSearchProvider(http, env["BRAVE_API_KEY"]),
      new TavilyWebSearchProvider(
        http,
        env["TAVILY_API_KEY"] ?? env["TAVILY_API_KRY"],
      ),
      new BingWebSearchProvider(http),
      new DuckDuckGoWebSearchProvider(http),
    ];
    this.now = options.now ?? (() => new Date());
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResponse> {
    const candidates =
      request.provider === "auto"
        ? this.providers
        : this.providers.filter((provider) => provider.id === request.provider);
    if (candidates.length === 0) {
      throw new Error(
        `Web search provider is not installed: ${request.provider}`,
      );
    }
    const attempts: WebSearchProviderAttempt[] = [];
    for (const provider of candidates) {
      throwIfSearchAborted(signal);
      if (!provider.available()) {
        attempts.push({
          provider: provider.id,
          status: "unavailable",
          diagnostic: `${provider.id} credentials are not configured`,
        });
        continue;
      }
      try {
        const results = sanitizeWebSearchResults(
          await provider.search(request, signal),
          request.count,
          request.site,
        );
        if (results.length === 0) {
          throw new Error("provider returned no usable public results");
        }
        attempts.push({ provider: provider.id, status: "succeeded" });
        return {
          provider: provider.id,
          results,
          attempts,
          retrievedAt: this.now().toISOString(),
        };
      } catch (error) {
        throwIfSearchAborted(signal);
        attempts.push({
          provider: provider.id,
          status: "failed",
          diagnostic: providerDiagnostic(error),
        });
        if (request.provider !== "auto") break;
      }
    }
    const summary = attempts
      .map(
        (attempt) =>
          `${attempt.provider}: ${attempt.diagnostic ?? attempt.status}`,
      )
      .join("; ");
    throw new Error(
      `Web search failed after ${attempts.length} provider attempt${attempts.length === 1 ? "" : "s"}${summary ? ` (${summary})` : ""}`,
    );
  }
}

class FirecrawlWebSearchProvider implements WebSearchProvider {
  readonly id = "firecrawl";

  constructor(
    private readonly http: PublicHttpRequester,
    private readonly apiKey: string | undefined,
  ) {}

  available(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    if (request.category === "images") {
      throw new Error("Firecrawl web search does not return image results");
    }
    const news = request.category === "news";
    const response = await this.http.request(
      {
        url: "https://api.firecrawl.dev/v2/search",
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey!.trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: webSearchQueryText(request),
          limit: request.count,
          sources: [{ type: news ? "news" : "web" }],
          ...(request.timeRange
            ? { tbs: firecrawlTimeBasedSearch(request.timeRange) }
            : {}),
        }),
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Firecrawl returned HTTP ${response.status}`);
    }
    const data = record(jsonRecord(response.body)["data"]) ?? {};
    const entries = news ? recordArray(data["news"]) : recordArray(data["web"]);
    return entries.flatMap((entry) => {
      const url = text(entry["url"]);
      const title = text(entry["title"]);
      if (!url || !title) return [];
      const snippet = text(entry["snippet"]) ?? text(entry["description"]);
      const publishedAt = text(entry["date"]);
      return [
        {
          title,
          url,
          ...(snippet ? { snippet } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          source: "Firecrawl",
        },
      ];
    });
  }
}

class BraveWebSearchProvider implements WebSearchProvider {
  readonly id = "brave";

  constructor(
    private readonly http: PublicHttpRequester,
    private readonly apiKey: string | undefined,
  ) {}

  available(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    const endpoint =
      request.category === "images"
        ? "https://api.search.brave.com/res/v1/images/search"
        : request.category === "news"
          ? "https://api.search.brave.com/res/v1/news/search"
          : "https://api.search.brave.com/res/v1/web/search";
    const url = new URL(endpoint);
    url.searchParams.set("q", webSearchQueryText(request));
    url.searchParams.set("count", String(request.count));
    url.searchParams.set("country", request.region);
    url.searchParams.set("search_lang", request.language);
    url.searchParams.set("safesearch", braveSafeSearch(request.safeSearch));
    if (request.timeRange) {
      url.searchParams.set("freshness", braveFreshness(request.timeRange));
    }
    const response = await this.http.request(
      {
        url: url.href,
        headers: {
          accept: "application/json",
          "x-subscription-token": this.apiKey!.trim(),
        },
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Brave returned HTTP ${response.status}`);
    }
    const body = jsonRecord(response.body);
    const entries =
      request.category === "images"
        ? recordArray(body["results"])
        : recordArray(
            record(body[request.category === "news" ? "news" : "web"])?.[
              "results"
            ],
          );
    return entries.flatMap((entry) => {
      const url = text(entry["url"]) ?? text(entry["page_url"]);
      const title = text(entry["title"]) ?? text(entry["name"]);
      if (!url || !title) return [];
      return [
        {
          title,
          url,
          ...(text(entry["description"])
            ? { snippet: text(entry["description"])! }
            : {}),
          ...(text(entry["page_age"])
            ? { publishedAt: text(entry["page_age"])! }
            : {}),
          source: "Brave Search",
        },
      ];
    });
  }
}

class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id = "tavily";

  constructor(
    private readonly http: PublicHttpRequester,
    private readonly apiKey: string | undefined,
  ) {}

  available(): boolean {
    return Boolean(this.apiKey?.trim());
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    if (request.category === "images") {
      throw new Error("Tavily does not provide image search results");
    }
    const response = await this.http.request(
      {
        url: "https://api.tavily.com/search",
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey!.trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: webSearchQueryText(request),
          topic: request.category === "news" ? "news" : "general",
          search_depth: "basic",
          max_results: request.count,
          include_answer: false,
          include_raw_content: false,
          ...(request.timeRange
            ? { time_range: tavilyTimeRange(request.timeRange) }
            : {}),
        }),
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Tavily returned HTTP ${response.status}`);
    }
    return recordArray(jsonRecord(response.body)["results"]).flatMap(
      (entry) => {
        const url = text(entry["url"]);
        const title = text(entry["title"]);
        if (!url || !title) return [];
        return [
          {
            title,
            url,
            ...(text(entry["content"])
              ? { snippet: text(entry["content"])! }
              : {}),
            ...(text(entry["published_date"])
              ? { publishedAt: text(entry["published_date"])! }
              : {}),
            source: "Tavily",
          },
        ];
      },
    );
  }
}

class BingWebSearchProvider implements WebSearchProvider {
  readonly id = "bing";

  constructor(private readonly http: PublicHttpRequester) {}

  available(): boolean {
    return true;
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    if (request.category === "images") {
      throw new Error("Bing RSS does not provide image search results");
    }
    const url = new URL(
      request.category === "news"
        ? "https://www.bing.com/news/search"
        : "https://www.bing.com/search",
    );
    url.searchParams.set("q", webSearchQueryText(request));
    url.searchParams.set("format", "rss");
    url.searchParams.set("setlang", `${request.language}-${request.region}`);
    url.searchParams.set("cc", request.region);
    url.searchParams.set("mkt", `${request.language}-${request.region}`);
    if (request.timeRange) {
      url.searchParams.set("freshness", bingFreshness(request.timeRange));
    }
    const response = await this.http.request(
      {
        url: url.href,
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Bing returned HTTP ${response.status}`);
    }
    const xml = response.body.toString("utf8");
    if (!/<rss\b/iu.test(xml)) {
      throw new Error("Bing returned a non-RSS response");
    }
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
      const item = match[1] ?? "";
      const title = decodeXml(elementText(item, "title"));
      const url = decodeXml(elementText(item, "link"));
      if (!title || !url) return [];
      const snippet = decodeXml(elementText(item, "description"));
      const publishedAt = decodeXml(
        elementText(item, request.category === "news" ? "pubDate" : "pubDate"),
      );
      return [
        {
          title,
          url,
          ...(snippet ? { snippet: stripMarkup(snippet) } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          source: "Bing",
        },
      ];
    });
  }
}

class DuckDuckGoWebSearchProvider implements WebSearchProvider {
  readonly id = "duckduckgo";

  constructor(private readonly http: PublicHttpRequester) {}

  available(): boolean {
    return true;
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    if (request.category === "images") {
      throw new Error("DuckDuckGo HTML does not provide image search results");
    }
    const form = new URLSearchParams({
      q: webSearchQueryText(request),
      kl: `${request.region.toLowerCase()}-${request.language.toLowerCase()}`,
      b: "",
    });
    if (request.timeRange) {
      form.set("df", duckDuckGoFreshness(request.timeRange));
    }
    const response = await this.http.request(
      {
        url: "https://html.duckduckgo.com/html/",
        method: "POST",
        headers: {
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          referer: "https://html.duckduckgo.com/",
        },
        body: form.toString(),
      },
      signal,
    );
    const html = response.body.toString("utf8");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
    }
    if (html.includes("anomaly-modal") || html.includes("anomaly.js")) {
      throw new Error("DuckDuckGo returned a bot-detection challenge");
    }
    const results: WebSearchResult[] = [];
    const blockPattern =
      /<div\b[^>]*\bclass="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass="[^"]*\bresult\b|<div\b[^>]*\bclass="[^"]*\bnav-link\b|$)/giu;
    for (const blockMatch of html.matchAll(blockPattern)) {
      const block = blockMatch[1] ?? "";
      const titleMatch =
        /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/iu.exec(
          block,
        );
      if (!titleMatch) continue;
      const url = unwrapDuckDuckGoUrl(titleMatch[1] ?? "");
      const title = decodeHtml(titleMatch[2] ?? "");
      if (!url || !title) continue;
      const snippetMatch =
        /<(?:a|div|span)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/iu.exec(
          block,
        );
      const snippet = decodeHtml(snippetMatch?.[1] ?? "");
      results.push({
        title,
        url,
        ...(snippet ? { snippet } : {}),
        source: "DuckDuckGo",
      });
    }
    return results;
  }
}

export type { WebSearchProvider };
