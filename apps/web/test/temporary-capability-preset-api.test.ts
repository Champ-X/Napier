import { createHash } from "node:crypto";

import type { StreamFrame } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamPrompt } from "../src/api";
import { NapierStreamResponseContractError } from "../src/api-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("temporary capability preset Web protocol", () => {
  it("binds the preset in the prompt body and response headers", async () => {
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) => {
        expect(init?.body).toBe(
          JSON.stringify({
            text: "Use Browser for this Run.",
            capabilityPreset: "browser",
          }),
        );
        return response("browser");
      }),
    );

    await streamPrompt(
      "thread_1",
      { text: "Use Browser for this Run.", capabilityPreset: "browser" },
      (frame) => frames.push(frame),
    );
    expect(frames).toEqual([errorFrame()]);
  });

  it("rejects missing preset evidence before dispatching a frame", async () => {
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );

    await expect(
      streamPrompt(
        "thread_1",
        { text: "Use Browser for this Run.", capabilityPreset: "browser" },
        onFrame,
      ),
    ).rejects.toBeInstanceOf(NapierStreamResponseContractError);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("rejects mismatched run.started preset evidence before dispatch", async () => {
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("browser", startedFrame("coding"))),
    );

    await expect(
      streamPrompt(
        "thread_1",
        { text: "Use Browser for this Run.", capabilityPreset: "browser" },
        onFrame,
      ),
    ).rejects.toBeInstanceOf(NapierStreamResponseContractError);
    expect(onFrame).not.toHaveBeenCalled();
  });
});

function response(
  preset?: string,
  frame: StreamFrame = errorFrame(),
): Response {
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Napier-Thread-Id": "thread_1",
    "X-Napier-Prompt-Requested": "true",
    "X-Napier-Stream-Error-Code": "run_failed",
    "X-Napier-Stream-Error-Diagnostic": "sha256",
    "X-Napier-Stream-Error-Message-SHA256": sha256(
      "Run failed while streaming.",
    ),
  });
  if (preset) headers.set("X-Napier-Capability-Preset", preset);
  const id = frame.type === "event" ? `id: ${String(frame.event.seq)}\n` : "";
  return new Response(
    `${id}event: ${frame.type}\ndata: ${JSON.stringify(frame)}`,
    { headers },
  );
}

function errorFrame(): Extract<StreamFrame, { type: "error" }> {
  return {
    type: "error",
    threadId: "thread_1",
    message: "Run failed while streaming.",
    code: "run_failed",
    diagnosticSha256: "a".repeat(64),
  };
}

function startedFrame(
  capabilityPreset: string,
): Extract<StreamFrame, { type: "event" }> {
  const event = {
    id: "event_started",
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type: "run.started",
    category: "lifecycle",
    visibility: "debug",
    createdAt: "2026-08-11T00:00:00.000Z",
    payload: { capabilityPreset },
  } as const;
  return {
    type: "event",
    event,
    eventSha256: sha256(JSON.stringify(event)),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
