import { afterEach, expect, it, vi } from "vitest";
import { streamPrompt } from "../src/api";
import { NapierStreamResponseContractError } from "../src/api-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "cancels a response rejected before stream parsing (cancellation fails: %s)",
  async (cancelFails) => {
    const cancel = vi.fn(() => {
      if (cancelFails) throw new Error("Transport already closed");
    });
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, {
        headers: { "Content-Type": "application/json" },
      })),
    );
    const onFrame = vi.fn();
    await expect(streamPrompt("thread_1", { text: "hello" }, onFrame))
      .rejects.toBeInstanceOf(NapierStreamResponseContractError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
  },
);
