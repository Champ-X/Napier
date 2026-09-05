import type {
  NormalizedWebSearchRequest,
  WebSearchResult,
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
  record,
  recordArray,
  stripMarkup,
  tavilyTimeRange,
  text,
  unwrapDuckDuckGoUrl,
} from "./web-search-provider-utils.js";
import { webSearchQueryText } from "./web-search-model.js";
import type {
  PublicHttpRequester,
  WebSearchProvider,
} from "./web-search-provider-types.js";
import {
  webSearchFailure,
  webSearchRouteBinding,
} from "./web-search-failure.js";

export function createDefaultWebSearchProviders(
  http: PublicHttpRequester,
  env: Readonly<Record<string, string | undefined>>,
): readonly WebSearchProvider[] {
  return [
    new FirecrawlWebSearchProvider(http, env["FIRECRAWL_API_KEY"]),
    new BraveWebSearchProvider(http, env["BRAVE_API_KEY"]),
    new TavilyWebSearchProvider(
      http,
      env["TAVILY_API_KEY"] ?? env["TAVILY_API_KRY"],
    ),
    new BingWebSearchProvider(http),
    new DuckDuckGoWebSearchProvider(http),
  ];
}

class FirecrawlWebSearchProvider implements WebSearchProvider {
  readonly id = "firecrawl";
  readonly capabilities = ["general", "news"] as const;
  readonly supportsImages = false;

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
      throwProviderHttpFailure("firecrawl", response.status);
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
  readonly capabilities = ["general", "news", "images"] as const;
  readonly supportsImages = true;

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
    // Brave Images accepts only strict/off, while Web and News also accept
    // moderate. Preserve the caller's intent without sending an invalid image
    // endpoint parameter.
    url.searchParams.set(
      "safesearch",
      request.category === "images" && request.safeSearch !== "off"
        ? "strict"
        : braveSafeSearch(request.safeSearch),
    );
    if (request.timeRange)
      url.searchParams.set("freshness", braveFreshness(request.timeRange));
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
      throwProviderHttpFailure("brave", response.status);
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
      const properties = record(entry["properties"]);
      const thumbnail = record(entry["thumbnail"]);
      const imageUrl =
        request.category === "images" ? text(properties?.["url"]) : undefined;
      const thumbnailUrl =
        request.category === "images" ? text(thumbnail?.["src"]) : undefined;
      return [
        {
          title,
          url,
          ...(imageUrl ? { imageUrl } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
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
  readonly capabilities = ["general", "news"] as const;
  readonly supportsImages = false;

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
      throwProviderHttpFailure("tavily", response.status);
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
  readonly capabilities = ["general", "news"] as const;
  readonly supportsImages = false;

  constructor(private readonly http: PublicHttpRequester) {}

  available(): boolean {
    return true;
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
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
    if (request.timeRange)
      url.searchParams.set("freshness", bingFreshness(request.timeRange));
    const response = await this.http.request(
      {
        url: url.href,
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300)
      throwProviderHttpFailure("bing", response.status);
    const xml = response.body.toString("utf8");
    if (!/<rss\b/iu.test(xml))
      throw webSearchFailure(
        "Bing returned a non-RSS response",
        "route_network",
        webSearchRouteBinding("bing"),
      );
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
      const item = match[1] ?? "";
      const title = decodeXml(elementText(item, "title"));
      const url = decodeXml(elementText(item, "link"));
      if (!title || !url) return [];
      const snippet = decodeXml(elementText(item, "description"));
      const publishedAt = decodeXml(elementText(item, "pubDate"));
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
  readonly capabilities = ["general", "news"] as const;
  readonly supportsImages = false;

  constructor(private readonly http: PublicHttpRequester) {}

  available(): boolean {
    return true;
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    const form = new URLSearchParams({
      q: webSearchQueryText(request),
      kl: `${request.region.toLowerCase()}-${request.language.toLowerCase()}`,
      b: "",
    });
    if (request.timeRange)
      form.set("df", duckDuckGoFreshness(request.timeRange));
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
    if (response.status < 200 || response.status >= 300)
      throwProviderHttpFailure("duckduckgo", response.status);
    if (html.includes("anomaly-modal") || html.includes("anomaly.js")) {
      throw webSearchFailure(
        "DuckDuckGo returned a bot-detection challenge",
        "route_forbidden",
        webSearchRouteBinding("duckduckgo"),
      );
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

function throwProviderHttpFailure(provider: string, status: number): never {
  const label =
    provider === "firecrawl"
      ? "Firecrawl"
      : provider === "brave"
        ? "Brave"
        : provider === "tavily"
          ? "Tavily"
          : provider === "bing"
            ? "Bing"
            : provider === "duckduckgo"
              ? "DuckDuckGo"
              : provider;
  const mode =
    status === 401
      ? "route_unauthorized"
      : status === 403
        ? "route_forbidden"
        : status === 429
          ? "route_rate_limited"
          : status === 408 || status === 504
            ? "route_timeout"
            : "route_network";
  throw webSearchFailure(
    `${label} returned HTTP ${status}`,
    mode,
    webSearchRouteBinding(provider),
  );
}
