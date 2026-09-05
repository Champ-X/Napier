import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/index.js";
import {
  DurableToolOperationJournal,
  type ToolOperationDescriptor,
} from "../src/tool-operation-journal.js";

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

describe("durable tool operation execution lease", () => {
  it("persists generation fencing across LocalStore facades and repeated takeover", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-operation-lease-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const firstStore = await openStore(options);
    const agent = firstStore.listAgents()[0]!;
    const thread = await firstStore.createThread({
      title: "Operation lease takeover",
      agentId: agent.id,
    });
    const { run } = await firstStore.createLeasedRun(
      { threadId: thread.id, agentId: agent.id },
      { ownerId: "tool-operation-lease-test", ttlMs: 30_000 },
    );
    const owner = { threadId: thread.id, runId: run.id };
    let now = Date.parse("2026-09-03T12:00:00.000Z");

    const first = operation(firstStore, owner, "worker-a", () => now);
    expect(await first.admit()).toMatchObject({
      executionLease: { generation: 1 },
    });

    now += 10;
    const secondStore = await openStore(options);
    const second = operation(secondStore, owner, "worker-b", () => now);
    expect(await second.admit()).toMatchObject({
      admitted: true,
      executionLease: {
        generation: 2,
        disposition: "unstarted_takeover",
      },
    });

    now += 10;
    const thirdStore = await openStore(options);
    const third = operation(thirdStore, owner, "worker-c", () => now);
    expect(await third.admit()).toMatchObject({
      admitted: true,
      executionLease: {
        generation: 3,
        disposition: "unstarted_takeover",
      },
    });
    await expect(first.started()).rejects.toThrow("was fenced");
    await expect(second.started()).rejects.toThrow("was fenced");
    await third.started();
    await third.settled({ outcome: "succeeded", state: "generation-3" });

    const events = await thirdStore.listRunEvents(run.id);
    expect(
      events
        .filter((event) => event.type === "tool.operation.lease.granted")
        .map((event) => event.payload["executionLeaseGeneration"]),
    ).toEqual([2, 3]);
  });
});

async function openStore(options: {
  dataRoot: string;
  workspaceRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return store;
}

function operation(
  store: LocalStore,
  owner: { threadId: string; runId: string },
  ownerId: string,
  now: () => number,
) {
  return new DurableToolOperationJournal(store, owner, {
    now,
    executionLease: { ownerId, durationMs: 10 },
  })
    .observer("call_sqlite_repeated_takeover")
    .operation(operationDescriptor());
}

function operationDescriptor(): ToolOperationDescriptor {
  return {
    ordinal: 1,
    mode: "fetch",
    route: "fixture",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKey: { id: "stable-resource" },
    failureDomainKey: { route: "fixture" },
  };
}
