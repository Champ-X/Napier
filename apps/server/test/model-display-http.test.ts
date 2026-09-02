import { createHash } from "node:crypto";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerModelDisplayHttp } from "../src/model-display-http.js";

describe("Model display HTTP", () => {
  it("returns no-store thread-bound local-only records", async () => {
    const app = new Hono();
    const records = [
      {
        kind: "napier.local-model-display" as const,
        schemaVersion: 1 as const,
        sourceThreadId: "thread_display_http",
        sourceRunId: "run_display_http",
        responseEventId: "event_display_http",
        modelContextEnvelopeTurnIndex: 2,
        text: "Complete answer",
        thinking: "Readable process",
        origin: "captured_response" as const,
        contentSha256: createHash("sha256").update("fixture").digest("hex"),
      },
    ];
    const getThread = vi.fn(() => ({ id: "thread_display_http" }));
    const listThread = vi.fn(async () => records);
    registerModelDisplayHttp(app, {
      store: { getThread },
      modelDisplays: { listThread },
    });

    const response = await app.request(
      "/api/threads/thread_display_http/local-model-displays",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-napier-local-only")).toBe("model-display");
    expect(await response.json()).toEqual({
      kind: "napier.local-model-display-list",
      schemaVersion: 1,
      threadId: "thread_display_http",
      records,
    });
    expect(getThread).toHaveBeenCalledWith("thread_display_http");
    expect(listThread).toHaveBeenCalledWith("thread_display_http");
  });

  it("does not read private records for a missing thread", async () => {
    const app = new Hono();
    const listThread = vi.fn();
    registerModelDisplayHttp(app, {
      store: {
        getThread: () => {
          throw new Error("Thread not found: thread_missing");
        },
      },
      modelDisplays: { listThread },
    });

    const response = await app.request(
      "/api/threads/thread_missing/local-model-displays",
    );

    expect(response.status).toBe(404);
    expect(listThread).not.toHaveBeenCalled();
  });
});
