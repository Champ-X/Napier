import { createHash } from "node:crypto";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerToolDisplayHttp } from "../src/tool-display-http.js";

describe("Tool display HTTP", () => {
  it("returns no-store thread-bound local-only records", async () => {
    const app = new Hono();
    const records = [{
      kind: "napier.local-tool-display" as const,
      schemaVersion: 1 as const,
      sourceThreadId: "thread_display_http",
      sourceRunId: "run_display_http",
      callId: "call_display_http",
      toolName: "run_command",
      input: "npm test",
      output: "passed",
      contentSha256: createHash("sha256").update("fixture").digest("hex"),
    }];
    const getThread = vi.fn(() => ({ id: "thread_display_http" }));
    const listThread = vi.fn(async () => records);
    registerToolDisplayHttp(app, { store: { getThread }, toolDisplays: { listThread } });

    const response = await app.request(
      "/api/threads/thread_display_http/local-tool-displays",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-napier-local-only")).toBe("tool-display");
    expect(await response.json()).toEqual({
      kind: "napier.local-tool-display-list",
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
    registerToolDisplayHttp(app, {
      store: { getThread: () => { throw new Error("Thread not found: thread_missing"); } },
      toolDisplays: { listThread },
    });

    const response = await app.request(
      "/api/threads/thread_missing/local-tool-displays",
    );
    expect(response.status).toBe(404);
    expect(listThread).not.toHaveBeenCalled();
  });
});
