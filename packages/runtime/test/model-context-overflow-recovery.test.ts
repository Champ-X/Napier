import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isModelContextOverflowMessage,
  recoverModelContextOverflow,
} from "../src/model-context-overflow-recovery.js";

afterEach(() => vi.useRealTimers());

describe("model context overflow recovery", () => {
  it.each([
    "maximum context length exceeded",
    "context_length_exceeded",
    "prompt is too long: too many input tokens",
    "input token count exceeds model context window",
  ])("recognizes provider-confirmed overflow: %s", (message) => {
    expect(isModelContextOverflowMessage(message)).toBe(true);
  });

  it.each([
    "429 rate limit exceeded",
    "request too large: image payload",
    "response hit the output token limit",
    "network timeout",
  ])("does not classify unrelated failures: %s", (message) => {
    expect(isModelContextOverflowMessage(message)).toBe(false);
  });

  it("hides the first failed stream and recovers once", async () => {
    const recover = vi.fn(async () => successfulStream("recovered"));
    const stream = recoverModelContextOverflow({
      nativeAccounting: false,
      source: failedStream("Maximum context length exceeded"),
      signal: new AbortController().signal,
      recover,
    });

    const events = await collect(stream);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(await stream.result()).toEqual(
      expect.objectContaining({
        stopReason: "stop",
        content: [{ type: "text", text: "recovered" }],
      }),
    );
  });

  it("never retries after visible output or cancellation", async () => {
    const recover = vi.fn(async () => successfulStream("unused"));
    const controller = new AbortController();
    controller.abort();
    await collect(
      recoverModelContextOverflow({
        nativeAccounting: false,
      source: failedStream("Maximum context length exceeded"),
        signal: controller.signal,
        recover,
      }),
    );
    expect(recover).not.toHaveBeenCalled();

    const visible = createAssistantMessageEventStream();
    const partial = fauxAssistantMessage("partial");
    visible.push({ type: "start", partial });
    visible.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "partial",
      partial,
    });
    const failure = failureMessage("Maximum context length exceeded");
    visible.push({ type: "error", reason: "error", error: failure });
    await collect(
      recoverModelContextOverflow({
        nativeAccounting: false,
      source: visible,
        signal: new AbortController().signal,
        recover,
      }),
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("exposes the second overflow without retrying again", async () => {
    const recover = vi.fn(async () =>
      failedStream("context_length_exceeded again"),
    );
    const stream = recoverModelContextOverflow({
      nativeAccounting: false,
      source: failedStream("Maximum context length exceeded"),
      signal: new AbortController().signal,
      recover,
    });

    const events = await collect(stream);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["start", "error"]);
    expect(events[1]).toEqual(expect.objectContaining({ type: "error" }));
    expect((await stream.result()).stopReason).toBe("error");
  });
  it("does not substitute native receipt certainty with an error message or fake handle", async () => {
    const recover = vi.fn(async () => successfulStream("unused"));
    const onOverflow = vi.fn(async () => undefined);
    const stream = recoverModelContextOverflow({ source: failedStream("context_length_exceeded"),
      signal: new AbortController().signal, nativeAccounting: true, remainingMs: () => 1_000,
      recovery: () => ({ handle: {} as never }), onOverflow, recover });
    await collect(stream);
    expect(recover).not.toHaveBeenCalled();
    expect(onOverflow).toHaveBeenCalledWith(expect.anything(), { action: "finalize", readiness: "invalid_handle" });
  });

  it.each(["pending_timeout", "cancelled"] as const)("observes overflow once when publication ends in %s", async (reason) => {
    vi.useFakeTimers();
    const recover = vi.fn(async () => successfulStream("unused"));
    const controller = new AbortController();
    const onRecoveryStopped = vi.fn(async (_readiness: "cancelled" | "pending_timeout") => undefined);
    const decisions: string[] = [];
    const stream = recoverModelContextOverflow({ source: failedStream("context_length_exceeded"),
      signal: controller.signal, nativeAccounting: false, remainingMs: () => 50,
      onOverflow: async (_error, decision) => {
        decisions.push(`${decision.action}:${decision.readiness}`);
        if (reason === "pending_timeout") vi.setSystemTime(Date.now() + 51);
        else controller.abort();
      }, onRecoveryStopped, recover });
    await collect(stream);
    expect(recover).not.toHaveBeenCalled();
    expect(decisions).toEqual(["retry:legacy_unaccounted"]);
    expect(onRecoveryStopped).toHaveBeenCalledExactlyOnceWith(reason);
    expect((await stream.result()).stopReason).toBe("error");
  });

  it("shares a single retry budget across route and thinking wrapper instances", async () => {
    let used = false;
    const claimRetry = () => { if (used) return false; used = true; return true; };
    const recover = vi.fn(async () => successfulStream("recovered")), decisions: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = recoverModelContextOverflow({ source: failedStream("context_length_exceeded"),
        signal: new AbortController().signal, nativeAccounting: false, claimRetry,
        onOverflow: async (_error, decision) => { decisions.push(`${decision.action}:${decision.readiness}`); }, recover });
      await collect(stream);
    }
    expect(recover).toHaveBeenCalledOnce();
    expect(decisions).toEqual(["retry:legacy_unaccounted", "finalize:retry_exhausted"]);
  });

  it("does not replay after a visible tool-call event", async () => {
    const source = createAssistantMessageEventStream(), recover = vi.fn(async () => successfulStream("unused"));
    const partial = fauxAssistantMessage([{ type: "toolCall", id: "visible", name: "read_file", arguments: { path: "a" } }]);
    source.push({ type: "toolcall_delta", contentIndex: 0, delta: "{", partial });
    source.push({ type: "error", reason: "error", error: failureMessage("context_length_exceeded") });
    const stream = recoverModelContextOverflow({ source, signal: new AbortController().signal, nativeAccounting: false, recover });
    expect((await collect(stream)).map((event) => event.type)).toEqual(["toolcall_delta", "error"]);
    expect(recover).not.toHaveBeenCalled();
  });

  it("rejects the result promise when recovery fails instead of leaving it pending", async () => {
    const stream = recoverModelContextOverflow({ source: failedStream("context_length_exceeded"),
      signal: new AbortController().signal, nativeAccounting: false,
      recover: async () => { throw new Error("No smaller request"); } });
    await expect(collect(stream)).rejects.toThrow("No smaller request");
    await expect(stream.result()).rejects.toThrow("No smaller request");
  });

});

function successfulStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = fauxAssistantMessage(text);
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  return stream;
}

function failedStream(message: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const error = failureMessage(message);
  stream.push({ type: "start", partial: error });
  stream.push({ type: "error", reason: "error", error });
  return stream;
}

function failureMessage(message: string): AssistantMessage {
  return {
    ...fauxAssistantMessage(""),
    stopReason: "error",
    errorMessage: message,
  };
}

async function collect(stream: AssistantMessageEventStream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}
