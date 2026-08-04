import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserSessionPauseState,
  pauseBrowserSession,
  resumeBrowserSession,
} from "../src/browser-session-control-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Browser Session control Web API", () => {
  it("verifies stable state hashes and exact Run identity", async () => {
    const running = await state("running");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(running)),
    );

    await expect(
      getBrowserSessionPauseState("thread_web_control", "run_web_control"),
    ).resolves.toEqual(running);
  });

  it("sends pause and hash-guarded resume requests", async () => {
    const paused = await state("paused");
    const running = await state("running", {
      ...(paused.pauseRequestedAt
        ? { pauseRequestedAt: paused.pauseRequestedAt }
        : {}),
      resumedAt: "2026-08-04T00:01:00.000Z",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(paused))
      .mockResolvedValueOnce(response(running));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pauseBrowserSession("thread_web_control", "run_web_control"),
    ).resolves.toEqual(paused);
    await expect(
      resumeBrowserSession("thread_web_control", "run_web_control", {
        expectedPauseStateSha256: paused.contentSha256,
      }),
    ).resolves.toEqual(running);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/threads/thread_web_control/runs/run_web_control/browser-session-control/pause",
      expect.objectContaining({ method: "POST" }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/threads/thread_web_control/runs/run_web_control/browser-session-control/resume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedPauseStateSha256: paused.contentSha256,
        }),
      }),
    ]);
  });

  it("rejects tampered hashes and cross-Run state", async () => {
    const running = await state("running");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ ...running, status: "paused", pauseRequestedAt: "x" }),
        )
        .mockResolvedValueOnce(
          response({
            ...running,
            runId: "run_other",
            contentSha256: await contentSha256({
              ...running,
              runId: "run_other",
            }),
          }),
        )
        .mockResolvedValueOnce(
          response({
            ...running,
            privatePageText: "PRIVATE_PAGE_CONTENT",
            contentSha256: await contentSha256({
              ...running,
              privatePageText: "PRIVATE_PAGE_CONTENT",
            }),
          }),
        ),
    );

    await expect(
      getBrowserSessionPauseState("thread_web_control", "run_web_control"),
    ).rejects.toThrow("hash mismatch");
    await expect(
      getBrowserSessionPauseState("thread_web_control", "run_web_control"),
    ).rejects.toThrow("response is invalid");
    await expect(
      getBrowserSessionPauseState("thread_web_control", "run_web_control"),
    ).rejects.toThrow("response is invalid");
  });
});

async function state(
  status: "running" | "paused",
  timestamps: { pauseRequestedAt?: string; resumedAt?: string } = {},
) {
  const content = {
    kind: "napier.browser-session-pause-state" as const,
    schemaVersion: 1 as const,
    threadId: "thread_web_control",
    runId: "run_web_control",
    status,
    ...(status === "paused"
      ? { pauseRequestedAt: "2026-08-04T00:00:00.000Z" }
      : {}),
    ...timestamps,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

function response(body: Record<string, unknown>): Response {
  const contentSha256 = body["contentSha256"] as string;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": contentSha256,
      "X-Napier-Content-SHA256-Mode": "stable",
    },
  });
}

async function contentSha256(value: Record<string, unknown>): Promise<string> {
  const { contentSha256: _contentSha256, ...content } = value;
  return await sha256Text(canonicalJson(content));
}
