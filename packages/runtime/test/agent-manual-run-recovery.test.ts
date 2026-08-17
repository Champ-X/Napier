import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentRuntime manual Run recovery", () => {
  it("resumes an idle paused-budget Run as a linked recovery child", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-manual-recovery-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Paused budget recovery",
      agentId: agent.id,
    });
    const pausedBudget = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-prior", id: "faux-1" },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: pausedBudget.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "Continue the implementation from the verified checkpoint.",
      },
    });
    await store.finishRun(pausedBudget.id, "failed", {
      outcome: "paused_budget",
      error: "Model semantic progress stalled.",
    });
    expect(store.getThread(thread.id).status).toBe("idle");

    const faux = fauxProvider({ provider: "faux-recovery" });
    faux.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("<run-recovery>");
        return fauxAssistantMessage(
          "I verified the settlement checkpoint before continuing.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);

    const resumed = await new AgentRuntime(store, registry).resumeInterruptedRun({
      threadId: thread.id,
      runId: pausedBudget.id,
      model: { provider: "faux-recovery", id: "faux-1" },
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: pausedBudget.id,
        source: "recovery",
      }),
    );
    const detail = await store.getDetail(thread.id);
    expect(
      detail.runs.find((run) => run.id === pausedBudget.id),
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
      }),
    );
    expect(
      detail.events
        .filter((event) => event.runId === resumed.id)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "run.started",
        "run.recovery.started",
        "run.recovery.prompt",
        "run.completed",
        "run.recovery.completed",
      ]),
    );
  });
});
