import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Thread trash", () => {
  it("hides settled Threads reversibly without deleting evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-thread-trash-"));
    roots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const store = new LocalStore(options);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Reversible trash",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });

    await expect(store.trashThread(thread.id)).rejects.toThrow(
      "active work cannot be moved to trash",
    );
    await store.finishRun(run.id, "completed");
    await store.trashThread(thread.id);
    expect(store.listVisibleThreads()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: thread.id })]),
    );
    expect(store.getThread(thread.id).id).toBe(thread.id);

    store.close();
    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.listVisibleThreads()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: thread.id })]),
    );
    await reopened.restoreThread(thread.id);
    expect(reopened.listVisibleThreads()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: thread.id })]),
    );
    expect(
      (await reopened.getDetail(thread.id)).events
        .filter((event) => event.type.startsWith("thread."))
        .map((event) => event.type),
    ).toEqual(["thread.trashed", "thread.restored"]);
  });
});
