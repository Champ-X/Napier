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
    profile,
    faux,
    registry,
    model,
    coordinator,
    parentAbort,
  };
}

const delegatedTask = {
  role: "researcher" as const,
  description: "Inspect isolation",
  task: "Inspect the workspace boundary and return concise evidence.",
};

function typedResult(summary: string): string {
  return JSON.stringify({
    summary,
    items: [],
    unknowns: [],
  });
}

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
    faux.setResponses([
      fauxAssistantMessage(typedResult("Isolation evidence collected.")),
    ]);
    const tool = coordinator.createTool();

    const result = await tool.execute("delegate-1", delegatedTask);
    expect(result.details).toEqual(
      expect.objectContaining({
        role: "researcher",
        status: "completed",
        turnCount: 1,
        itemCount: 0,
        evidenceCount: 0,
        outcomeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      tool.execute("delegate-2", {
        ...delegatedTask,
        description: "Exceed budget",
        task: "Inspect a different boundary after the budget is exhausted.",
      }),
    ).rejects.toThrow("Subagent total budget exhausted (1)");
    expect(store.listSubagentTasks(thread.id)).toHaveLength(1);
    expect(store.listSubagentTasks(thread.id)[0]?.outcome).toEqual(
      expect.objectContaining({
        summary: "Isolation evidence collected.",
        itemCount: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(faux.state.callCount).toBe(1);
  });

  it("rejects equivalent durable work while permitting a failed intent retry", async () => {
    const { coordinator, faux, store, thread } = await createHarness({
      maxTotal: 3,
      maxTurns: 1,
    });
    faux.setResponses([
      fauxAssistantMessage(typedResult("Reusable evidence collected.")),
      fauxAssistantMessage("Malformed failed attempt."),
      fauxAssistantMessage(typedResult("Retry completed.")),
    ]);
    const tool = coordinator.createTool();

    await tool.execute("delegate-reusable", delegatedTask);
    await expect(
      tool.execute("delegate-duplicate", {
        ...delegatedTask,
        description: "Try the same work again",
        task: "  Inspect the workspace boundary\nand return concise evidence. ",
      }),
    ).rejects.toThrow(/durable completed task task[_-]/);

    const retryTask = {
      ...delegatedTask,
      description: "Retryable inspection",
      task: "Inspect a retryable boundary.",
    };
    await expect(tool.execute("delegate-failed", retryTask)).rejects.toThrow(
      "must be one valid JSON object",
    );
    const retried = await tool.execute("delegate-retry", retryTask);

    expect(retried.details.status).toBe("completed");
    expect(store.listSubagentTasks(thread.id)).toHaveLength(3);
    expect(faux.state.callCount).toBe(3);
  });

  it("restores the per-run total budget from durable tasks", async () => {
    const {
      store,
      run,
      profile,
      model,
      registry,
      coordinator,
      parentAbort,
      faux,
    } = await createHarness({ maxTotal: 1 });
    faux.setResponses([
      fauxAssistantMessage(typedResult("Initial delegation completed.")),
    ]);
    await coordinator.createTool().execute("delegate-initial", delegatedTask);

    const restored = new SubagentCoordinator({
      store,
      models: registry.models,
      model,
      run,
      profile,
      parentSignal: parentAbort.signal,
    });

    await expect(
      restored.createTool().execute("delegate-after-restore", {
        ...delegatedTask,
        description: "Different restored task",
        task: "Inspect a different area after coordinator restoration.",
      }),
    ).rejects.toThrow("Subagent total budget exhausted (1)");
    expect(faux.state.callCount).toBe(1);
  });

  it("repairs one malformed outcome with a bounded tool-free turn", async () => {
    const { coordinator, faux, store, thread } = await createHarness();
    faux.setResponses([
      fauxAssistantMessage("Unstructured result."),
      (context) => {
        expect(context.tools).toEqual([]);
        expect(context.systemPrompt).toContain(
          "tool-free Subagent outcome repair pass",
        );
        expect(JSON.stringify(context.messages)).toContain(
          "Unstructured result.",
        );
        return fauxAssistantMessage(typedResult("Repaired typed outcome."));
      },
    ]);

    const result = await coordinator
      .createTool()
      .execute("delegate-repaired", delegatedTask);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "completed",
        turnCount: 2,
        stepCount: 2,
        outcomeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(faux.state.callCount).toBe(2);
    const [task] = store.listSubagentTasks(thread.id);
    expect(task).toEqual(
      expect.objectContaining({
        status: "completed",
        result: "Repaired typed outcome.",
        outcome: expect.objectContaining({
          summary: "Repaired typed outcome.",
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual([
      "subagent.queued",
      "subagent.started",
      "subagent.step",
      "subagent.outcome.repair.requested",
      "subagent.step",
      "subagent.outcome.repair.outcome",
      "subagent.outcome.accepted",
      "subagent.completed",
    ]);
    expect(
      events.find((event) => event.type === "subagent.outcome.repair.requested")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-repair-request",
        attempt: 1,
        maxAttempts: 1,
        predecessorResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        repairPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      events.find((event) => event.type === "subagent.outcome.repair.outcome")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-repair-outcome",
        status: "accepted",
        resultSha256: task?.outcome?.resultSha256,
        outcomeSha256: task?.outcome?.contentSha256,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(events.filter((event) => event.type === "subagent.step")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "assistant",
          contentRedacted: true,
          textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "outcome_repair",
          contentRedacted: true,
          toolCallCount: 0,
          textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("Unstructured result.");
  });

  it("fails closed when a repaired outcome still violates its contract", async () => {
    const { coordinator, faux, store, thread } = await createHarness();
    faux.setResponses([
      fauxAssistantMessage("Unstructured result."),
      fauxAssistantMessage("Still unstructured."),
    ]);

    await expect(
      coordinator.createTool().execute("delegate-invalid", delegatedTask),
    ).rejects.toThrow("must be one valid JSON object");

    const [task] = store.listSubagentTasks(thread.id);
    expect(task).toEqual(
      expect.objectContaining({
        status: "failed",
        stopReason: "error",
        error: "Subagent result must be one valid JSON object",
        turnCount: 2,
      }),
    );
    expect(task).not.toHaveProperty("result");
    expect(task).not.toHaveProperty("outcome");
    const rejected = (await store.listEvents(thread.id)).find(
      (event) => event.type === "subagent.outcome.rejected",
    );
    expect(rejected?.payload).toEqual(
      expect.objectContaining({
        status: "rejected",
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(rejected?.payload)).not.toContain(
      "Still unstructured.",
    );
    const events = await store.listEvents(thread.id);
    expect(
      events.find((event) => event.type === "subagent.outcome.repair.outcome")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        status: "rejected",
        resultSha256: rejected?.payload["resultSha256"],
        diagnosticSha256: rejected?.payload["diagnosticSha256"],
      }),
    );
    expect(JSON.stringify(events)).not.toContain("Unstructured result.");
    expect(JSON.stringify(events)).not.toContain("Still unstructured.");
    expect(faux.state.callCount).toBe(2);
  });

  it("does not repair malformed output after consuming the turn budget", async () => {
    const { coordinator, faux, store, thread } = await createHarness({
      maxTurns: 1,
    });
    faux.setResponses([fauxAssistantMessage("Unstructured result.")]);

    await expect(
      coordinator
        .createTool()
        .execute("delegate-no-repair-budget", delegatedTask),
    ).rejects.toThrow("must be one valid JSON object");

    expect(faux.state.callCount).toBe(1);
    expect(store.listSubagentTasks(thread.id)).toEqual([
      expect.objectContaining({
        status: "failed",
        turnCount: 1,
      }),
    ]);
    const events = await store.listEvents(thread.id);
    expect(
      events.some(
        (event) => event.type === "subagent.outcome.repair.requested",
      ),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Unstructured result.");
  });

  it("does not repair structurally valid output with ungrounded evidence", async () => {
    const { coordinator, faux, store, thread } = await createHarness();
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "A missing file was cited.",
          items: [
            {
              kind: "finding",
              severity: "warning",
              title: "Missing source",
              detail: "The source file is unavailable.",
              evidence: [{ path: "src/missing.ts", lineStart: 1, lineEnd: 1 }],
            },
          ],
          unknowns: [],
        }),
      ),
    ]);

    await expect(
      coordinator
        .createTool()
        .execute("delegate-grounding-failure", delegatedTask),
    ).rejects.toThrow();

    expect(faux.state.callCount).toBe(1);
    const events = await store.listEvents(thread.id);
    expect(
      events.some(
        (event) => event.type === "subagent.outcome.repair.requested",
      ),
    ).toBe(false);
    expect(
      events.find((event) => event.type === "subagent.outcome.rejected")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("A missing file was cited.");
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
