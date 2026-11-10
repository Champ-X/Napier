import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBrowserLiveViewHttp } from "../src/browser-live-view-http.js";
import { registerBrowserTaskHttp } from "../src/browser-task-http.js";
import {
  streamTaskEvents,
  type StreamableBrowserTaskRecord,
} from "../src/browser-task-service-support.js";

describe("Browser HTTP stream cancellation", () => {
  it("aborts an in-flight live capture and releases admission when the response is cancelled", async () => {
    const requestController = new AbortController();
    const signals: AbortSignal[] = [];
    const capture = vi.fn(async (_threadId, _runId, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const app = new Hono();
    registerBrowserLiveViewHttp(app, { capture } as never);
    const request = () => new Request(
      "http://napier.test/api/threads/thread_live/runs/run_live/browser-live-view/stream",
      { signal: requestController.signal },
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app.request(request());
      expect(response.status).toBe(200);
      expect(signals).toHaveLength(1);
      await response.body!.cancel();
      expect(requestController.signal.aborted).toBe(false);
      await vi.waitFor(() => expect(signals[0]!.aborted).toBe(true));

      const reconnected = await app.request(request());
      expect(reconnected.status).toBe(200);
      expect(capture).toHaveBeenCalledTimes(2);
      await reconnected.body!.cancel();
      await vi.waitFor(() => expect(signals[1]!.aborted).toBe(true));
      expect(errors).not.toHaveBeenCalled();
    } finally {
      requestController.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      errors.mockRestore();
    }
  });

  it("removes an idle task event listener without stopping the background task", async () => {
    const requestController = new AbortController();
    const record: StreamableBrowserTaskRecord = {
      status: "running", events: [], listeners: new Set(),
    };
    const stop = vi.fn();
    const app = new Hono();
    registerBrowserTaskHttp(app, {
      backend: () => "browser_use_local",
      events: (_taskId: string, signal: AbortSignal) => streamTaskEvents(record, signal),
      stop,
    } as never);
    try {
      const response = await app.request(new Request(
        "http://napier.test/api/browser-tasks/task_live/stream",
        { signal: requestController.signal },
      ));
      expect(record.listeners.size).toBe(1);
      await response.body!.cancel();
      expect(requestController.signal.aborted).toBe(false);
      await vi.waitFor(() => expect(record.listeners.size).toBe(0));
      expect(record.status).toBe("running");
      expect(stop).not.toHaveBeenCalled();
    } finally {
      requestController.abort();
    }
  });
});
