import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBrowserSessionControlHttp } from "../src/browser-session-control-http.js";

describe("Browser Session control HTTP", () => {
  it("returns no-store hash-bound state and forwards exact control identity", async () => {
    const running = state("running");
    const paused = state("paused");
    const resumed = state("running", {
      pauseRequestedAt: paused.pauseRequestedAt,
      resumedAt: "2026-08-04T00:01:00.000Z",
    });
    const controls = {
      state: vi.fn(async () => running),
      pause: vi.fn(async () => paused),
      resume: vi.fn(async () => resumed),
    };
    const app = new Hono();
    registerBrowserSessionControlHttp(app, controls as never);
    const path = `/api/threads/${running.threadId}/runs/${running.runId}/browser-session-control`;

    const statusResponse = await app.request(path);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get("cache-control")).toBe("no-store");
    expect(statusResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(statusResponse.headers.get("x-napier-content-sha256")).toBe(
      running.contentSha256,
    );
    expect(statusResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "stable",
    );
    expect(await statusResponse.json()).toEqual(running);

    const pauseResponse = await app.request(`${path}/pause`, {
      method: "POST",
    });
    expect(pauseResponse.status).toBe(200);
    expect(await pauseResponse.json()).toEqual(paused);

    const resumeResponse = await app.request(`${path}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedPauseStateSha256: paused.contentSha256,
      }),
    });
    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toEqual(resumed);
    expect(controls.state).toHaveBeenCalledWith(
      running.threadId,
      running.runId,
    );
    expect(controls.pause).toHaveBeenCalledWith(
      running.threadId,
      running.runId,
    );
    expect(controls.resume).toHaveBeenCalledWith(
      running.threadId,
      running.runId,
      paused.contentSha256,
    );
  });

  it("rejects invalid and stale resume without invoking control", async () => {
    const controls = {
      state: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(async () => {
        throw new Error("Browser Session pause state changed");
      }),
    };
    const app = new Hono();
    registerBrowserSessionControlHttp(app, controls as never);
    const path =
      "/api/threads/thread_control/runs/run_control/browser-session-control/resume";

    const invalid = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPauseStateSha256: "PRIVATE_PAGE_DATA" }),
    });
    expect(invalid.status).toBe(400);
    expect(controls.resume).not.toHaveBeenCalled();

    const stale = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPauseStateSha256: "a".repeat(64) }),
    });
    expect(stale.status).toBe(409);
    expect(JSON.stringify(await stale.json())).not.toContain("PRIVATE");
  });

  it("returns conflict for non-user Run control", async () => {
    const app = new Hono();
    registerBrowserSessionControlHttp(app, {
      state: vi.fn(async () => {
        throw new Error("Browser Session control requires the active user Run");
      }),
    } as never);

    const response = await app.request(
      "/api/threads/thread_schedule/runs/run_schedule/browser-session-control",
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

function state(
  status: BrowserSessionPauseState["status"],
  timestamps: {
    pauseRequestedAt?: string;
    resumedAt?: string;
    cancelledAt?: string;
  } = {},
): BrowserSessionPauseState {
  return {
    kind: "napier.browser-session-pause-state",
    schemaVersion: 1,
    threadId: "thread_control",
    runId: "run_control",
    status,
    ...(status === "paused"
      ? { pauseRequestedAt: "2026-08-04T00:00:00.000Z" }
      : {}),
    ...timestamps,
    contentSha256:
      status === "paused"
        ? "b".repeat(64)
        : timestamps.resumedAt
          ? "c".repeat(64)
          : "a".repeat(64),
  };
}
