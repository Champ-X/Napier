import { createHash } from "node:crypto";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { describe, expect, it, vi } from "vitest";

import { streamBrowserLiveView } from "../src/browser-live-view-stream.js";
import { canonicalJson } from "../src/ed25519.js";

describe("Browser Live view stream", () => {
  it("deduplicates unchanged images and terminates at the sample limit", async () => {
    const first = live("first", 1);
    const repeated = live("first", 1, {
      capturedAt: "2026-08-05T00:00:01.000Z",
      networkRequestCount: 99,
    });
    const second = live("second", 1);
    const capture = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce(second);
    const sleep = vi.fn(async () => undefined);
    const events = [];

    for await (const event of streamBrowserLiveView(
      { capture } as never,
      "thread_live",
      "run_live",
      undefined,
      { maxSamples: 3, intervalMs: 500, sleep },
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "browser_live_view",
      "browser_live_view",
      "browser_live_view_end",
    ]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        sequence: 1,
        imageBase64: first.image.toString("base64"),
        receipt: first.receipt,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(events[1]).toEqual(expect.objectContaining({ sequence: 2 }));
    expect(events[2]).toEqual(
      expect.objectContaining({
        sampleCount: 3,
        frameCount: 2,
        duplicateCount: 1,
        emittedImageBytes: first.image.byteLength + second.image.byteLength,
        reason: "sample_limit",
      }),
    );
    expect(capture).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns bounded terminal reasons without leaking capture errors", async () => {
    const capture = vi
      .fn()
      .mockResolvedValueOnce(live("first", 1))
      .mockRejectedValueOnce(new Error("PRIVATE_BROWSER_FAILURE"));
    const events = [];

    for await (const event of streamBrowserLiveView(
      { capture } as never,
      "thread_live",
      "run_live",
      undefined,
      { maxSamples: 3, intervalMs: 500, sleep: async () => undefined },
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "browser_live_view_end",
        sampleCount: 1,
        frameCount: 1,
        duplicateCount: 0,
        reason: "capture_failed",
      }),
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_BROWSER_FAILURE");
  });

  it("enforces the aggregate image byte limit before emitting another frame", async () => {
    const first = live("first", 1);
    const second = live("second", 1);
    const events = [];

    for await (const event of streamBrowserLiveView(
      {
        capture: vi
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second),
      } as never,
      "thread_live",
      "run_live",
      undefined,
      {
        maxSamples: 2,
        maxImageBytes: first.image.byteLength,
        intervalMs: 500,
        sleep: async () => undefined,
      },
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        frameCount: 1,
        sampleCount: 1,
        reason: "image_byte_limit",
      }),
    );
  });
});

function live(
  label: string,
  operation: number,
  overrides: Partial<BrowserLiveViewReceipt> = {},
) {
  const image = png(label);
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 4 as const,
    threadId: "thread_live",
    runId: "run_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: operation,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "b".repeat(64),
    imageSha256: hash(image),
    imageBytes: image.byteLength,
    mimeType: "image/png" as const,
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: overrides.capturedAt ?? "2026-08-05T00:00:00.000Z",
    currentUrlSha256: "c".repeat(64),
    currentOriginSha256: "d".repeat(64),
    titleSha256: "e".repeat(64),
    browserExecutableSha256: "f".repeat(64),
    browserVersionSha256: "1".repeat(64),
    limitsSha256: "2".repeat(64),
    networkRequestCount: overrides.networkRequestCount ?? 1,
    blockedRequestCount: 0,
    pageDiagnosis: {
      status: "none" as const,
      signalCount: 0,
      signalsSha256: "3".repeat(64),
      takeoverRecommended: false,
    },
  };
  const receipt: BrowserLiveViewReceipt = {
    ...content,
    contentSha256: hash(Buffer.from(canonicalJson(content))),
    ...overrides,
  };
  return { image, receipt };
}

function png(label: string): Buffer {
  const bytes = Buffer.alloc(24 + Buffer.byteLength(label));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1_280, 16);
  bytes.writeUInt32BE(900, 20);
  bytes.write(label, 24);
  return bytes;
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
