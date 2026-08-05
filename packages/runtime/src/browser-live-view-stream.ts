import {
  BROWSER_LIVE_STREAM_INTERVAL_MS,
  BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES,
  BROWSER_LIVE_STREAM_MAX_SAMPLES,
  type BrowserLiveViewStreamFrame,
  type BrowserLiveViewStreamTerminal,
} from "@napier/contracts/browser-live-view";

import type { BrowserLiveViewService } from "./browser-live-view.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export type BrowserLiveViewStreamEvent =
  | BrowserLiveViewStreamFrame
  | BrowserLiveViewStreamTerminal;

export interface BrowserLiveViewStreamOptions {
  intervalMs?: number;
  maxSamples?: number;
  maxImageBytes?: number;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

export async function* streamBrowserLiveView(
  service: BrowserLiveViewService,
  threadId: string,
  runId: string,
  signal?: AbortSignal,
  options: BrowserLiveViewStreamOptions = {},
): AsyncGenerator<BrowserLiveViewStreamEvent> {
  const intervalMs = boundedInteger(
    options.intervalMs ?? BROWSER_LIVE_STREAM_INTERVAL_MS,
    500,
    5_000,
    "Browser Live stream interval",
  );
  const maxSamples = boundedInteger(
    options.maxSamples ?? BROWSER_LIVE_STREAM_MAX_SAMPLES,
    1,
    BROWSER_LIVE_STREAM_MAX_SAMPLES,
    "Browser Live stream sample limit",
  );
  const maxImageBytes = boundedInteger(
    options.maxImageBytes ?? BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES,
    1,
    BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES,
    "Browser Live stream image byte limit",
  );
  const sleep = options.sleep ?? abortableSleep;
  let frameCount = 0;
  let duplicateCount = 0;
  let emittedImageBytes = 0;
  let latestFrameIdentity: string | undefined;
  let reason: BrowserLiveViewStreamTerminal["reason"] = "sample_limit";
  let sampleCount = 0;
  for (; sampleCount < maxSamples; sampleCount += 1) {
    signal?.throwIfAborted();
    let live;
    try {
      live = await service.capture(threadId, runId, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      reason = sessionEnded(error) ? "session_ended" : "capture_failed";
      break;
    }
    const frameIdentity = liveFrameIdentity(live.receipt);
    if (frameIdentity === latestFrameIdentity) {
      duplicateCount += 1;
    } else {
      if (emittedImageBytes + live.image.byteLength > maxImageBytes) {
        reason = "image_byte_limit";
        break;
      }
      latestFrameIdentity = frameIdentity;
      emittedImageBytes += live.image.byteLength;
      frameCount += 1;
      yield createFrame(frameCount, live.image, live.receipt);
    }
    if (sampleCount + 1 < maxSamples) {
      await sleep(intervalMs, signal);
    }
  }
  const content = {
    type: "browser_live_view_end" as const,
    schemaVersion: 1 as const,
    sampleCount,
    frameCount,
    duplicateCount,
    emittedImageBytes,
    reason,
  };
  yield { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function createFrame(
  sequence: number,
  image: Buffer,
  receipt: BrowserLiveViewStreamFrame["receipt"],
): BrowserLiveViewStreamFrame {
  const content = {
    type: "browser_live_view" as const,
    schemaVersion: 1 as const,
    sequence,
    imageBase64: image.toString("base64"),
    receipt,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function liveFrameIdentity(
  receipt: BrowserLiveViewStreamFrame["receipt"],
): string {
  return sha256(
    canonicalJson({
      sessionIdSha256: receipt.sessionIdSha256,
      sessionOperation: receipt.sessionOperation,
      activeTabId: receipt.activeTabId,
      tabCount: receipt.tabCount,
      tabSetSha256: receipt.tabSetSha256,
      imageSha256: receipt.imageSha256,
      viewportWidth: receipt.viewportWidth,
      viewportHeight: receipt.viewportHeight,
      currentUrlSha256: receipt.currentUrlSha256,
      currentOriginSha256: receipt.currentOriginSha256,
      titleSha256: receipt.titleSha256,
      pageDiagnosis: receipt.pageDiagnosis,
    }),
  );
}

function sessionEnded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("active user Run") ||
    message.includes("not active") ||
    message.includes("unavailable")
  );
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function abortableSleep(
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, durationMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Browser Live stream cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
