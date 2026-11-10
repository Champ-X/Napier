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

it("forwards AbortSignal to the workspace fetch", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBe(controller.signal);
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    streamPrompt("thread_1", { text: "hello" }, vi.fn(), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("rejects immediately when the AbortSignal is already aborted", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    streamPrompt(
      "thread_1",
      { text: "hello" },
      vi.fn(),
      AbortSignal.abort(),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});
