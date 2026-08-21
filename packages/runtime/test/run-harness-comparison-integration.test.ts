import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareRuns, createRunReplaySnapshot } from "../src/run-replay.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run Harness comparison integration", () => {
  it("adds Harness evidence to comparisons without changing replay v1 snapshots", async () => {
    const store = await fixtureStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Harness comparison",
      agentId: agent.id,
    });
    const runs = [];
    for (let index = 0; index < 2; index += 1) {
      const run = await store.createRun({
        threadId: thread.id,
        agentId: agent.id,
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "message.user",
        category: "message",
        visibility: "user",
        payload: { role: "user", text: "Same task" },
      });
      await store.finishRun(run.id, "completed");
      runs.push(run);
    }
    const [left, right] = runs;

    const snapshot = await createRunReplaySnapshot(store, thread.id, left!.id);
    const comparison = await compareRuns(store, thread.id, left!.id, right!.id);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot).not.toHaveProperty("harness");
    expect(comparison.harness).toEqual(
      expect.objectContaining({
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        left: expect.objectContaining({
          eventStreamSha256: comparison.left.eventStreamSha256,
        }),
        right: expect.objectContaining({
          eventStreamSha256: comparison.right.eventStreamSha256,
        }),
        fairness: expect.objectContaining({ status: "comparable" }),
      }),
    );
    expect(JSON.stringify(comparison.harness)).not.toContain("Same task");
    store.close();
  });
});

async function fixtureStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-harness-comparison-"));
  roots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  await store.initialize();
  return store;
}
