import {
  BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES,
  BROWSER_LIVE_STREAM_MAX_SAMPLES,
  type BrowserLiveViewStreamFrame,
  type BrowserLiveViewStreamTerminal,
} from "@napier/contracts/browser-live-view";

import { throwNapierApiError } from "./api-error";
import {
  decodeCanonicalBase64,
  validateBrowserLiveViewReceipt,
  verifyBrowserLiveView,
} from "./browser-live-view-verification";
import { readSseJsonRecords } from "./sse-json";
import { canonicalJson, sha256Text } from "./stable-digest";

const MAX_STREAM_DATA_BYTES =
  Math.ceil(BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES / 3) * 4 + 256 * 1_024;
const MAX_STREAM_RECORD_BYTES = 12 * 1024 * 1024;

export interface BrowserLiveViewStreamImage {
  blob: Blob;
  receipt: BrowserLiveViewStreamFrame["receipt"];
  sequence: number;
}

export async function streamBrowserLiveViews(
  threadId: string,
  runId: string,
  onImage: (image: BrowserLiveViewStreamImage) => void,
  signal?: AbortSignal,
): Promise<BrowserLiveViewStreamTerminal> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-live-view/stream`;
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Browser live stream unavailable",
      path,
    );
  }
  assertResponse(response, threadId, runId);
  if (!response.body) {
    throw new Error(`Browser live stream body is unavailable for ${path}`);
  }
  let frameCount = 0;
  let emittedImageBytes = 0;
  let lastFrameIdentity: string | undefined;
  let terminal: BrowserLiveViewStreamTerminal | undefined;
  for await (const record of readSseJsonRecords(path, response.body, {
    maxTotalBytes: MAX_STREAM_DATA_BYTES,
    maxRecordBytes: MAX_STREAM_RECORD_BYTES,
  })) {
    if (terminal) {
      throw new Error(`Browser live stream emitted after terminal for ${path}`);
    }
    const type = recordType(record.value);
    if (type === "browser_live_view") {
      const frame = await validateFrame(record.value, {
        path,
        threadId,
        runId,
        expectedSequence: frameCount + 1,
        ...(record.eventType ? { eventType: record.eventType } : {}),
        ...(record.id ? { id: record.id } : {}),
      });
      const bytes = decodeCanonicalBase64(frame.imageBase64);
      await verifyBrowserLiveView({
        path,
        threadId,
        runId,
        bytes,
        receipt: frame.receipt,
      });
      const frameIdentity = await liveFrameIdentity(frame.receipt);
      if (frameIdentity === lastFrameIdentity) {
        throw new Error(`Browser live stream frame is invalid for ${path}`);
      }
      emittedImageBytes += bytes.byteLength;
      if (emittedImageBytes > BROWSER_LIVE_STREAM_MAX_IMAGE_BYTES) {
        throw new Error(`Browser live stream image limit exceeded for ${path}`);
      }
      frameCount += 1;
      lastFrameIdentity = frameIdentity;
      onImage({
        blob: new Blob([bytes], { type: frame.receipt.mimeType }),
        receipt: frame.receipt,
        sequence: frame.sequence,
      });
      continue;
    }
    if (type !== "browser_live_view_end") {
      throw new Error(`Browser live stream event type is invalid for ${path}`);
    }
    terminal = await validateTerminal(record.value, {
      path,
      ...(record.eventType ? { eventType: record.eventType } : {}),
      ...(record.id ? { id: record.id } : {}),
      frameCount,
      emittedImageBytes,
    });
  }
  if (!terminal) {
    throw new Error(`Browser live stream terminal is missing for ${path}`);
  }
  return terminal;
}

async function validateFrame(
  value: unknown,
  expected: {
    path: string;
    threadId: string;
    runId: string;
    expectedSequence: number;
    eventType?: string;
    id?: string;
  },
): Promise<BrowserLiveViewStreamFrame> {
  const frame = exactRecord(value, [
    "type",
    "schemaVersion",
    "sequence",
    "imageBase64",
    "receipt",
    "contentSha256",
  ]);
  const receipt = validateBrowserLiveViewReceipt(frame["receipt"]);
  if (
    frame["type"] !== "browser_live_view" ||
    frame["schemaVersion"] !== 1 ||
    frame["sequence"] !== expected.expectedSequence ||
    typeof frame["imageBase64"] !== "string" ||
    typeof frame["contentSha256"] !== "string" ||
    expected.eventType !== "browser_live_view" ||
    expected.id !== String(expected.expectedSequence) ||
    receipt.threadId !== expected.threadId ||
    receipt.runId !== expected.runId
  ) {
    throw new Error(
      `Browser live stream frame is invalid for ${expected.path}`,
    );
  }
  const { contentSha256: _hash, ...content } = frame;
  if ((await sha256Text(canonicalJson(content))) !== frame["contentSha256"]) {
    throw new Error(
      `Browser live stream frame hash mismatch for ${expected.path}`,
    );
  }
  return {
    type: "browser_live_view",
    schemaVersion: 1,
    sequence: expected.expectedSequence,
    imageBase64: frame["imageBase64"],
    receipt,
    contentSha256: frame["contentSha256"],
  };
}

async function validateTerminal(
  value: unknown,
  expected: {
    path: string;
    eventType?: string;
    id?: string;
    frameCount: number;
    emittedImageBytes: number;
  },
): Promise<BrowserLiveViewStreamTerminal> {
  const terminal = exactRecord(value, [
    "type",
    "schemaVersion",
    "sampleCount",
    "frameCount",
    "duplicateCount",
    "emittedImageBytes",
    "reason",
    "contentSha256",
  ]);
  const reason = terminal["reason"];
  if (
    terminal["type"] !== "browser_live_view_end" ||
    terminal["schemaVersion"] !== 1 ||
    expected.eventType !== "browser_live_view_end" ||
    expected.id !== undefined ||
    !integer(terminal["sampleCount"], 0, BROWSER_LIVE_STREAM_MAX_SAMPLES) ||
    terminal["frameCount"] !== expected.frameCount ||
    !integer(terminal["duplicateCount"], 0, BROWSER_LIVE_STREAM_MAX_SAMPLES) ||
    terminal["frameCount"] + terminal["duplicateCount"] !==
      terminal["sampleCount"] ||
    terminal["emittedImageBytes"] !== expected.emittedImageBytes ||
    (reason !== "sample_limit" &&
      reason !== "session_ended" &&
      reason !== "image_byte_limit" &&
      reason !== "capture_failed") ||
    (reason === "sample_limit" &&
      terminal["sampleCount"] !== BROWSER_LIVE_STREAM_MAX_SAMPLES) ||
    typeof terminal["contentSha256"] !== "string"
  ) {
    throw new Error(
      `Browser live stream terminal is invalid for ${expected.path}`,
    );
  }
  const { contentSha256: _hash, ...content } = terminal;
  if (
    (await sha256Text(canonicalJson(content))) !== terminal["contentSha256"]
  ) {
    throw new Error(
      `Browser live stream terminal hash mismatch for ${expected.path}`,
    );
  }
  return {
    ...content,
    reason,
    contentSha256: terminal["contentSha256"],
  } as BrowserLiveViewStreamTerminal;
}

function assertResponse(
  response: Response,
  threadId: string,
  runId: string,
): void {
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    response.headers.get("cache-control") !== "no-store" ||
    response.headers.get("x-accel-buffering") !== "no" ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    response.headers.get("x-napier-thread-id") !== threadId ||
    response.headers.get("x-napier-run-id") !== runId ||
    response.headers.get("x-napier-browser-live-mode") !== "bounded-stream"
  ) {
    throw new Error("Browser live stream response contract is invalid");
  }
}

function liveFrameIdentity(
  receipt: BrowserLiveViewStreamFrame["receipt"],
): Promise<string> {
  return sha256Text(
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

function recordType(value: unknown): string | undefined {
  return record(value) && typeof value["type"] === "string"
    ? value["type"]
    : undefined;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw new Error("Browser live stream record is invalid");
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
