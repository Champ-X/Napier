import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentRuntime, type LocalAgentRuntimeServices } from "../src/local-agent-runtime.js";
import { AgentCapabilityRuntime } from "../src/agent-capability-runtime.js";
import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import type { SubagentExecutionContext } from "../src/subagent-execution-context.js";

const fixtures: Array<{ root: string; services: LocalAgentRuntimeServices }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { root, services } of fixtures.splice(0)) {
    await services.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-execution-integration-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const http = { request: vi.fn(async () => ({
    status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("Child-only immutable source\n"),
    finalUrl: "https://example.com/child.txt", redirectCount: 0,
  })) };
  const services = await createLocalAgentRuntime({ workspaceRoot, dataRoot: path.join(root, "data"), env: {}, webFetchHttp: http });
  fixtures.push({ root, services });
  const agent = await services.store.updateAgent(services.store.listAgents()[0]!.id, {
    enabledTools: ["web_fetch"], enabledSubagents: ["researcher"], toolPolicy: "workspace",
    subagentLimits: { maxConcurrent: 1, maxTotal: 2, maxTurns: 4, timeoutMs: 10_000 },
  });
  const thread = await services.store.createThread({ title: "Actual child execution owner", agentId: agent.id });
  const faux = fauxProvider({ provider: "child-execution-integration" });
  services.models.registerProvider(faux.provider);
  return { ...services, agent, thread, faux, http };
}

describe("actual child Run execution integration", () => {
  it("binds AgentRuntime inherited callbacks, physical operation journals and canonical usage to its child Run", async () => {
    const f = await fixture();
    const cleanup = vi.spyOn(AgentCapabilityRuntime.prototype, "cancelRun");
    f.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("delegate_task", {
        role: "researcher", description: "Read a public fixture", task: "Fetch the provided URL and return done.", outputSchema: { type: "string" },
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("web_fetch", { action: "fetch", url: "https://example.com/child.txt" }), { stopReason: "toolUse" }),
      fauxAssistantMessage('"done"'), fauxAssistantMessage("Delegated fetch completed."), fauxAssistantMessage('{"facts":[]}'),
    ]);
    const parent = await f.runtime.runPrompt({ threadId: f.thread.id, text: "Delegate the public fixture fetch.",
      model: { provider: f.faux.provider.id, id: "faux-1" } });
    expect(parent.status, parent.error).toBe("completed");
    expect(f.http.request).toHaveBeenCalledTimes(1);
    const task = f.store.listSubagentTasks(f.thread.id, parent.id)[0]!;
    const child = f.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId);
    expect(child, "A task must own an actual durable child Run").toMatchObject({ source: "subagent", parentRunId: parent.id, status: "completed" });
    expect(child!.id).not.toBe(parent.id);
    const events = await f.store.listEvents(f.thread.id);
    const fetches = events.filter((event) => event.type === "tool.completed" && (event.payload as Record<string, unknown>)["toolName"] === "web_fetch");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.runId).toBe(child!.id);
    const fetchCallId = (fetches[0]!.payload as Record<string, unknown>)["callId"];
    const operations = events.filter((event) => event.type.startsWith("tool.operation.") &&
      (event.payload as Record<string, unknown>)["parentCallId"] === fetchCallId);
    expect(operations.length).toBeGreaterThan(0);
    expect(new Set(operations.map((event) => event.runId))).toEqual(new Set([child!.id]));
    const childResponses = events.filter((event) => event.runId === child!.id && event.type === "model.response");
    expect(childResponses).toHaveLength(2);
    expect(child!.usage).toEqual(task.usage);
    expect(await f.store.aggregateRunUsage(child!.id)).toEqual(task.usage);
    expect(cleanup).toHaveBeenCalledWith({ threadId: f.thread.id, runId: child!.id });
    expect(cleanup).toHaveBeenCalledWith({ threadId: f.thread.id, runId: parent.id });
  }, 30_000);

  it("settles and cleans the leased child when its actual tool factory throws before model dispatch", async () => {
    const f = await fixture();
    const parent = await f.store.createRun({ threadId: f.thread.id, agentId: f.agent.id });
    const createInheritedTools = vi.fn((_context: SubagentExecutionContext) => { throw new Error("Child setup failed"); });
    const cleanupExecutionResources = vi.fn(async () => undefined);
    const model = f.models.resolve({ provider: f.faux.provider.id, id: "faux-1" })!;
    const provider = new InProcessSubagentProvider({
      store: f.store, models: f.models.models, defaultModel: model, run: parent,
      profile: effectiveRunProfile(f.agent, parent), limits: parent.configuration!.subagentLimits,
      parentSignal: new AbortController().signal, createInheritedTools, cleanupExecutionResources,
      concurrencyGate: new ToolConcurrencyGate({ durable: { backend: f.store.toolConcurrencyLeaseBackend(), ownerId: "child_setup_fixture" } }),
    });
    const handle = await provider.start({ kind: "napier.subagent-request", schemaVersion: 1,
      threadId: f.thread.id, runId: parent.id, role: "researcher", description: "Fail tool setup", prompt: "No model dispatch" }, {});
    const collected = await provider.collect(handle);
    expect(collected.status).toBe("failed");
    expect(collected.task.error).toContain("Child setup failed");
    expect(f.faux.state.callCount).toBe(0);
    expect(createInheritedTools.mock.calls[0]![0]).toMatchObject({
      executionRun: { id: collected.task.childRunId, source: "subagent" }, authorityOriginRun: { id: parent.id },
    });
    const child = f.store.listRuns(f.thread.id).find((run) => run.id === collected.task.childRunId);
    expect(child).toMatchObject({ status: "failed" });
    expect(child?.lease).toBeUndefined();
    expect(cleanupExecutionResources).toHaveBeenCalledOnce();
    expect(cleanupExecutionResources).toHaveBeenCalledWith(expect.objectContaining({ id: child!.id }));
  });
});
