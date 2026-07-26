import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-automation-store-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ dataRoot, workspaceRoot });
  await store.initialize();
  return { store, dataRoot };
}

describe("automation persistence", () => {
  it("hashes run lease tokens and enforces ownership on renewal and finish", async () => {
    const { store, dataRoot } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Leased run",
      agentId: agent.id,
    });
    const leased = await store.createLeasedRun(
      {
        threadId: thread.id,
        agentId: agent.id,
        source: "schedule",
        triggerId: "schedule:test:2026-07-25T00:00:00.000Z",
      },
      { ownerId: "worker.test", ttlMs: 30_000 },
    );

    expect(leased.run.lease).toEqual(
      expect.objectContaining({ ownerId: "worker.test", revision: 1 }),
    );
    await expect(
      store.renewRunLease(leased.run.id, "wrong-token", 30_000),
    ).rejects.toThrow("invalid");
    const renewed = await store.renewRunLease(
      leased.run.id,
      leased.token,
      30_000,
    );
    expect(renewed.lease?.revision).toBe(2);
    await expect(store.finishRun(leased.run.id, "completed")).rejects.toThrow(
      "token is required",
    );
    const finished = await store.finishRun(leased.run.id, "completed", {
      leaseToken: leased.token,
    });
    expect(finished.lease).toBeUndefined();

    const state = await readFile(path.join(dataRoot, "workspace.json"), "utf8");
    expect(state).not.toContain(leased.token);
    expect(state).not.toContain("leaseTokenSha256");
    await expect(
      store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        triggerId: "schedule:test:2026-07-25T00:00:00.000Z",
      }),
    ).rejects.toThrow("Run trigger already exists");
  });

  it("claims due schedules once, rejects stale tokens, and advances settlement", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Scheduled work",
      agentId: agent.id,
    });
    const schedule = await store.createSchedule({
      name: "Ledger review",
      threadId: thread.id,
      prompt: "Review the ledger.",
      trigger: { type: "interval", everyMs: 60_000 },
    });
    const dueAt = new Date(schedule.nextRunAt);
    const first = await store.claimDueSchedules("scheduler.one", {
      now: dueAt,
      leaseMs: 30_000,
    });
    expect(first.claims).toHaveLength(1);
    expect(first.skipped).toHaveLength(0);
    const second = await store.claimDueSchedules("scheduler.two", {
      now: dueAt,
      leaseMs: 30_000,
    });
    expect(second.claims).toHaveLength(0);
    const claim = first.claims[0]!;
    await expect(
      store.settleScheduleClaim(schedule.id, "wrong-token", {
        error: "must not settle",
      }),
    ).rejects.toThrow("invalid");
    const paused = await store.updateSchedule(schedule.id, {
      status: "paused",
    });
    expect(paused.claim).toEqual(
      expect.objectContaining({ scheduledFor: claim.scheduledFor }),
    );
    const settled = await store.settleScheduleClaim(
      schedule.id,
      claim.token,
      {},
    );
    expect(settled.claim).toBeUndefined();
    expect(settled.lastScheduledFor).toBe(claim.scheduledFor);
    expect(Date.parse(settled.nextRunAt)).toBeGreaterThan(
      Date.parse(claim.scheduledFor),
    );
  });

  it("records overlap skips instead of starting a second thread run", async () => {
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Overlap",
      agentId: agent.id,
    });
    const schedule = await store.createSchedule({
      name: "No overlap",
      threadId: thread.id,
      prompt: "Do not overlap.",
      trigger: { type: "interval", everyMs: 60_000 },
    });
    const activeRun = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const due = await store.claimDueSchedules("scheduler.overlap", {
      now: new Date(schedule.nextRunAt),
    });
    expect(due.claims).toHaveLength(0);
    expect(due.skipped).toEqual([
      expect.objectContaining({
        scheduledFor: schedule.nextRunAt,
        reason: expect.stringContaining(activeRun.id),
      }),
    ]);
    await store.finishRun(activeRun.id, "completed");
  });
});
