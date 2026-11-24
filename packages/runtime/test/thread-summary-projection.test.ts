import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ThreadSummary } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  KernelProjectionRegistry,
  ThreadSummaryProjectionService,
} from "../src/kernel-projections.js";
import { LocalStore } from "../src/store.js";

describe("Thread summary projection", () => {
  it("matches the Store summary contract and follows trash visibility by tail replay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-projection-"));
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    const registry = new KernelProjectionRegistry();
    const service = new ThreadSummaryProjectionService(registry, store);

    try {
      await store.initialize();
      const thread = store.listThreads()[0]!;
      expect(await service.listVisible()).toEqual(
        store.listVisibleThreads().map(summaryContract),
      );
      await store.trashThread(thread.id);
      const trashed = await service.project(thread.id);
      expect(trashed).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({ visible: false }),
        }),
      );
      expect(await service.listVisible()).toEqual([]);

      await store.restoreThread(thread.id);
      const restored = await service.project(thread.id);
      expect(restored).toEqual(
        expect.objectContaining({
          cacheHit: true,
          appliedEventCount: 1,
          view: expect.objectContaining({ visible: true }),
        }),
      );
      expect(await service.listVisible()).toEqual(
        store.listVisibleThreads().map(summaryContract),
      );
    } finally {
      registry.shutdown();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

function summaryContract(thread: ThreadSummary): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    agentId: thread.agentId,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessage: thread.lastMessage,
    eventCount: thread.eventCount,
    ...(thread.goal ? { goal: structuredClone(thread.goal) } : {}),
  };
}
