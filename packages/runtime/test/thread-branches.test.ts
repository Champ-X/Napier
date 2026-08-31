import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue, ThreadImportProvenance } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createThreadBranch,
  ThreadBranchRequestError,
} from "../src/thread-branches.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("sequence-accurate Thread branches", () => {
  it("binds the branch parent to the Run visible at sourceSeq", async () => {
    const store = await createStore();
    const source = await store.createThread({
      title: "Source   Thread",
      agentId: store.listAgents()[0]!.id,
    });
    const firstRun = await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "First request" }],
      ["message.assistant", { role: "assistant", text: "First answer" }],
    ]);
    const secondRun = await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Second request" }],
      ["message.assistant", { role: "assistant", text: "Second answer" }],
    ]);

    const result = await createThreadBranch(store, source.id, {
      fromSeq: 2,
    });

    expect(result.run).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: firstRun,
        branchFromSeq: 2,
      }),
    );
    expect(result.run.parentRunId).not.toBe(secondRun);
    expect(result.detail.thread).toEqual(
      expect.objectContaining({
        title: "Source Thread / branch",
        agentId: source.agentId,
      }),
    );
    expect(result.detail.events.map((event) => event.type)).toEqual([
      "branch.created",
      "message.user",
      "message.assistant",
    ]);
    expect(result.detail.events[0]?.payload).toEqual({
      sourceThreadId: source.id,
      sourceSeq: 2,
    });
    expect(JSON.stringify(result.detail)).not.toContain("Second request");
    expect(JSON.stringify(result.detail)).not.toContain("Second answer");
  });

  it("rejects invalid or future source sequences without creating a Thread", async () => {
    const store = await createStore();
    const source = await store.createThread({
      title: "Source",
      agentId: store.listAgents()[0]!.id,
    });
    await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Only request" }],
    ]);
    const before = store.listThreads().length;

    await expect(
      createThreadBranch(store, source.id, { fromSeq: 0 }),
    ).rejects.toBeInstanceOf(ThreadBranchRequestError);
    await expect(
      createThreadBranch(store, source.id, { fromSeq: 2 }),
    ).rejects.toThrow("exceeds the source Ledger");
    await expect(
      createThreadBranch(store, source.id, {
        fromSeq: 1,
        title: " ".repeat(2),
      }),
    ).rejects.toThrow("title must be");
    expect(store.listThreads()).toHaveLength(before);
  });

  it("preserves default branching for a maximum-length source title", async () => {
    const store = await createStore();
    const source = await store.createThread({
      title: "s".repeat(100),
      agentId: store.listAgents()[0]!.id,
    });
    await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Long-title request" }],
    ]);

    const result = await createThreadBranch(store, source.id, {
      fromSeq: 1,
    });

    expect(result.detail.thread.title).toBe("s".repeat(100));
    expect(result.detail.thread.title).toHaveLength(100);
  });

  it("creates distinct branches for concurrent requests at the same sequence", async () => {
    const store = await createStore();
    const source = await store.createThread({
      title: "Concurrent source",
      agentId: store.listAgents()[0]!.id,
    });
    const parentRunId = await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Concurrent request" }],
      ["message.assistant", { role: "assistant", text: "Concurrent answer" }],
    ]);

    const [left, right] = await Promise.all([
      createThreadBranch(store, source.id, {
        fromSeq: 2,
        title: "Left branch",
      }),
      createThreadBranch(store, source.id, {
        fromSeq: 2,
        title: "Right branch",
      }),
    ]);

    expect(left.detail.thread.id).not.toBe(right.detail.thread.id);
    expect([left.run.parentRunId, right.run.parentRunId]).toEqual([
      parentRunId,
      parentRunId,
    ]);
    expect([left.run.branchFromSeq, right.run.branchFromSeq]).toEqual([2, 2]);
  });

  it("does not copy user-visible run progress as conversation messages", async () => {
    const store = await createStore();
    const source = await store.createThread({
      title: "Progress source",
      agentId: store.listAgents()[0]!.id,
    });
    await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Inspect the project" }],
      [
        "run.progress.message",
        {
          sourceEventId: "event_source_progress",
          model: "faux/faux-1",
          toolNames: ["read_file"],
          text: "I will inspect the entry points.",
        },
      ],
      ["message.assistant", { role: "assistant", text: "Inspection done" }],
    ]);

    const result = await createThreadBranch(store, source.id, { fromSeq: 3 });

    expect(result.detail.events.map((event) => event.type)).toEqual([
      "branch.created",
      "message.user",
      "message.assistant",
    ]);
  });

  it("preserves imported provenance through the copied message boundary", async () => {
    const store = await createStore();
    const provenance: ThreadImportProvenance = {
      sourceThreadId: "thread_external_source",
      sourceApiVersion: "2026-07-25",
      sourceContentSha256: "a".repeat(64),
      sourceEventStreamSha256: "b".repeat(64),
      sourceEventCount: 8,
      localImportedThroughSeq: 8,
      importedAt: "2026-07-30T00:00:00.000Z",
    };
    const source = await store.createThread({
      title: "Imported source",
      agentId: store.listAgents()[0]!.id,
      importProvenance: provenance,
    });
    await appendRunMessages(store, source.id, [
      ["message.user", { role: "user", text: "Imported request" }],
      ["message.assistant", { role: "assistant", text: "Imported answer" }],
    ]);

    const result = await createThreadBranch(store, source.id, {
      fromSeq: 2,
      title: "Imported branch",
    });

    expect(result.detail.thread.importProvenance).toEqual({
      ...provenance,
      localImportedThroughSeq: 3,
    });
  });
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-thread-branch-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  openStores.push(store);
  return store;
}

async function appendRunMessages(
  store: LocalStore,
  threadId: string,
  messages: Array<[type: string, payload: JsonValue]>,
): Promise<string> {
  const thread = store.getThread(threadId);
  const run = await store.createRun({
    threadId,
    agentId: thread.agentId,
  });
  for (const [type, payload] of messages) {
    await store.appendEvent({
      threadId,
      runId: run.id,
      type,
      category: "message",
      visibility: "user",
      payload,
    });
  }
  await store.finishRun(run.id, "completed");
  return run.id;
}
