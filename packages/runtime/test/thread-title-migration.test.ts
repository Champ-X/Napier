import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("thread title migration", () => {
  it("migrates a legacy default title from the first user message", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-title-migration-"));
    temporaryRoots.push(root);
    const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
    const store = new LocalStore(options);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({ title: "Untitled ledger", agentId: agent.id });
    const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
    await store.appendEvent({
      threadId: thread.id, runId: run.id, type: "message.user",
      category: "message", visibility: "user",
      payload: { role: "user", text: "系统性优化运行中的决策流程" },
    });
    store.close();

    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.getThread(thread.id).title).toBe("系统性优化运行中的决策流程");
    reopened.close();
  });
});
