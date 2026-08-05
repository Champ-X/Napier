import { createHash } from "node:crypto";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBrowserLiveViewHttp } from "../src/browser-live-view-http.js";

describe("Browser Live view HTTP", () => {
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
    expect(response.headers.get("x-napier-browser-active-tab-id")).toBe(
      receipt.activeTabId,
    );
    expect(response.headers.get("x-napier-browser-tab-count")).toBe("2");
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

function liveReceipt(image: Buffer): BrowserLiveViewReceipt {
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 2 as const,
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
    capturedAt: "2026-08-04T00:00:00.000Z",
    currentUrlSha256: "b".repeat(64),
    currentOriginSha256: "c".repeat(64),
    titleSha256: "d".repeat(64),
    browserExecutableSha256: "e".repeat(64),
    browserVersionSha256: "f".repeat(64),
    limitsSha256: "1".repeat(64),
    networkRequestCount: 3,
    blockedRequestCount: 1,
  };
  return {
    ...content,
    contentSha256: createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex"),
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
