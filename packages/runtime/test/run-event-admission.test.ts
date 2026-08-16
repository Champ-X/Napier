import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunEventAdmissionError } from "../src/run-event-admission.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run event admission", () => {
  it("accepts active Run events and omits the admission request from the Ledger", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);

    const event = await store.appendEvent({
      threadId,
      runId,
      type: "model.text.delta",
      category: "model",
      visibility: "hidden",
      payload: { delta: "active" },
      admission: "run_active",
    });

    expect(event).toEqual(
      expect.objectContaining({
        seq: 1,
        type: "model.text.delta",
        payload: { delta: "active" },
      }),
    );
    expect(event).not.toHaveProperty("admission");
  });

  it("rejects a stale writer after another Store terminates the Run", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);
    const before = second.getPersistenceMetrics();

    await first.finishRun(runId, "completed");

    await expect(
      second.appendEvent({
        threadId,
        runId,
        type: "model.text.delta",
        category: "model",
        visibility: "hidden",
        payload: { delta: "late" },
        admission: "run_active",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );

    expect(second.getPersistenceMetrics().commitCount).toBe(before.commitCount);
    expect(second.getThread(threadId).eventCount).toBe(0);
    expect(await second.listEvents(threadId)).toEqual([]);
  });

  it("preserves explicit retrospective audit events after Run termination", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    await store.finishRun(runId, "cancelled");

    await expect(
      store.appendEvent({
        threadId,
        runId,
        type: "model.stream.cancellation_failed",
        category: "model",
        visibility: "debug",
        payload: { status: "observed" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        seq: 1,
        type: "model.stream.cancellation_failed",
      }),
    );
  });
});

async function openStore(
  dataRoot?: string,
  workspaceRoot?: string,
): Promise<LocalStore> {
  if (!dataRoot || !workspaceRoot) {
    const root = await mkdtemp(path.join(tmpdir(), "napier-run-admission-"));
    roots.push(root);
    dataRoot = path.join(root, "data");
    workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
  }
  const store = new LocalStore({ dataRoot, workspaceRoot });
  stores.push(store);
  await store.initialize();
  return store;
}

async function createRun(
  store: LocalStore,
): Promise<{ threadId: string; runId: string }> {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Run event admission",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  return { threadId: thread.id, runId: run.id };
}
