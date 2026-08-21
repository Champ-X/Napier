import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  isModelContextOverflowMessage,
  recoverModelContextOverflow,
} from "../src/model-context-overflow-recovery.js";

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
