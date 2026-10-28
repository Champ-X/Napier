import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import {
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
} from "../src/kernel-projections.js";
import { createGoal } from "../src/goals.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-task-outcome-"));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Task facts",
    agentId: agent.id,
  });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return { store, thread, run };
}

describe("Shared task facts", () => {
  it("does not accept a completed run with an unfinished plan, on replay or cached projection", async () => {
    const { store, thread, run } = await setup();
    const registry = new KernelProjectionRegistry();
    const service = new TaskNarrativeProjectionService(registry, store);
    try {
      await store.createPlan(thread.id, {
        objective: "Deliver report and tests",
        steps: [
          {
            id: "test",
            title: "Verify report",
            description: "Run the independent check",
            verification: "Report meets requested criteria",
          },
        ],
      });
      expect((await service.project(thread.id)).view.execution).toBe("running");
      await store.finishRun(run.id, "completed");
      const canonical = (await store.getDetail(thread.id)).taskNarrative!;
      const warm = await service.project(thread.id);
      expect(warm.view).toEqual(canonical);
      expect(canonical).toMatchObject({
        phase: "ended",
        execution: "ended",
        phaseLabel: "Work remains",
        currentAction: "This run ended; unfinished work remains",
        objective: { status: "partial" },
        remainingItems: ["Verify report"],
        nextStep: "Verify report",
      });
      // Data changes without new narrative events must still invalidate the
      // derived facts; only the event reducer is cached.
      const resumed = await store.createRun({
        threadId: thread.id,
        agentId: run.agentId,
      });
      const next = await service.project(thread.id);
      expect(next.view).toMatchObject({
        phase: "working",
        execution: "running",
        metricRunId: resumed.id,
      });
      expect(next.view).toEqual(
        (await store.getDetail(thread.id)).taskNarrative,
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });

  it("keeps no-plan and failed-plan tasks unverified and tool counts out of results", async () => {
    const { store, thread, run } = await setup();
    try {
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.failed",
        category: "tool",
        visibility: "user",
        payload: {
          callId: "plan",
          toolName: "create_plan",
          error: "Plan not found",
        },
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.completed",
        category: "tool",
        visibility: "user",
        payload: { callId: "read", toolName: "read_file" },
      });
      await store.finishRun(run.id, "completed");
      expect((await store.getDetail(thread.id)).taskNarrative).toMatchObject({
        phase: "ended",
        execution: "ended",
        objective: { status: "unverified" },
        completedItems: [],
        processItems: ["Read 1 file"],
        remainingItems: [],
      });
      const goal = {
        ...createGoal("Deliver report"),
        status: "completed" as const,
        blocker: "none" as const,
        lastEvaluatedRunId: run.id,
        evidence: "The model says all checks passed.",
      };
      await store.setGoal(thread.id, goal);
      expect(
        (await store.getDetail(thread.id)).taskNarrative?.objective,
      ).toMatchObject({ status: "unverified", evidence: [] });
    } finally {
      store.close();
    }
  });

  it("a later cancelled or failed run cannot borrow an earlier success", async () => {
    const { store, thread, run } = await setup();
    try {
      await store.finishRun(run.id, "completed");
      for (const status of ["cancelled", "failed"] as const) {
        const next = await store.createRun({
          threadId: thread.id,
          agentId: run.agentId,
        });
        await store.finishRun(next.id, status);
        const facts = (await store.getDetail(thread.id)).taskNarrative!;
        expect(facts.phase).toBe(status === "failed" ? "failed" : "ended");
        expect(facts.metricRunId).toBe(next.id);
        expect(facts.objective?.status).not.toBe("accepted");
      }
    } finally {
      store.close();
    }
  });
});
