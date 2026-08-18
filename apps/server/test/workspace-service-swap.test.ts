import { describe, expect, it, vi } from "vitest";

import { WorkspaceServiceGraphCache } from "../src/workspace-service-swap.js";

interface FakeGraph {
  root: string;
}

function fixture(maxEntries = 3) {
  const order: string[] = [];
  const prepared: string[] = [];
  const cache = new WorkspaceServiceGraphCache<FakeGraph>({
    initialRoot: "a",
    initialGraph: { root: "a" },
    maxEntries,
    prepare: async (root) => {
      prepared.push(root);
      order.push(`prepare:${root}`);
      return { root };
    },
    pause: async (graph) => {
      order.push(`pause:${graph.root}`);
    },
    resume: (graph) => order.push(`resume:${graph.root}`),
    activate: (graph) => order.push(`activate:${graph.root}`),
    dispose: async (graph) => {
      order.push(`dispose:${graph.root}`);
    },
    onDisposeError: vi.fn(),
  });
  return { cache, order, prepared };
}

describe("workspace service graph cache", () => {
  it("keeps the current graph active when cold preparation fails", async () => {
    const activate = vi.fn();
    const pause = vi.fn();
    const cache = new WorkspaceServiceGraphCache<FakeGraph>({
      initialRoot: "current",
      initialGraph: { root: "current" },
      prepare: async () => {
        throw new Error("candidate failed");
      },
      pause,
      resume: vi.fn(),
      activate,
      dispose: vi.fn(),
      onDisposeError: vi.fn(),
    });

    await expect(cache.switchTo("candidate")).rejects.toThrow(
      "candidate failed",
    );
    expect(cache.current().root).toBe("current");
    expect(pause).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    await cache.shutdown();
  });

  it("pauses, resumes, and reuses a warm graph without preparing it twice", async () => {
    const { cache, order, prepared } = fixture();

    await expect(cache.switchTo("b")).resolves.toEqual({ root: "b" });
    expect(order).toEqual(["prepare:b", "pause:a", "resume:b", "activate:b"]);

    order.length = 0;
    await cache.switchTo("a");
    expect(order).toEqual(["pause:b", "resume:a", "activate:a"]);
    expect(prepared).toEqual(["b"]);
    await cache.shutdown();
  });

  it("deduplicates concurrent prewarming and keeps it inactive", async () => {
    const { cache, order, prepared } = fixture();

    const [left, right] = await Promise.all([
      cache.prewarm("b"),
      cache.prewarm("b"),
    ]);
    expect(left).toBe(right);
    expect(prepared).toEqual(["b"]);
    expect(order).toEqual(["prepare:b"]);
    expect(cache.current().root).toBe("a");
    await cache.shutdown();
  });

  it("restores the authoritative graph when pausing it fails", async () => {
    const order: string[] = [];
    const current = { root: "a" };
    const cache = new WorkspaceServiceGraphCache<FakeGraph>({
      initialRoot: "a",
      initialGraph: current,
      prepare: async (root) => ({ root }),
      pause: async (graph) => {
        order.push(`pause:${graph.root}`);
        if (graph === current) throw new Error("pause failed");
      },
      resume: (graph) => order.push(`resume:${graph.root}`),
      activate: (graph) => order.push(`activate:${graph.root}`),
      dispose: async () => undefined,
      onDisposeError: vi.fn(),
    });

    await expect(cache.switchTo("b")).rejects.toThrow("pause failed");
    expect(cache.current()).toBe(current);
    expect(order).toEqual(["pause:a", "resume:a"]);
    await cache.shutdown();
  });

  it("evicts the least-recent inactive graph and disposes every graph at shutdown", async () => {
    const { cache, order } = fixture(2);

    await cache.switchTo("b");
    await cache.switchTo("c");
    await vi.waitFor(() => expect(order).toContain("dispose:a"));
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);

    await cache.shutdown();
    expect(order).toContain("dispose:b");
    expect(order).toContain("dispose:c");
  });
});
