import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile, RunEvent, RunRecord, SubagentRole } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCapabilityRuntime } from "../src/agent-capability-runtime.js";
import type { BrowserSessionPort } from "../src/browser-session-port.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import { LocalStore } from "../src/store.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import { assertSubagentExecutionBinding, type SubagentExecutionContext } from "../src/subagent-execution-context.js";
import { sourceContinuityPredecessor } from "../src/source-continuity-lineage.js";
import { assertSourceContinuityContexts } from "../src/research-source-replay.js";

const fixtures: Array<{ root: string; store: LocalStore; capabilities: AgentCapabilityRuntime; owners: Array<{ threadId: string; runId: string }> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await Promise.all(f.owners.map((owner) => f.capabilities.cancelRun(owner)));
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

async function fixture(enabledTools = ["web_fetch", "research_source", "browser", "git_inspect", "lsp_symbols", "apply_patch", "run_command"]) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-tool-owner-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    enabledTools, enabledSubagents: ["researcher"], toolPolicy: "workspace",
    subagentLimits: { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 5_000 },
  });
  const thread = await store.createThread({ title: "Child tool owner", agentId: agent.id });
  const parent = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const profile = effectiveRunProfile(agent, parent);
  const sessions = new Set([parent.id]);
  const browserExecute = vi.fn(async (owner: { runId: string }) => {
    sessions.add(owner.runId);
    return { output: "isolated browser", details: {} };
  });
  const browserCancel = vi.fn(async (owner: { runId: string }) => { sessions.delete(owner.runId); });
  const browser = {
    available: () => true, hasActiveSession: (owner: { runId: string }) => sessions.has(owner.runId),
    execute: browserExecute, cancelRun: browserCancel,
  } as unknown as BrowserSessionPort;
  const http = { request: vi.fn(async (request: { url: string }) => ({
    status: 200, headers: { "content-type": "text/plain" },
    body: Buffer.from(`Immutable source for ${request.url}\nSecond line.\n`), finalUrl: request.url, redirectCount: 0,
  })) };
  const capabilities = new AgentCapabilityRuntime(store, { id: "never-launch", launch: vi.fn() },
    undefined, undefined, undefined, undefined, browser, undefined, { webFetchHttp: http });
  const owners = [{ threadId: parent.threadId, runId: parent.id }];
  fixtures.push({ root, store, capabilities, owners });
  const child = async (role: SubagentRole = "researcher"): Promise<SubagentExecutionContext> => {
    const executionId = `subexec_fixture${owners.length}`;
    const task = await store.createSubagentTask({
      threadId: thread.id, runId: parent.id, role, description: "Use scoped tools", prompt: "Read delegated evidence",
      model: parent.configuration!.model, providerId: "in_process", executionId,
    });
    const started = await store.startSubagentChildRun({ taskId: task.id, executionId,
      authorization: authorizeSubagentChildRun({ parentRun: parent, parentProfile: profile,
        taskId: task.id, executionId, limits: parent.configuration!.subagentLimits }),
      lease: { ownerId: "worker_child_tools", ttlMs: 60_000 },
    });
    owners.push({ threadId: thread.id, runId: started.run.id });
    return { executionRun: started.run, authorityOriginRun: parent, parentProfile: profile,
      childProfile: started.profile, role };
  };
  return { root, store, parent, profile, child, capabilities, http, browserExecute, browserCancel, sessions };
}

const tool = (tools: AgentTool[], name: string) => tools.find((entry) => entry.name === name)!;
async function recordTool(f: Awaited<ReturnType<typeof fixture>>, run: RunRecord, name: string, details: unknown) {
  await f.store.appendEvent({ threadId: run.threadId, runId: run.id, type: "tool.completed", category: "tool",
    visibility: "debug", payload: JSON.parse(JSON.stringify({ callId: `call_${name}`, toolName: name, status: "completed", details })) });
}

describe("actual child capability factories", () => {
  it("copies bounded parent sources while new fetches and browser sessions belong only to the child", async () => {
    const f = await fixture();
    const parentTools = f.capabilities.createTools({ profile: f.profile, threadId: f.parent.threadId, runId: f.parent.id });
    const source = await tool(parentTools, "web_fetch").execute("parent-fetch", { action: "fetch", url: "https://example.com/parent.txt" });
    await recordTool(f, f.parent, "web_fetch", source.details);
    const details = source.details as { sourceId: string; sourceContentSha256: string };
    const research = await tool(parentTools, "research_source").execute("parent-capture", {
      action: "capture_fetch", webSourceId: details.sourceId, webSourceContentSha256: details.sourceContentSha256,
    });
    await recordTool(f, f.parent, "research_source", research.details);
    const context = await f.child();
    const tools = await f.capabilities.createSubagentTools(context);
    expect(tools.map((entry) => entry.name)).toEqual(expect.arrayContaining(["web_fetch", "browser", "research_source", "git_inspect", "lsp_symbols"]));
    expect(tools.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(["apply_patch", "run_command"]));
    const read = await tool(tools, "web_fetch").execute("child-read", {
      action: "read", sourceId: details.sourceId, sourceContentSha256: details.sourceContentSha256, startLine: 1, endLine: 1,
    });
    expect(JSON.stringify(read)).toContain("parent.txt");
    expect(f.http.request).toHaveBeenCalledTimes(1);
    const listed = await tool(tools, "research_source").execute("child-list", { action: "list" });
    expect((listed.details as { sourceCount: number }).sourceCount).toBe(1);
    const fetched = await tool(tools, "web_fetch").execute("child-fetch", { action: "fetch", url: "https://example.com/child.txt" });
    expect((fetched.details as { stateCapsule: { sourceRunId: string } }).stateCapsule.sourceRunId).toBe(context.executionRun.id);
    const parentList = await tool(parentTools, "web_fetch").execute("parent-list", { action: "list" });
    expect((parentList.details as { sourceCount: number }).sourceCount).toBe(1);
    await tool(tools, "browser").execute("child-browser", { action: "start", url: "https://example.com" });
    expect(f.browserExecute).toHaveBeenLastCalledWith({ threadId: f.parent.threadId, runId: context.executionRun.id }, expect.anything(), undefined);
    await expect(tool(tools, "browser").execute("child-click", { action: "click", ref: "target" })).rejects.toThrow(/interactive Browser capability/u);
    await f.capabilities.cancelRun({ threadId: f.parent.threadId, runId: context.executionRun.id });
    expect(f.sessions.has(f.parent.id)).toBe(true);
    expect(f.sessions.has(context.executionRun.id)).toBe(false);
    expect((await tool(parentTools, "web_fetch").execute("parent-still-readable", { action: "list" })).details).toMatchObject({ sourceCount: 1 });
    const events = await f.store.listEvents(f.parent.threadId);
    const childEvents = events.filter((event) => event.runId === context.executionRun.id);
    expect(childEvents.some((event) => event.type === "context.web_fetch_sources")).toBe(true);
    expect(childEvents.some((event) => event.type === "context.research_sources")).toBe(true);
    assertSourceContinuityContexts(events, new Map(f.store.listRuns(f.parent.threadId).map((run) => [run.id, run as unknown as Record<string, unknown>])),
      f.store.getThread(f.parent.threadId) as unknown as Record<string, unknown>, f.store.listSubagentTasks(f.parent.threadId));
  });

  it("rejects mutable profile widening and uses only the frozen role subset", async () => {
    const f = await fixture(["read_file"]);
    const context = await f.child();
    expect((await f.capabilities.createSubagentTools(context)).map((entry) => entry.name)).toEqual(["read_file"]);
    const widened: AgentProfile = { ...context.childProfile, enabledTools: ["read_file", "web_fetch"] };
    await expect(f.capabilities.createSubagentTools({ ...context, childProfile: widened })).rejects.toThrow(/tool authority binding/u);
  });

  it("requires an exact live task association and explicit immediate parent for source delegation", async () => {
    const f = await fixture(["web_fetch"]);
    const context = await f.child();
    const sibling = await f.child();
    const owner = { threadId: f.parent.threadId, runId: context.executionRun.id };
    expect(sourceContinuityPredecessor(f.store, owner)).toBeUndefined();
    expect(sourceContinuityPredecessor(f.store, owner, { explicitRunId: f.parent.id })?.id).toBe(f.parent.id);
    expect(() => sourceContinuityPredecessor(f.store, owner, { explicitRunId: sibling.executionRun.id })).toThrow(/binding/u);
    expect(() => sourceContinuityPredecessor({ listRuns: f.store.listRuns.bind(f.store), getThread: f.store.getThread.bind(f.store) }, owner,
      { explicitRunId: f.parent.id })).toThrow(/binding/u);
    expect(() => assertSubagentExecutionBinding(f.store, { ...context.executionRun, parentRunId: sibling.executionRun.id })).toThrow(/binding/u);
    const getThread = f.store.getThread.bind(f.store);
    vi.spyOn(f.store, "getThread").mockImplementation((id) => ({ ...getThread(id), importProvenance: {} as never }));
    expect(() => sourceContinuityPredecessor(f.store, owner, { explicitRunId: f.parent.id })).toThrow(/Imported child/u);
  });

  it("rejects replayed child source contexts with forged task association or absent parent evidence", async () => {
    const f = await fixture(["web_fetch"]);
    const parentTools = f.capabilities.createTools({ profile: f.profile, threadId: f.parent.threadId, runId: f.parent.id });
    const source = await tool(parentTools, "web_fetch").execute("parent", { action: "fetch", url: "https://example.com/evidence" });
    await recordTool(f, f.parent, "web_fetch", source.details);
    const context = await f.child();
    await f.capabilities.createSubagentTools(context);
    const events = await f.store.listEvents(f.parent.threadId);
    const runs = new Map(f.store.listRuns(f.parent.threadId).map((run) => [run.id, run as unknown as Record<string, unknown>]));
    const thread = f.store.getThread(f.parent.threadId) as unknown as Record<string, unknown>;
    const tasks = f.store.listSubagentTasks(f.parent.threadId);
    expect(() => assertSourceContinuityContexts(events, runs, thread, [])).toThrow(/binding/u);
    const noParentReceipt: RunEvent[] = events.filter((event) => !(event.runId === f.parent.id && event.type === "tool.completed"));
    expect(() => assertSourceContinuityContexts(noParentReceipt, runs, thread, tasks)).toThrow(/continuity Run/u);
  });
});
