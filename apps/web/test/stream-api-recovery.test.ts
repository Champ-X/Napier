import { createHash } from "node:crypto";

import type { RunEvent, StreamFrame } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resumeInterruptedRun } from "../src/api";

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
});

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

function sseResponse(body: string): Response {
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
        "X-Napier-Run-Id": "run_interrupted",
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
