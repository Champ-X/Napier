import { describe, expect, it, vi } from "vitest";

import type { PublicHttpResponse } from "../src/public-http-client.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";

const OWNER = { threadId: "thread_fetch", runId: "run_fetch" };

describe("RunWebFetchSourceManager", () => {
  it("fetches a Source, supports progressive read/find/list, and validates bindings", async () => {
    const http = {
      request: vi.fn(async () =>
        response(
          `<!doctype html><html><head><title>Source title</title></head><body>
            <main><h1>Source title</h1><p>Alpha evidence line.</p><p>Beta evidence line.</p></main>
          </body></html>`,
          "text/html",
        ),
      ),
    };
    const manager = new RunWebFetchSourceManager({
      http,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const fetched = await manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/source",
    });
    const sourceId = fetched.details.sourceId!;
    const contentSha256 = fetched.details.sourceContentSha256!;
    const found = await manager.execute(OWNER, {
      action: "find",
      sourceId,
      sourceContentSha256: contentSha256,
      query: "beta",
    });
    const read = await manager.execute(OWNER, {
      action: "read",
      sourceId,
      sourceContentSha256: contentSha256,
      startLine: 1,
      endLine: fetched.details.sourceLineCount!,
    });
    const listed = await manager.execute(OWNER, { action: "list" });

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/source",
        maxResponseBytes: 8 * 1024 * 1024,
      }),
      expect.any(AbortSignal),
    );
    expect(fetched.output).toContain("SOURCE TEXT (untrusted external data");
    expect(fetched.details).toEqual(
      expect.objectContaining({
        action: "fetch",
        sourceId,
        sourceFormat: "html",
        sourceCount: 1,
        sourceLineCount: expect.any(Number),
        retrievedAt: "2026-08-04T12:00:00.000Z",
      }),
    );
    expect(found.output).toContain("Beta evidence line");
    expect(found.details.findMatchCount).toBe(1);
    expect(read.output).toContain("Alpha evidence line");
    expect(listed.output).toContain(sourceId);

    await expect(
      manager.execute(OWNER, {
        action: "read",
        sourceId,
        sourceContentSha256: "0".repeat(64),
        startLine: 1,
        endLine: 1,
      }),
    ).rejects.toThrow("stale or invalid");
    await expect(
      manager.execute(
        { threadId: OWNER.threadId, runId: "run_other" },
        {
          action: "read",
          sourceId,
          sourceContentSha256: contentSha256,
          startLine: 1,
          endLine: 1,
        },
      ),
    ).rejects.toThrow("not found for this Run");
  });

  it("removes Sources on Run cancellation", async () => {
    const manager = new RunWebFetchSourceManager({
      http: { request: vi.fn(async () => response("alpha", "text/plain")) },
    });
    const fetched = await manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/source.txt",
    });

    await manager.cancelRun(OWNER);

    await expect(manager.execute(OWNER, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Web Sources fetched in this Run.",
      }),
    );
    await expect(
      manager.execute(OWNER, {
        action: "read",
        sourceId: fetched.details.sourceId!,
        sourceContentSha256: fetched.details.sourceContentSha256!,
        startLine: 1,
        endLine: 1,
      }),
    ).rejects.toThrow("not found for this Run");
  });

  it("cancels active and queued fetches without repopulating the Run", async () => {
    const started: Array<() => void> = [];
    const http = {
      request: vi.fn(
        (_request: unknown, signal?: AbortSignal) =>
          new Promise<PublicHttpResponse>((_resolve, reject) => {
            started.push(() => undefined);
            signal?.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            );
          }),
      ),
    };
    const manager = new RunWebFetchSourceManager({ http });
    const first = manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/one",
    });
    const second = manager.execute(OWNER, {
      action: "fetch",
      url: "https://example.com/two",
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    await manager.cancelRun(OWNER);

    await expect(first).rejects.toThrow("Web fetch was cancelled");
    await expect(second).rejects.toThrow("Web fetch was cancelled");
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("fails visibly for non-success HTTP responses", async () => {
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () => ({
          ...response("not found", "text/plain"),
          status: 404,
        })),
      },
    });

    await expect(
      manager.execute(OWNER, {
        action: "fetch",
        url: "https://example.com/missing",
      }),
    ).rejects.toThrow("HTTP 404");
  });
});

function response(body: string, contentType: string): PublicHttpResponse {
  return {
    status: 200,
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    finalUrl: "https://example.com/source",
    redirectCount: 0,
  };
}
