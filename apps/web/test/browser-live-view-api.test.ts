import { afterEach, describe, expect, it, vi } from "vitest";

import { getBrowserLiveView } from "../src/browser-live-view-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Browser Live view Web API", () => {
  it("verifies PNG bytes and the hash-only receipt", async () => {
    const fixture = await responseFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fixture.response),
    );

    const live = await getBrowserLiveView("thread_live", "run_live");

    expect((await live.blob.arrayBuffer()).byteLength).toBe(24);
    expect(live.blob.type).toBe("image/png");
    expect(live.receipt).toEqual(fixture.receipt);
  });

  it("rejects tampered bytes and missing no-store protection", async () => {
    const fixture = await responseFixture();
    const tamperedHeaders = new Headers(fixture.response.headers);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(new Uint8Array(24).buffer, {
            status: 200,
            headers: tamperedHeaders,
          }),
        )
        .mockResolvedValueOnce(
          new Response(pngBytes(), {
            status: 200,
            headers: new Headers([
              ...fixture.response.headers,
              ["Cache-Control", "public"],
            ]),
          }),
        ),
    );

    await expect(getBrowserLiveView("thread_live", "run_live")).rejects.toThrow(
      "image hash mismatch",
    );
    await expect(getBrowserLiveView("thread_live", "run_live")).rejects.toThrow(
      "response contract is invalid",
    );
  });

  it("rejects a response bound to another Run", async () => {
    const fixture = await responseFixture();
    const headers = new Headers(fixture.response.headers);
    headers.set("X-Napier-Run-Id", "run_other");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(pngBytes(), {
            status: 200,
            headers,
          }),
      ),
    );

    await expect(getBrowserLiveView("thread_live", "run_live")).rejects.toThrow(
      "identity mismatch",
    );
  });

  it("rejects PNG dimensions that differ from the bound viewport", async () => {
    const fixture = await responseFixture();
    const bytes = pngBytes(640, 450);
    const headers = new Headers(fixture.response.headers);
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("X-Napier-Content-SHA256", await sha256Bytes(bytes));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200, headers })),
    );

    await expect(getBrowserLiveView("thread_live", "run_live")).rejects.toThrow(
      "dimensions mismatch",
    );
  });
});

async function responseFixture() {
  const bytes = pngBytes();
  const imageSha256 = await sha256Bytes(bytes);
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 3 as const,
    threadId: "thread_live",
    runId: "run_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 4,
    activeTabId: "tab_2",
    tabCount: 2,
    tabSetSha256: "9".repeat(64),
    imageSha256,
    imageBytes: bytes.byteLength,
    mimeType: "image/png" as const,
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: "2026-08-04T00:00:00.000Z",
    currentUrlSha256: "b".repeat(64),
    currentOriginSha256: "c".repeat(64),
    titleSha256: "d".repeat(64),
    browserExecutableSha256: "e".repeat(64),
    browserVersionSha256: "f".repeat(64),
    limitsSha256: "1".repeat(64),
    networkRequestCount: 5,
    blockedRequestCount: 2,
  };
  const receipt = {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "image/png",
    "Content-Length": String(bytes.byteLength),
    "X-Content-Type-Options": "nosniff",
    "X-Napier-Content-SHA256": receipt.imageSha256,
    "X-Napier-Content-SHA256-Mode": "body",
    "X-Napier-Browser-Live-Receipt-SHA256": receipt.contentSha256,
    "X-Napier-Thread-Id": receipt.threadId,
    "X-Napier-Run-Id": receipt.runId,
    "X-Napier-Browser-Session-SHA256": receipt.sessionIdSha256,
    "X-Napier-Browser-Session-Operation": String(receipt.sessionOperation),
    "X-Napier-Browser-Viewport-Width": String(receipt.viewportWidth),
    "X-Napier-Browser-Viewport-Height": String(receipt.viewportHeight),
    "X-Napier-Browser-Active-Tab-Id": receipt.activeTabId,
    "X-Napier-Browser-Tab-Count": String(receipt.tabCount),
    "X-Napier-Browser-Tab-Set-SHA256": receipt.tabSetSha256,
    "X-Napier-Browser-Captured-At": receipt.capturedAt,
    "X-Napier-Browser-URL-SHA256": receipt.currentUrlSha256,
    "X-Napier-Browser-Origin-SHA256": receipt.currentOriginSha256,
    "X-Napier-Browser-Title-SHA256": receipt.titleSha256,
    "X-Napier-Browser-Executable-SHA256": receipt.browserExecutableSha256,
    "X-Napier-Browser-Version-SHA256": receipt.browserVersionSha256,
    "X-Napier-Browser-Limits-SHA256": receipt.limitsSha256,
    "X-Napier-Browser-Network-Request-Count": String(
      receipt.networkRequestCount,
    ),
    "X-Napier-Browser-Blocked-Request-Count": String(
      receipt.blockedRequestCount,
    ),
  });
  return {
    receipt,
    response: new Response(bytes, { status: 200, headers }),
  };
}

function pngBytes(width = 1_280, height = 900): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
