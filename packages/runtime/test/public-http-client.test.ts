import { describe, expect, it, vi } from "vitest";

import {
  PublicHttpClient,
  type PublicHttpTransport,
} from "../src/public-http-client.js";

describe("PublicHttpClient", () => {
  it("pins every request to a validated public address and revalidates redirects", async () => {
    const transport = vi.fn<PublicHttpTransport>(async (request) => {
      if (request.url.hostname === "search.example") {
        return {
          status: 302,
          headers: { location: "https://results.example/final" },
          body: Buffer.alloc(0),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("ok"),
      };
    });
    const lookup = vi.fn(async (hostname: string) => [
      {
        address:
          hostname === "search.example" ? "203.0.114.10" : "203.0.114.11",
        family: 4 as const,
      },
    ]);
    const client = new PublicHttpClient({ lookup, transport });

    await expect(
      client.request({
        url: "https://search.example/query",
        headers: { authorization: "Bearer SEARCH_SECRET" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 200,
        finalUrl: "https://results.example/final",
        redirectCount: 1,
        body: Buffer.from("ok"),
      }),
    );
    expect(lookup).toHaveBeenNthCalledWith(1, "search.example");
    expect(lookup).toHaveBeenNthCalledWith(2, "results.example");
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resolution: expect.objectContaining({
          addresses: [{ address: "203.0.114.10", family: 4 }],
        }),
        headers: expect.objectContaining({
          authorization: "Bearer SEARCH_SECRET",
        }),
      }),
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resolution: expect.objectContaining({
          addresses: [{ address: "203.0.114.11", family: 4 }],
        }),
        headers: expect.not.objectContaining({
          authorization: expect.anything(),
        }),
      }),
    );
  });

  it("blocks private, mixed-DNS, credential-bearing, and unsafe redirect targets before transport", async () => {
    const transport = vi.fn<PublicHttpTransport>(async () => ({
      status: 302,
      headers: { location: "http://127.0.0.1/metadata" },
      body: Buffer.alloc(0),
    }));
    const client = new PublicHttpClient({
      lookup: async (hostname) =>
        hostname === "mixed.example"
          ? [
              { address: "203.0.114.10", family: 4 },
              { address: "127.0.0.1", family: 4 },
            ]
          : [{ address: "203.0.114.10", family: 4 }],
      transport,
    });

    await expect(
      client.request({ url: "http://127.0.0.1/private" }),
    ).rejects.toThrow("private or reserved");
    await expect(
      client.request({ url: "https://mixed.example/private" }),
    ).rejects.toThrow("private or reserved");
    await expect(
      client.request({ url: "https://user:pass@public.example/" }),
    ).rejects.toThrow("credentials");
    await expect(
      client.request({ url: "https://public.example/start" }),
    ).rejects.toThrow("private or reserved");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("propagates cancellation without attempting another redirect", async () => {
    const controller = new AbortController();
    const transport = vi.fn<PublicHttpTransport>(async () => {
      controller.abort(new Error("operator cancelled search"));
      return {
        status: 302,
        headers: { location: "https://other.example/" },
        body: Buffer.alloc(0),
      };
    });
    const client = new PublicHttpClient({
      lookup: async () => [{ address: "203.0.114.10", family: 4 }],
      transport,
    });

    await expect(
      client.request({ url: "https://search.example/" }, controller.signal),
    ).rejects.toThrow("operator cancelled search");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("enforces the response byte limit for injected transports", async () => {
    const client = new PublicHttpClient({
      lookup: async () => [{ address: "203.0.114.10", family: 4 }],
      transport: async () => ({
        status: 200,
        headers: { "content-length": "9" },
        body: Buffer.from("oversized"),
      }),
    });

    await expect(
      client.request({
        url: "https://search.example/",
        maxResponseBytes: 8,
      }),
    ).rejects.toThrow("response exceeds byte limit");
  });
});
