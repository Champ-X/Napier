import { describe, expect, it, vi } from "vitest";

import { loadKernelProjectionEvents } from "../src/kernel-projection-event-loader.js";

describe("loadKernelProjectionEvents", () => {
  it("returns an empty list when the requested range is empty", async () => {
    const listEvents = vi.fn();
    const listEventsRange = vi.fn();
    await expect(
      loadKernelProjectionEvents(
        {
          getThread: () => {
            throw new Error("unused");
          },
          listEvents,
          listEventsRange,
        },
        "thread_1",
        4,
        4,
      ),
    ).resolves.toEqual([]);
    expect(listEvents).not.toHaveBeenCalled();
    expect(listEventsRange).not.toHaveBeenCalled();
  });

  it("prefers a complete bounded listEventsRange when available", async () => {
    const events = [{ seq: 3 } as never];
    const listEventsRange = vi.fn(async () => events);
    await expect(
      loadKernelProjectionEvents(
        {
          getThread: () => {
            throw new Error("unused");
          },
          listEvents: vi.fn(),
          listEventsRange,
        },
        "thread_1",
        2,
        9,
      ),
    ).resolves.toBe(events);
    expect(listEventsRange).toHaveBeenCalledWith("thread_1", 3, 9);
  });

  it("falls back to listEvents and clips to the watermark", async () => {
    const listEvents = vi.fn(
      async () => [{ seq: 3 }, { seq: 4 }, { seq: 5 }] as never[],
    );
    await expect(
      loadKernelProjectionEvents(
        {
          getThread: () => {
            throw new Error("unused");
          },
          listEvents,
        },
        "thread_1",
        2,
        4,
      ),
    ).resolves.toEqual([{ seq: 3 }, { seq: 4 }]);
  });

  it("preserves interleaved event types on the listEvents fallback", async () => {
    const listEvents = vi.fn(
      async () =>
        [
          { seq: 3, type: "message.user" },
          { seq: 4, type: "tool.started" },
          { seq: 5, type: "message.assistant" },
        ] as never[],
    );
    await expect(
      loadKernelProjectionEvents(
        {
          getThread: () => {
            throw new Error("unused");
          },
          listEvents,
        },
        "thread_1",
        2,
        5,
      ),
    ).resolves.toEqual([
      { seq: 3, type: "message.user" },
      { seq: 4, type: "tool.started" },
      { seq: 5, type: "message.assistant" },
    ]);
  });
});
