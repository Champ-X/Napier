import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserLiveViewService } from "@napier/runtime/browser-live-view";
import {
  streamBrowserLiveView,
  type BrowserLiveViewStreamOptions,
} from "@napier/runtime/browser-live-view-stream";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
  errorMessage,
  jsonError,
  setContentSha256Header,
} from "./http-response-evidence.js";
import { BrowserLiveViewStreamAdmission } from "./browser-live-view-stream-admission.js";

export function registerBrowserLiveViewHttp(
  app: Hono,
  browserLiveViews: BrowserLiveViewService,
  streamOptions: BrowserLiveViewStreamOptions = {},
): void {
  const streamAdmission = new BrowserLiveViewStreamAdmission();
  app.get(
    "/api/threads/:threadId/runs/:runId/browser-live-view/stream",
    (context) => {
      let release: () => void;
      try {
        release = streamAdmission.claim(
          context.req.param("threadId"),
          context.req.param("runId"),
        );
      } catch (error) {
        return jsonError(context, errorMessage(error), 409);
      }
      const response = streamSSE(context, async (stream) => {
        try {
          for await (const event of streamBrowserLiveView(
            browserLiveViews,
            context.req.param("threadId"),
            context.req.param("runId"),
            context.req.raw.signal,
            streamOptions,
          )) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
              ...(event.type === "browser_live_view"
                ? { id: String(event.sequence) }
                : {}),
            });
          }
        } finally {
          release();
        }
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Accel-Buffering", "no");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("X-Napier-Thread-Id", context.req.param("threadId"));
      response.headers.set("X-Napier-Run-Id", context.req.param("runId"));
      response.headers.set("X-Napier-Browser-Live-Mode", "bounded-stream");
      return response;
    },
  );
  app.get(
    "/api/threads/:threadId/runs/:runId/browser-live-view",
    async (context) => {
      try {
        const live = await browserLiveViews.capture(
          context.req.param("threadId"),
          context.req.param("runId"),
          context.req.raw.signal,
        );
        setBrowserLiveViewHeaders(context, live.receipt);
        const body = live.image.buffer.slice(
          live.image.byteOffset,
          live.image.byteOffset + live.image.byteLength,
        ) as ArrayBuffer;
        return context.body(body);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("active user Run") ||
            message.includes("not active") ||
            message.includes("unavailable")
            ? 409
            : 404,
        );
      }
    },
  );
}

function setBrowserLiveViewHeaders(
  context: Parameters<typeof setContentSha256Header>[0],
  receipt: BrowserLiveViewReceipt,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Type", receipt.mimeType);
  context.header("Content-Length", String(receipt.imageBytes));
  context.header(
    "X-Napier-Browser-Viewport-Width",
    String(receipt.viewportWidth),
  );
  context.header(
    "X-Napier-Browser-Viewport-Height",
    String(receipt.viewportHeight),
  );
  context.header("X-Content-Type-Options", "nosniff");
  setContentSha256Header(context, receipt.imageSha256, "body");
  context.header("X-Napier-Browser-Live-Receipt-SHA256", receipt.contentSha256);
  context.header("X-Napier-Thread-Id", receipt.threadId);
  context.header("X-Napier-Run-Id", receipt.runId);
  context.header("X-Napier-Browser-Session-SHA256", receipt.sessionIdSha256);
  context.header(
    "X-Napier-Browser-Session-Operation",
    String(receipt.sessionOperation),
  );
  context.header("X-Napier-Browser-Active-Tab-Id", receipt.activeTabId);
  context.header("X-Napier-Browser-Tab-Count", String(receipt.tabCount));
  context.header("X-Napier-Browser-Tab-Set-SHA256", receipt.tabSetSha256);
  context.header("X-Napier-Browser-Captured-At", receipt.capturedAt);
  context.header("X-Napier-Browser-URL-SHA256", receipt.currentUrlSha256);
  context.header("X-Napier-Browser-Origin-SHA256", receipt.currentOriginSha256);
  context.header("X-Napier-Browser-Title-SHA256", receipt.titleSha256);
  context.header(
    "X-Napier-Browser-Executable-SHA256",
    receipt.browserExecutableSha256,
  );
  context.header(
    "X-Napier-Browser-Version-SHA256",
    receipt.browserVersionSha256,
  );
  context.header("X-Napier-Browser-Limits-SHA256", receipt.limitsSha256);
  context.header(
    "X-Napier-Browser-Network-Request-Count",
    String(receipt.networkRequestCount),
  );
  context.header(
    "X-Napier-Browser-Blocked-Request-Count",
    String(receipt.blockedRequestCount),
  );
  context.header(
    "X-Napier-Browser-Page-Diagnosis",
    receipt.pageDiagnosis.status,
  );
  context.header(
    "X-Napier-Browser-Page-Diagnosis-Signal-Count",
    String(receipt.pageDiagnosis.signalCount),
  );
  context.header(
    "X-Napier-Browser-Page-Diagnosis-Signals-SHA256",
    receipt.pageDiagnosis.signalsSha256,
  );
  context.header(
    "X-Napier-Browser-Takeover-Recommended",
    String(receipt.pageDiagnosis.takeoverRecommended),
  );
}
