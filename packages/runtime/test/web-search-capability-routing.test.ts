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
import { createWebSearchTool } from "../src/web-search-tool.js";

describe("Web Search capability routing", () => {
  it("negotiates auto image requests to successful page candidates", async () => {
    const http = requester(async (request) => {
      expect(request.url).toContain("bing.com/search");
      return response(
        200,
        `<?xml version="1.0"?><rss version="2.0"><channel>
          <item><title>Official poster page</title><link>https://official.example/poster</link><description>Official page containing the poster artwork.</description></item>
        </channel></rss>`,
        "application/rss+xml",
      );
    });
    const registry = new WebSearchProviderRegistry({ env: {}, http });

    const result = await registry.search(
      normalizeWebSearchRequest({
        query: "FIFA official poster",
        category: "images",
      }),
      AbortSignal.timeout(1_000),
    );

    expect(result).toEqual(
      expect.objectContaining({
        provider: "bing",
        resolution: {
          requestedCategory: "images",
          resolvedCategory: "general",
          mode: "image_page_candidates",
        },
        results: [
          expect.objectContaining({
            title: "Official poster page",
            url: "https://official.example/poster",
          }),
        ],
      }),
    );
    expect(result.results[0]).not.toHaveProperty("imageUrl");
    expect(http.request).toHaveBeenCalledOnce();
  });

  it("keeps explicit image provider requests fail-closed", async () => {
    const http = requester(async () =>
      response(500, "must not be called", "text/plain"),
    );
    const registry = new WebSearchProviderRegistry({ env: {}, http });

    await expect(
      registry.search(
        normalizeWebSearchRequest({
          query: "FIFA official poster",
          category: "images",
          provider: "brave",
        }),
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow("no configured provider can return image results");
    expect(http.request).not.toHaveBeenCalled();
  });

  it("labels negotiated page candidates in output and details", async () => {
    const tool = createWebSearchTool({
      search: async () => ({
        provider: "bing",
        results: [
          {
            title: "Official poster page",
            url: "https://official.example/poster",
            source: "Bing",
          },
        ],
        attempts: [{ provider: "bing", status: "succeeded" }],
        retrievedAt: "2026-09-03T12:00:00.000Z",
        resolution: {
          requestedCategory: "images",
          resolvedCategory: "general",
          mode: "image_page_candidates",
        },
      }),
    });

    const result = await tool.execute("call_image_candidates", {
      query: "official poster",
      category: "images",
    });

    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("not direct image files or thumbnails"),
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        category: "images",
        resolvedCategory: "general",
        resolutionMode: "image_page_candidates",
      }),
    );
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
