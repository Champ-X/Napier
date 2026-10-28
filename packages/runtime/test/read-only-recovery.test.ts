import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { createGoal } from "../src/goals.js";

const stores: LocalStore[] = [],
  roots: string[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-read-only-recovery-"));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  stores.push(store);
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    enabledTools: ["apply_patch", "read_file"],
    enabledSubagents: [],
    toolPolicy: "workspace",
  });
  const thread = await store.createThread({
    agentId: agent.id,
    title: "Read-only recovery",
  });
  const parent = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await store.finishRun(parent.id, "failed", {
    outcome: "partial",
    error: "Fixture stopped",
  });
  const provider = fauxProvider({ provider: "faux-read-only-recovery" });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const runtime = new AgentRuntime(store, models);
  const request = {
    threadId: thread.id,
    runId: parent.id,
    readOnly: true,
    model: { provider: "faux-read-only-recovery", id: "faux-1" },
  };
  return { root, store, agent, parent, thread, provider, runtime, request };
}
it("enforces read-only tools even when the provider tries to write", async () => {
  const f = await fixture();
  const goal = createGoal("Finish the original task, including pending writes");
  await f.store.setGoal(f.thread.id, goal);
  f.provider.setResponses([
    (context) => {
      expect(context.tools?.map((tool) => tool.name)).not.toContain(
        "apply_patch",
      );
      return fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "create",
          path: "forbidden.txt",
          expectedSha256: null,
          content: "must not write",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("The task still needs reconciliation."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const run = await f.runtime.resumeInterruptedRun(f.request);
  expect(run).toMatchObject({ status: "failed", outcome: "partial" });
  expect(run.configuration).toMatchObject({
    executionMode: "safe_read_only_recovery",
    toolPolicy: "observe",
  });
  const events = await f.store.listRunEvents(run.id);
  expect(f.store.getThread(f.thread.id).goal).toEqual(goal);
  expect(events.some((event) => event.category === "goal")).toBe(false);
  expect(
    events.some((event) => event.type === "workspace.patch.commit_started"),
  ).toBe(false);
  await expect(
    stat(path.join(f.root, "workspace", "forbidden.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(f.runtime.resumeInterruptedRun(f.request)).rejects.toThrow(
    /superseded|not found/,
  );
  expect(f.store.listRuns(f.thread.id)).toHaveLength(2);
  expect(
    (await f.store.getDetail(f.thread.id)).recoveryCheckpoint?.sourceRunId,
  ).toBe(f.parent.id);
});
it("rejects superseded parents in both the public entry and atomic Run creation", async () => {
  const f = await fixture();
  const later = await f.store.createRun({
    threadId: f.thread.id,
    agentId: f.agent.id,
  });
  await f.store.finishRun(later.id, "failed", { outcome: "partial" });
  await expect(f.runtime.resumeInterruptedRun(f.request)).rejects.toThrow(
    /superseded/,
  );
  await expect(
    f.store.createRun({
      threadId: f.thread.id,
      agentId: f.agent.id,
      source: "recovery",
      parentRunId: f.parent.id,
    }),
  ).rejects.toThrow(/superseded/);
  expect(f.provider.state.callCount).toBe(0);
  expect(f.store.listRuns(f.thread.id)).toHaveLength(2);
});
it("does not block the original goal when inspection itself fails", async () => {
  const f = await fixture();
  const goal = createGoal("Finish the original task");
  await f.store.setGoal(f.thread.id, goal);
  f.provider.setResponses([() => { throw new Error("Inspection model unavailable"); }]);
  const run = await f.runtime.resumeInterruptedRun(f.request);
  expect(run.status).toBe("failed");
  expect(f.store.getThread(f.thread.id).goal).toEqual(goal);
});
it("admits only one competing continuation from the same checkpoint", async () => {
  const f = await fixture();
  f.provider.setResponses([
    fauxAssistantMessage("Inspection done; writes remain pending."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const results = await Promise.allSettled([
    f.runtime.resumeInterruptedRun(f.request),
    f.runtime.resumeInterruptedRun(f.request),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(f.store.listRuns(f.thread.id)).toHaveLength(2);
});
