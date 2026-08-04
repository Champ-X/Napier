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

    expect(await live.blob.text()).toBe("PNG_BROWSER_LIVE");
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
          new Response(Buffer.from("TAMPERED_CONTENT"), {
            status: 200,
            headers: tamperedHeaders,
          }),
        )
        .mockResolvedValueOnce(
          new Response(Buffer.from("PNG_BROWSER_LIVE"), {
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
          new Response(Buffer.from("PNG_BROWSER_LIVE"), {
            status: 200,
            headers,
          }),
      ),
    );

    await expect(getBrowserLiveView("thread_live", "run_live")).rejects.toThrow(
      "identity mismatch",
    );
  });
});

async function responseFixture() {
  const bytes = new TextEncoder().encode("PNG_BROWSER_LIVE");
  const imageSha256 = await sha256Bytes(bytes);
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 1 as const,
    threadId: "thread_live",
    runId: "run_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 4,
    imageSha256,
    imageBytes: bytes.byteLength,
    mimeType: "image/png" as const,
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

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const buffer = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
