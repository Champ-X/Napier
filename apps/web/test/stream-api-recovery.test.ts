import { createHash } from "node:crypto";

import type { RunEvent, RunRecord, StreamFrame } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resumeInterruptedRun } from "../src/api";
import { latestManuallyResumableRun } from "../src/manual-run-recovery";

describe("recovery Run stream identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("binds frames to one recovery child after verifying the origin header", async () => {
    const firstEvent = eventFrame(14, "run_recovery");
    const driftingEvent = eventFrame(15, "run_other");
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 14\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `id: 15\nevent: event\ndata: ${JSON.stringify(driftingEvent)}`,
          ].join("\n"),
        ),
      ),
    );

    await expect(
      resumeInterruptedRun("thread_1", { runId: "run_interrupted" }, (frame) =>
        frames.push(frame),
      ),
    ).rejects.toMatchObject({
      name: "NapierStreamRunIdentityError",
      expectedRunId: "run_recovery",
      actualRunId: "run_other",
    });
    expect(frames).toEqual([firstEvent]);
  });

  it("sends an eligible partial settlement through the existing resume endpoint", async () => {
    const partial = partialRun();
    const resumable = latestManuallyResumableRun("idle", [partial]);
    const terminal: Extract<StreamFrame, { type: "error" }> = {
      type: "error",
      threadId: "thread_1",
      message: "Run failed while streaming.",
      code: "run_failed",
      diagnosticSha256: "a".repeat(64),
    };
    const frames: StreamFrame[] = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/resume");
      expect(init?.body).toBe(JSON.stringify({ runId: partial.id }));
      return sseResponse(
        `event: error\ndata: ${JSON.stringify(terminal)}`,
        partial.id,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(resumable).toEqual(partial);
    await resumeInterruptedRun("thread_1", { runId: resumable!.id }, (frame) =>
      frames.push(frame),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(frames).toEqual([terminal]);
  });
});

function partialRun(): RunRecord {
  return {
    id: "run_partial",
    threadId: "thread_1",
    agentId: "agent_napier",
    status: "failed",
    outcome: "partial",
    source: "user",
    startedAt: "2026-08-16T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function eventFrame(
  seq: number,
  runId: string,
): Extract<StreamFrame, { type: "event" }> {
  const event: RunEvent = {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type: "model.text.delta",
    category: "model",
    visibility: "user",
    createdAt: "2026-08-16T00:00:00.000Z",
    payload: { delta: "hello" },
  };
  return {
    type: "event",
    event,
    eventSha256: sha256(JSON.stringify(event)),
  };
}

function sseResponse(
  body: string,
  requestedRunId = "run_interrupted",
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Napier-Thread-Id": "thread_1",
        "X-Napier-Resume-Requested": "true",
        "X-Napier-Run-Id": requestedRunId,
        "X-Napier-Stream-Error-Code": "run_failed",
        "X-Napier-Stream-Error-Diagnostic": "sha256",
        "X-Napier-Stream-Error-Message-SHA256": sha256(
          "Run failed while streaming.",
        ),
      },
    },
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
