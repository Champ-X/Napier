import { describe, expect, it, vi } from "vitest";

import { SharedAbortableFlightPool } from "../src/shared-abortable-flight-pool.js";

describe("SharedAbortableFlightPool", () => {
  it("coalesces equal work while isolating subscriber cancellation", async () => {
    const pool = new SharedAbortableFlightPool<string>();
    let finish!: (value: string) => void;
    const start = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelled = new AbortController();
    const first = pool.run("run", "resource", cancelled.signal, start);
    const second = pool.run(
      "run",
      "resource",
      new AbortController().signal,
      start,
    );
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finish("done");
    await expect(second).resolves.toBe("done");
  });

  it("aborts and drains all work in a cancelled scope", async () => {
    const pool = new SharedAbortableFlightPool<string>();
    const start = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const pending = pool.run(
      "run",
      "resource",
      new AbortController().signal,
      start,
    );
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    await pool.cancelScope("run");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not let an old scope drain delete a new generation", async () => {
    const pool = new SharedAbortableFlightPool<string>();
    let rejectOld!: (reason: unknown) => void;
    const old = pool.run(
      "run",
      "old",
      new AbortController().signal,
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          rejectOld = reject;
          signal.addEventListener("abort", () => undefined, { once: true });
        }),
    );
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));

    const cancelling = pool.cancelScope("run");
    const fresh = pool.run(
      "run",
      "fresh",
      new AbortController().signal,
      async () => "fresh result",
    );
    await expect(fresh).resolves.toBe("fresh result");
    rejectOld(new DOMException("cancelled", "AbortError"));
    await cancelling;
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
  });

  it("can isolate callers that require distinct lifecycle evidence", async () => {
    const pool = new SharedAbortableFlightPool<string>();
    const start = vi.fn(async () => "result");

    await Promise.all([
      pool.run("run", "same", new AbortController().signal, start, false),
      pool.run("run", "same", new AbortController().signal, start, false),
    ]);

    expect(start).toHaveBeenCalledTimes(2);
  });
});
