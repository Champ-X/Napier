import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run lease startup reconciliation", () => {
  it("preserves an unexpired lease for a second bare Store", async () => {
    const options = await fixture();
    const first = await openStore(options);
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Shared active lease",
      agentId: agent.id,
    });
    const leased = await first.createLeasedRun(
      { threadId: thread.id, agentId: agent.id },
      { ownerId: "worker_shared_lease", ttlMs: 60_000 },
    );

    const second = await openStore(options);

    expect(second.listRuns(thread.id)).toContainEqual(
      expect.objectContaining({
        id: leased.run.id,
        status: "running",
        lease: expect.objectContaining({ ownerId: "worker_shared_lease" }),
      }),
    );
    expect(second.getThread(thread.id)).toEqual(
      expect.objectContaining({
        status: "running",
        currentRunId: leased.run.id,
      }),
    );
    expect(
      (await second.listEvents(thread.id)).some(
        (event) =>
          event.runId === leased.run.id && event.type === "run.interrupted",
      ),
    ).toBe(false);
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-lease-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return {
    dataRoot: path.join(root, "state"),
    workspaceRoot,
  };
}

async function openStore(options: {
  dataRoot: string;
  workspaceRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(options);
  stores.push(store);
  await store.initialize();
  return store;
}
