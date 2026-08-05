import { afterEach, describe, expect, it, vi } from "vitest";

import {
  streamBrowserLiveViews,
  type BrowserLiveViewStreamImage,
} from "../src/browser-live-view-stream-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Browser Live view stream Web API", () => {
  it("verifies incremental frame bytes, receipts, sequence, and terminal", async () => {
    const first = await frame(1, "first");
    const second = await frame(2, "second");
    const terminal = await end({
      sampleCount: 32,
      frameCount: 2,
      duplicateCount: 30,
      emittedImageBytes: first.receipt.imageBytes + second.receipt.imageBytes,
      reason: "sample_limit",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          sse("browser_live_view", first, "1"),
          sse("browser_live_view", second, "2"),
          sse("browser_live_view_end", terminal),
        ]),
      ),
    );
    const images: BrowserLiveViewStreamImage[] = [];

    const result = await streamBrowserLiveViews(
      "thread_live",
      "run_live",
      (image) => images.push(image),
    );

    expect(images.map((image) => image.sequence)).toEqual([1, 2]);
    expect(await images[0]!.blob.text()).toContain("first");
    expect(result).toEqual(terminal);
  });

  it("rejects tampered frame hashes and duplicate image frames", async () => {
    const first = await frame(1, "first");
    const duplicate = await repeatedFrame(2, first);
    const tampered = { ...first, contentSha256: "0".repeat(64) };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response([sse("browser_live_view", tampered, "1")]),
        )
        .mockResolvedValueOnce(
          response([
            sse("browser_live_view", first, "1"),
            sse("browser_live_view", duplicate, "2"),
          ]),
        ),
    );

    await expect(
      streamBrowserLiveViews("thread_live", "run_live", () => undefined),
    ).rejects.toThrow("frame hash mismatch");
    await expect(
      streamBrowserLiveViews("thread_live", "run_live", () => undefined),
    ).rejects.toThrow("frame is invalid");
  });

  it("rejects sequence drift and impossible terminal counters", async () => {
    const first = await frame(1, "first");
    const drifted = { ...first, sequence: 2 };
    const impossible = await end({
      sampleCount: 2,
      frameCount: 1,
      duplicateCount: 0,
      emittedImageBytes: first.receipt.imageBytes,
      reason: "sample_limit",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response([sse("browser_live_view", drifted, "2")]),
        )
        .mockResolvedValueOnce(
          response([
            sse("browser_live_view", first, "1"),
            sse("browser_live_view_end", impossible),
          ]),
        ),
    );

    await expect(
      streamBrowserLiveViews("thread_live", "run_live", () => undefined),
    ).rejects.toThrow("frame is invalid");
    await expect(
      streamBrowserLiveViews("thread_live", "run_live", () => undefined),
    ).rejects.toThrow("terminal is invalid");
  });

  it("rejects response identity drift before reading private image data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([], {
          "X-Napier-Run-Id": "run_other",
        }),
      ),
    );

    await expect(
      streamBrowserLiveViews("thread_live", "run_live", () => undefined),
    ).rejects.toThrow("response contract is invalid");
  });
});

async function frame(sequence: number, label: string) {
  const bytes = png(label);
  const receiptContent = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 4 as const,
    threadId: "thread_live",
    runId: "run_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: sequence,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "b".repeat(64),
    imageSha256: await sha256Bytes(bytes),
    imageBytes: bytes.byteLength,
    mimeType: "image/png" as const,
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: `2026-08-05T00:00:0${String(sequence)}.000Z`,
    currentUrlSha256: "c".repeat(64),
    currentOriginSha256: "d".repeat(64),
    titleSha256: "e".repeat(64),
    browserExecutableSha256: "f".repeat(64),
    browserVersionSha256: "1".repeat(64),
    limitsSha256: "2".repeat(64),
    networkRequestCount: 1,
    blockedRequestCount: 0,
    pageDiagnosis: {
      status: "none" as const,
      signalCount: 0,
      signalsSha256: "3".repeat(64),
      takeoverRecommended: false,
    },
  };
  const receipt = {
    ...receiptContent,
    contentSha256: await sha256Text(canonicalJson(receiptContent)),
  };
  const content = {
    type: "browser_live_view" as const,
    schemaVersion: 1 as const,
    sequence,
    imageBase64: bytesToBase64(bytes),
    receipt,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function end(input: {
  sampleCount: number;
  frameCount: number;
  duplicateCount: number;
  emittedImageBytes: number;
  reason: "sample_limit";
}) {
  const content = {
    type: "browser_live_view_end" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function repeatedFrame(
  sequence: number,
  source: Awaited<ReturnType<typeof frame>>,
) {
  const content = {
    type: "browser_live_view" as const,
    schemaVersion: 1 as const,
    sequence,
    imageBase64: source.imageBase64,
    receipt: source.receipt,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

function response(
  records: string[],
  overrides: Record<string, string> = {},
): Response {
  return new Response(records.join("\n\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Thread-Id": "thread_live",
      "X-Napier-Run-Id": "run_live",
      "X-Napier-Browser-Live-Mode": "bounded-stream",
      ...overrides,
    },
  });
}

function sse(type: string, value: unknown, id?: string): string {
  return [
    `event: ${type}`,
    ...(id ? [`id: ${id}`] : []),
    `data: ${JSON.stringify(value)}`,
  ].join("\n");
}

function png(label: string): ArrayBuffer {
  const bytes = new Uint8Array(24 + label.length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1_280);
  view.setUint32(20, 900);
  bytes.set(new TextEncoder().encode(label), 24);
  return bytes.buffer;
}

function bytesToBase64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
