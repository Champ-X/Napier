import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { AgentProfile, SubagentLimits } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { SubagentCoordinator } from "../src/subagents.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createHarness(limits: Partial<SubagentLimits> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const seededAgent = store.listAgents()[0]!;
  const profile: AgentProfile = {
    ...seededAgent,
    enabledSubagents: ["researcher"],
    subagentLimits: {
      maxConcurrent: 1,
      maxTotal: 2,
      maxTurns: 4,
      timeoutMs: 5_000,
      ...limits,
    },
  };
  const thread = await store.createThread({
    title: "Subagent harness",
    agentId: profile.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: profile.id,
  });
  const faux = fauxProvider({ provider: `faux-${run.id}` });
  const registry = new ModelRegistry();
  registry.registerProvider(faux.provider);
  const model = registry.resolve({
    provider: faux.provider.id,
    id: "faux-1",
  });
  if (!model) throw new Error("Faux model was not registered");
  const parentAbort = new AbortController();
  const coordinator = new SubagentCoordinator({
    store,
    models: registry.models,
    model,
    run,
    profile,
    parentSignal: parentAbort.signal,
  });
  return {
    store,
    thread,
    run,
    faux,
    coordinator,
    parentAbort,
  };
}

const delegatedTask = {
  role: "researcher" as const,
  description: "Inspect isolation",
  task: "Inspect the workspace boundary and return concise evidence.",
};

describe("SubagentCoordinator", () => {
  it("uses the validated profile limits without a second silent clamp", async () => {
    const { coordinator } = await createHarness({
      maxConcurrent: 6,
      maxTotal: 12,
      maxTurns: 24,
      timeoutMs: 700_000,
    });

    expect(coordinator.createTool().description).toContain(
      "at most 12 total and 6 concurrent",
    );
  });

  it("enforces the per-run total delegation budget before creating work", async () => {
    const { coordinator, faux, store, thread } = await createHarness({
      maxTotal: 1,
    });
    faux.setResponses([fauxAssistantMessage("Isolation evidence collected.")]);
    const tool = coordinator.createTool();

    const result = await tool.execute("delegate-1", delegatedTask);
    expect(result.details).toEqual(
      expect.objectContaining({
        role: "researcher",
        status: "completed",
        turnCount: 1,
      }),
    );
    await expect(
      tool.execute("delegate-2", {
        ...delegatedTask,
        description: "Exceed budget",
      }),
    ).rejects.toThrow("Subagent total budget exhausted (1)");
    expect(store.listSubagentTasks(thread.id)).toHaveLength(1);
    expect(faux.state.callCount).toBe(1);
  });

  it("closes a queued task as cancelled when its tool signal is already aborted", async () => {
    const { coordinator, faux, store, thread } = await createHarness();
    const toolAbort = new AbortController();
    toolAbort.abort();

    await expect(
      coordinator
        .createTool()
        .execute("delegate-cancelled", delegatedTask, toolAbort.signal),
    ).rejects.toThrow("cancelled before start");

    expect(faux.state.callCount).toBe(0);
    const [task] = store.listSubagentTasks(thread.id);
    expect(task).toEqual(
      expect.objectContaining({
        status: "cancelled",
        stopReason: "cancelled",
      }),
    );
    expect(task).not.toHaveProperty("startedAt");
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(["subagent.queued", "subagent.cancelled"]);
  });

  it("fails closed when a subagent exhausts its turn budget", async () => {
    const { coordinator, faux, store, thread } = await createHarness({
      maxTurns: 1,
    });
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "search_files",
        ]);
        return fauxAssistantMessage(
          fauxToolCall("list_files", { path: ".", depth: 0 }),
          { stopReason: "toolUse" },
        );
      },
    ]);

    await expect(
      coordinator.createTool().execute("delegate-turn-cap", delegatedTask),
    ).rejects.toThrow("turn budget exhausted (1)");

    expect(faux.state.callCount).toBe(1);
    expect(store.listSubagentTasks(thread.id)).toEqual([
      expect.objectContaining({
        status: "failed",
        stopReason: "turn_capped",
        turnCount: 1,
      }),
    ]);
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "subagent.queued",
        "subagent.started",
        "subagent.step",
        "subagent.failed",
      ]),
    );
  });
});
