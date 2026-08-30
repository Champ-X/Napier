import { describe, expect, it, vi } from "vitest";

import type {
  PublicHttpRequest,
  PublicHttpResponse,
} from "../src/public-http-client.js";
import { normalizeWebSearchRequest } from "../src/web-search-model.js";
import {
  type PublicHttpRequester,
  WebSearchProviderRegistry,
} from "../src/web-search-providers.js";

describe("WebSearchProviderRegistry", () => {
  it("uses credentialed providers first and preserves stable result metadata", async () => {
    const http = requester(async (request) => {
      expect(request.url).toContain("api.search.brave.com");
      expect(request.headers).toEqual(
        expect.objectContaining({
          "x-subscription-token": "BRAVE_TEST_KEY",
        }),
      );
      return response(
        200,
        JSON.stringify({
          web: {
            results: [
              {
                title: "Official Napier documentation",
                url: "https://docs.example.com/napier#overview",
                description: "Primary documentation for Napier.",
                page_age: "2026-08-04",
              },
            ],
          },
        }),
        "application/json",
      );
    });
    const registry = new WebSearchProviderRegistry({
      env: { BRAVE_API_KEY: "BRAVE_TEST_KEY" },
      http,
      now: () => new Date("2026-08-04T10:00:00.000Z"),
    });

    await expect(
      registry.search(
        normalizeWebSearchRequest({
          query: "Napier documentation",
          site: "docs.example.com",
        }),
        AbortSignal.timeout(1_000),
      ),
    ).resolves.toEqual({
      provider: "brave",
      results: [
        {
          title: "Official Napier documentation",
          url: "https://docs.example.com/napier",
          snippet: "Primary documentation for Napier.",
          publishedAt: "2026-08-04",
          source: "Brave Search",
        },
      ],
      attempts: [
        {
          provider: "firecrawl",
          status: "unavailable",
          diagnostic: "firecrawl credentials are not configured",
        },
        { provider: "brave", status: "succeeded" },
      ],
      retrievedAt: "2026-08-04T10:00:00.000Z",
    });
  });

  it("falls back from unavailable and failed providers to credential-free search", async () => {
    const http = requester(async (request) => {
      if (request.url.includes("bing.com")) {
        return response(503, "temporarily unavailable", "text/plain");
      }
      expect(request.url).toBe("https://html.duckduckgo.com/html/");
      return response(
        200,
        duckDuckGoHtml([
          {
            title: "Napier release notes",
            url: "https://example.com/releases",
            snippet: "Current release details.",
          },
        ]),
        "text/html",
      );
    });
    const registry = new WebSearchProviderRegistry({
      env: {},
      http,
      now: () => new Date("2026-08-04T11:00:00.000Z"),
    });

    const result = await registry.search(
      normalizeWebSearchRequest({
        query: "Napier release notes",
        timeRange: "week",
      }),
      AbortSignal.timeout(1_000),
    );

    expect(result.provider).toBe("duckduckgo");
    expect(result.results).toEqual([
      {
        title: "Napier release notes",
        url: "https://example.com/releases",
        snippet: "Current release details.",
        source: "DuckDuckGo",
      },
    ]);
    expect(result.attempts).toEqual([
      {
        provider: "firecrawl",
        status: "unavailable",
        diagnostic: "firecrawl credentials are not configured",
      },
      {
        provider: "brave",
        status: "unavailable",
        diagnostic: "brave credentials are not configured",
      },
      {
        provider: "tavily",
        status: "unavailable",
        diagnostic: "tavily credentials are not configured",
      },
      {
        provider: "bing",
        status: "failed",
        diagnostic: "Bing returned HTTP 503",
      },
      { provider: "duckduckgo", status: "succeeded" },
    ]);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it("parses credential-free Bing RSS and deduplicates public URLs", async () => {
    const http = requester(async (request) => {
      expect(request.url).toContain("format=rss");
      expect(request.url).toContain("cc=US");
      expect(request.url).toContain("mkt=en-US");
      return response(
        200,
        `<?xml version="1.0"?><rss version="2.0"><channel>
          <item><title>First &amp; primary</title><link>https://example.com/a#one</link><description>One &lt;b&gt;result&lt;/b&gt;.</description><pubDate>Tue, 04 Aug 2026 08:00:00 GMT</pubDate></item>
          <item><title>Duplicate</title><link>https://example.com/a#two</link><description>Duplicate.</description></item>
          <item><title>Private target</title><link>http://127.0.0.1/secret</link><description>Unsafe.</description></item>
        </channel></rss>`,
        "application/rss+xml",
      );
    });
    const registry = new WebSearchProviderRegistry({ env: {}, http });

    const result = await registry.search(
      normalizeWebSearchRequest({
        query: "current result",
        provider: "bing",
      }),
      AbortSignal.timeout(1_000),
    );

    expect(result.provider).toBe("bing");
    expect(result.results).toEqual([
      {
        title: "First & primary",
        url: "https://example.com/a",
        snippet: "One result.",
        publishedAt: "Tue, 04 Aug 2026 08:00:00 GMT",
        source: "Bing",
      },
    ]);
  });

  it("does not silently fall back when the caller explicitly selects a provider", async () => {
    const http = requester(async () =>
      response(429, "rate limited", "text/plain"),
    );
    const registry = new WebSearchProviderRegistry({ env: {}, http });

    await expect(
      registry.search(
        normalizeWebSearchRequest({
          query: "explicit provider",
          provider: "bing",
        }),
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow(
      "Web search failed after 1 provider attempt (bing: Bing returned HTTP 429)",
    );
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("rejects provider results outside an explicit site constraint", async () => {
    const http = requester(async (request) => {
      if (request.url.includes("bing.com")) {
        return response(
          200,
          `<?xml version="1.0"?><rss version="2.0"><channel>
            <item><title>Ignored provider constraint</title><link>https://outside.example/result</link><description>Wrong domain.</description></item>
          </channel></rss>`,
          "application/rss+xml",
        );
      }
      return response(
        200,
        duckDuckGoHtml([
          {
            title: "Official constrained result",
            url: "https://docs.example.com/result",
            snippet: "Expected domain.",
          },
        ]),
        "text/html",
      );
    });
    const registry = new WebSearchProviderRegistry({ env: {}, http });

    const result = await registry.search(
      normalizeWebSearchRequest({
        query: "official result",
        site: "example.com",
      }),
      AbortSignal.timeout(1_000),
    );

    expect(result.provider).toBe("duckduckgo");
    expect(result.results[0]?.url).toBe("https://docs.example.com/result");
    expect(result.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "bing",
          status: "failed",
          diagnostic: "provider returned no usable public results",
        }),
      ]),
    );
  });

  it("supports configured Tavily news search without exposing the API key in errors", async () => {
    const testApiKey = "TAVILY_TEST_KEY";
    const http = requester(async (request) => {
      expect(request.body).toContain('"topic":"news"');
      expect(request.headers?.["authorization"]).toBe(`Bearer ${testApiKey}`);
      return response(401, `invalid ${testApiKey}`, "text/plain");
    });
    const registry = new WebSearchProviderRegistry({
      env: { TAVILY_API_KEY: testApiKey },
      http,
    });

    await expect(
      registry.search(
        normalizeWebSearchRequest({
          query: "today's platform news",
          category: "news",
          provider: "tavily",
        }),
        AbortSignal.timeout(1_000),
      ),
    ).rejects.not.toThrow(testApiKey);
  });

  it("accepts the legacy TAVILY_API_KRY name and prefers the standard name", async () => {
    const observed: string[] = [];
    const http = requester(async (request) => {
      observed.push(request.headers?.["authorization"] ?? "");
      return response(
        200,
        JSON.stringify({
          results: [
            {
              title: "Napier result",
              url: "https://example.com/result",
              content: "Current result.",
            },
          ],
        }),
        "application/json",
      );
    });

    await new WebSearchProviderRegistry({
      env: { TAVILY_API_KRY: "LEGACY_KEY" },
      http,
    }).search(
      normalizeWebSearchRequest({ query: "legacy", provider: "tavily" }),
      AbortSignal.timeout(1_000),
    );
    await new WebSearchProviderRegistry({
      env: {
        TAVILY_API_KEY: "STANDARD_KEY",
        TAVILY_API_KRY: "LEGACY_KEY",
      },
      http,
    }).search(
      normalizeWebSearchRequest({ query: "standard", provider: "tavily" }),
      AbortSignal.timeout(1_000),
    );

    expect(observed).toEqual(["Bearer LEGACY_KEY", "Bearer STANDARD_KEY"]);
  });
  it("prefers Firecrawl when its key is configured and maps web results", async () => {
    const http = requester(async (request) => {
      expect(request.url).toBe("https://api.firecrawl.dev/v2/search");
      expect(request.headers?.["authorization"]).toBe("Bearer FIRECRAWL_KEY");
      expect(request.body).toContain('"sources":[{"type":"web"}]');
      return response(
        200,
        JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: "Napier overview",
                url: "https://docs.example.com/napier",
                description: "Primary Napier documentation.",
              },
            ],
          },
        }),
        "application/json",
      );
    });
    const registry = new WebSearchProviderRegistry({
      env: { FIRECRAWL_API_KEY: "FIRECRAWL_KEY", BRAVE_API_KEY: "BRAVE_KEY" },
      http,
      now: () => new Date("2026-08-04T10:00:00.000Z"),
    });

    const result = await registry.search(
      normalizeWebSearchRequest({ query: "napier docs", provider: "auto" }),
      AbortSignal.timeout(1_000),
    );
    expect(result.provider).toBe("firecrawl");
    expect(result.results).toEqual([
      {
        title: "Napier overview",
        url: "https://docs.example.com/napier",
        snippet: "Primary Napier documentation.",
        source: "Firecrawl",
      },
    ]);
    expect(result.attempts).toEqual([
      { provider: "firecrawl", status: "succeeded" },
    ]);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("does not expose the Firecrawl key in errors", async () => {
    const testApiKey = "FIRECRAWL_SECRET_KEY";
    const http = requester(async (request) => {
      expect(request.headers?.["authorization"]).toBe(`Bearer ${testApiKey}`);
      return response(500, `boom ${testApiKey}`, "text/plain");
    });
    const registry = new WebSearchProviderRegistry({
      env: { FIRECRAWL_API_KEY: testApiKey },
      http,
    });

    await expect(
      registry.search(
        normalizeWebSearchRequest({
          query: "release notes",
          provider: "firecrawl",
        }),
        AbortSignal.timeout(1_000),
      ),
    ).rejects.not.toThrow(testApiKey);
  });
});

function requester(
  implementation: (request: PublicHttpRequest) => Promise<PublicHttpResponse>,
): PublicHttpRequester & {
  request: ReturnType<typeof vi.fn<typeof implementation>>;
} {
  return { request: vi.fn(implementation) };
}

function response(
  status: number,
  body: string,
  contentType: string,
): PublicHttpResponse {
  return {
    status,
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    finalUrl: "https://provider.example/search",
    redirectCount: 0,
  };
}

function duckDuckGoHtml(
  entries: Array<{ title: string; url: string; snippet: string }>,
): string {
  return entries
    .map(
      (entry) => `<div class="result results_links">
        <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(entry.url)}">${entry.title}</a></h2>
        <a class="result__snippet">${entry.snippet}</a>
      </div>`,
    )
    .join("");
}
