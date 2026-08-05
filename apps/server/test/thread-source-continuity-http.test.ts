import type { ThreadDetail } from "@napier/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerThreadExecutionHttp } from "../src/thread-execution-http.js";

describe("Thread Source continuity HTTP", () => {
  it("forwards the exact requested source Run and exposes bounded intent", async () => {
    const threadId = "thread_sourcepin";
    const runId = "run_current1234";
    const sourceRunId = "run_source12345";
    const runPrompt = vi.fn(async () => ({ id: runId, status: "completed" }));
    const app = new Hono();
    registerThreadExecutionHttp(app, {
      store: { getDetail: vi.fn(async () => detail(threadId, runId)) },
      models: {} as never,
      runtime: {
        runPrompt,
        resumeInterruptedRun: vi.fn(),
        continueOperatorDecision: vi.fn(),
        stop: vi.fn(),
      },
    });

    const response = await app.request(`/api/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Continue the pinned private Sources.",
        sourceContinuityRunId: sourceRunId,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-source-continuity-run-id")).toBe(
      sourceRunId,
    );
    await response.text();
    expect(runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        text: "Continue the pinned private Sources.",
        sourceContinuityRunId: sourceRunId,
        onEvent: expect.any(Function),
      }),
    );
  });
});

function detail(threadId: string, runId: string): ThreadDetail {
  return {
    thread: {
      id: threadId,
      eventCount: 0,
    },
    runs: [
      {
        id: runId,
        status: "completed",
      },
    ],
    events: [],
  } as unknown as ThreadDetail;
}
