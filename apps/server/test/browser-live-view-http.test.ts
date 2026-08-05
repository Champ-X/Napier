import { createHash } from "node:crypto";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBrowserLiveViewHttp } from "../src/browser-live-view-http.js";

describe("Browser Live view HTTP", () => {
  it("streams finite deduplicated hash-bound frames without buffering", async () => {
    const firstImage = Buffer.from("PNG_STREAM_FIRST");
    const secondImage = Buffer.from("PNG_STREAM_SECOND");
    const first = { image: firstImage, receipt: liveReceipt(firstImage) };
    const second = {
      image: secondImage,
      receipt: liveReceipt(secondImage, {
        capturedAt: "2026-08-04T00:00:01.000Z",
      }),
    };
    const capture = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const app = new Hono();
    registerBrowserLiveViewHttp(app, { capture } as never, {
      maxSamples: 3,
      intervalMs: 500,
      sleep: async () => undefined,
    });

    const response = await app.request(
      `/api/threads/${first.receipt.threadId}/runs/${first.receipt.runId}/browser-live-view/stream`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-napier-browser-live-mode")).toBe(
      "bounded-stream",
    );
    expect(body.match(/event: browser_live_view\n/gu)).toHaveLength(2);
    expect(body).toContain("event: browser_live_view_end");
    expect(body).toContain('"frameCount":2');
    expect(body).toContain('"duplicateCount":1');
    expect(body).toContain('"reason":"sample_limit"');
    expect(body).not.toContain("PRIVATE_PAGE_CONTENT");
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("returns no-store hash-bound PNG bytes without page content headers", async () => {
    const image = Buffer.from("PNG_LIVE_BYTES");
    const receipt = liveReceipt(image);
    const capture = vi.fn(async () => ({ image, receipt }));
    const app = new Hono();
    registerBrowserLiveViewHttp(app, { capture } as never);

    const response = await app.request(
      `/api/threads/${receipt.threadId}/runs/${receipt.runId}/browser-live-view`,
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      receipt.imageSha256,
    );
    expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
    expect(response.headers.get("x-napier-browser-live-receipt-sha256")).toBe(
      receipt.contentSha256,
    );
    expect(response.headers.get("x-napier-browser-session-operation")).toBe(
      "2",
    );
    expect(response.headers.get("x-napier-browser-viewport-width")).toBe(
      "1280",
    );
    expect(response.headers.get("x-napier-browser-viewport-height")).toBe(
      "900",
    );
    expect(response.headers.get("x-napier-browser-active-tab-id")).toBe(
      receipt.activeTabId,
    );
    expect(response.headers.get("x-napier-browser-tab-count")).toBe("2");
    expect(response.headers.get("x-napier-browser-page-diagnosis")).toBe(
      "challenge_detected",
    );
    expect(
      response.headers.get("x-napier-browser-page-diagnosis-signals-sha256"),
    ).toBe(receipt.pageDiagnosis.signalsSha256);
    expect(response.headers.get("x-napier-browser-takeover-recommended")).toBe(
      "true",
    );
    expect(JSON.stringify([...response.headers])).not.toContain(
      "PRIVATE_PAGE_CONTENT",
    );
    expect(capture).toHaveBeenCalledWith(
      receipt.threadId,
      receipt.runId,
      expect.any(AbortSignal),
    );
  });

  it("returns conflict for an inactive Session without an image body", async () => {
    const app = new Hono();
    registerBrowserLiveViewHttp(app, {
      capture: vi.fn(async () => {
        throw new Error("Browser Session is not active for this Run");
      }),
    } as never);

    const response = await app.request(
      "/api/threads/thread_inactive/runs/run_inactive/browser-live-view",
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

function liveReceipt(
  image: Buffer,
  overrides: Partial<BrowserLiveViewReceipt> = {},
): BrowserLiveViewReceipt {
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 4 as const,
    threadId: "thread_browser_live",
    runId: "run_browser_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 2,
    activeTabId: "tab_2",
    tabCount: 2,
    tabSetSha256: "9".repeat(64),
    imageSha256: createHash("sha256").update(image).digest("hex"),
    imageBytes: image.byteLength,
    mimeType: "image/png" as const,
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: overrides.capturedAt ?? "2026-08-04T00:00:00.000Z",
    currentUrlSha256: "b".repeat(64),
    currentOriginSha256: "c".repeat(64),
    titleSha256: "d".repeat(64),
    browserExecutableSha256: "e".repeat(64),
    browserVersionSha256: "f".repeat(64),
    limitsSha256: "1".repeat(64),
    networkRequestCount: 3,
    blockedRequestCount: 1,
    pageDiagnosis: {
      status: "challenge_detected" as const,
      signalCount: 2,
      signalsSha256: "2".repeat(64),
      takeoverRecommended: true,
    },
  };
  return {
    ...content,
    contentSha256: createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex"),
    ...overrides,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
