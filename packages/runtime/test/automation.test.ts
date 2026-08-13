import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { AutomationService, scheduleTriggerId } from "../src/automation.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-automation-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const runtime = new AgentRuntime(store, new ModelRegistry());
  return { store, runtime };
}

describe("AutomationService", () => {
  it("runs a due schedule through the normal Agent ledger exactly once", async () => {
    const { store, runtime } = await createFixture();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Automated ledger",
      agentId: agent.id,
    });
    const schedule = await store.createSchedule({
      name: "Periodic review",
      threadId: thread.id,
      prompt: "Review this ledger without fabricating external evidence.",
      trigger: { type: "interval", everyMs: 60_000 },
    });
    const automation = new AutomationService(store, runtime, {
      workerId: "scheduler.test",
      claimTtlMs: 30_000,
    });

    const result = await automation.tick(new Date(schedule.nextRunAt));
    expect(result).toEqual({
      claimed: 1,
      skipped: 0,
      completed: 1,
      failed: 0,
      deduplicated: 0,
    });
    const [run] = store.listRuns(thread.id);
    expect(run).toEqual(
      expect.objectContaining({
        source: "schedule",
        status: "completed",
        triggerId: scheduleTriggerId(schedule.id, schedule.nextRunAt),
      }),
    );
    const settled = store.getSchedule(schedule.id);
    expect(settled).toEqual(
      expect.objectContaining({
        lastRunId: run!.id,
        lastScheduledFor: schedule.nextRunAt,
      }),
    );
    expect(Date.parse(settled.nextRunAt)).toBeGreaterThan(
      Date.parse(schedule.nextRunAt),
    );
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "schedule.claimed",
        "run.started",
        "message.user",
        "run.completed",
        "schedule.completed",
      ]),
    );

    const repeated = await automation.tick(new Date(schedule.nextRunAt));
    expect(repeated.claimed).toBe(0);
    expect(store.listRuns(thread.id)).toHaveLength(1);
  });

  it("fails a due schedule before creating a Run when its model is unavailable", async () => {
    const { store, runtime } = await createFixture();
    const unavailable = fauxProvider({ provider: "faux-schedule-unavailable" });
    runtime.modelRegistry.registerProvider({
      ...unavailable.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Unavailable scheduled model",
      agentId: agent.id,
    });
    const schedule = await store.createSchedule({
      name: "Unavailable provider",
      threadId: thread.id,
      prompt: "This should not create a Run.",
      model: { provider: "faux-schedule-unavailable", id: "faux-1" },
      trigger: { type: "interval", everyMs: 60_000 },
    });
    const automation = new AutomationService(store, runtime, {
      workerId: "scheduler.unavailable",
      claimTtlMs: 30_000,
    });

    const result = await automation.tick(new Date(schedule.nextRunAt));

    expect(result).toEqual({
      claimed: 1,
      skipped: 0,
      completed: 0,
      failed: 1,
      deduplicated: 0,
    });
    expect(store.listRuns(thread.id)).toHaveLength(0);
    const settled = store.getSchedule(schedule.id);
    expect(settled).toEqual(
      expect.objectContaining({
        lastError:
          "Model provider is not configured: faux-schedule-unavailable",
        lastScheduledFor: schedule.nextRunAt,
      }),
    );
    expect(Date.parse(settled.nextRunAt)).toBeGreaterThan(
      Date.parse(schedule.nextRunAt),
    );
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual([
      "schedule.claimed",
      "schedule.failed",
    ]);
    expect(events[1]?.payload).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-schedule-unavailable",
      }),
    );
  });
});
