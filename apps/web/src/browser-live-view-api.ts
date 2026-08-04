import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { throwNapierApiError } from "./api-error";
import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
const MAX_LIVE_VIEW_BYTES = 8 * 1024 * 1024;

export interface BrowserLiveView {
  blob: Blob;
  receipt: BrowserLiveViewReceipt;
}

export async function getBrowserLiveView(
  threadId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<BrowserLiveView> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-live-view`;
  const response = await fetch(path, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Browser live view unavailable", path);
  }
  const bytes = await response.arrayBuffer();
  const receipt = receiptFromHeaders(response, bytes.byteLength);
  if (receipt.threadId !== threadId || receipt.runId !== runId) {
    throw new Error(`Browser live view identity mismatch for ${path}`);
  }
  const observedImageSha256 = await sha256ArrayBuffer(bytes);
  if (observedImageSha256 !== receipt.imageSha256) {
    throw new Error(`Browser live view image hash mismatch for ${path}`);
  }
  const { contentSha256: _contentSha256, ...content } = receipt;
  if ((await sha256Text(canonicalJson(content))) !== receipt.contentSha256) {
    throw new Error(`Browser live view receipt hash mismatch for ${path}`);
  }
  return {
    blob: new Blob([bytes], { type: receipt.mimeType }),
    receipt,
  };
}

function receiptFromHeaders(
  response: Response,
  observedBytes: number,
): BrowserLiveViewReceipt {
  const receipt = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 1 as const,
    threadId: required(response, "X-Napier-Thread-Id"),
    runId: required(response, "X-Napier-Run-Id"),
    sessionIdSha256: digest(response, "X-Napier-Browser-Session-SHA256"),
    sessionOperation: integer(
      response,
      "X-Napier-Browser-Session-Operation",
      0,
      64,
    ),
    imageSha256: digest(response, "X-Napier-Content-SHA256"),
    imageBytes: integer(response, "Content-Length", 1, MAX_LIVE_VIEW_BYTES),
    mimeType: contentType(response),
    capturedAt: timestamp(response, "X-Napier-Browser-Captured-At"),
    currentUrlSha256: digest(response, "X-Napier-Browser-URL-SHA256"),
    currentOriginSha256: digest(response, "X-Napier-Browser-Origin-SHA256"),
    titleSha256: digest(response, "X-Napier-Browser-Title-SHA256"),
    browserExecutableSha256: digest(
      response,
      "X-Napier-Browser-Executable-SHA256",
    ),
    browserVersionSha256: digest(response, "X-Napier-Browser-Version-SHA256"),
    limitsSha256: digest(response, "X-Napier-Browser-Limits-SHA256"),
    networkRequestCount: integer(
      response,
      "X-Napier-Browser-Network-Request-Count",
      0,
      10_000,
    ),
    blockedRequestCount: integer(
      response,
      "X-Napier-Browser-Blocked-Request-Count",
      0,
      10_000,
    ),
    contentSha256: digest(response, "X-Napier-Browser-Live-Receipt-SHA256"),
  };
  if (
    response.headers.get("Cache-Control") !== "no-store" ||
    response.headers.get("X-Content-Type-Options") !== "nosniff" ||
    response.headers.get("X-Napier-Content-SHA256-Mode") !== "body" ||
    receipt.imageBytes !== observedBytes
  ) {
    throw new Error("Browser live view response contract is invalid");
  }
  return receipt;
}

function contentType(response: Response): "image/png" {
  const value = response.headers.get("Content-Type")?.split(";")[0]?.trim();
  if (value !== "image/png") {
    throw new Error("Browser live view content type is invalid");
  }
  return value;
}

function digest(response: Response, name: string): string {
  const value = required(response, name);
  if (!HASH.test(value))
    throw new Error(`Browser live view ${name} is invalid`);
  return value;
}

function required(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`Browser live view ${name} is missing`);
  return value;
}

function integer(
  response: Response,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(required(response, name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Browser live view ${name} is invalid`);
  }
  return value;
}

function timestamp(response: Response, name: string): string {
  const value = required(response, name);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Browser live view ${name} is invalid`);
  }
  return value;
}

async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
