import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { governSubagentTools } from "../src/subagent-tool-execution.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { executeAdmittedToolCall } from "../src/tool-execution-admission-service.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import { defineReplayableTestReadTool } from "./self-describing-tool-test-support.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("subagent tool execution ownership", () => {
  it.each(["", "   ", "x".repeat(257)])("preserves the provider call ID boundary before creating an owned ID: %j", async (callId) => {
    const fixture = await createFixture();
    await expect(fixture.child("task_a", "execution_a").execute(callId, {})).rejects.toThrow("parentCallId");
    expect(fixture.executed).toEqual([]);
    expect((await fixture.store.listRunEvents(fixture.run.id)).filter((event) => event.type === "tool.admitted")).toEqual([]);
  });

  it("retries a failed legacy-evidence lookup without authorizing a partial call", async () => {
    const fixture = await createFixture();
    const query = vi.spyOn(fixture.store, "listRunEvents").mockRejectedValueOnce(new Error("read worker unavailable"));
    const child = fixture.child("task_a", "execution_a");
    await expect(child.execute("call_1", {})).rejects.toThrow("read worker unavailable");
    expect(fixture.executed).toEqual([]);
    await expect(child.execute("call_1", {})).resolves.toMatchObject({ details: { value: "ok" } });
    expect(fixture.executed).toHaveLength(1);
    query.mockRestore();
  });

  it("independently settles siblings with the same provider call ID through the shared gate and real ledger", async () => {
    const fixture = await createFixture();
    const a = fixture.child("task_a", "execution_a");
    const b = fixture.child("task_b", "execution_b");
    const results = await Promise.all([a.execute("call_1", {}), b.execute("call_1", {})]);
    expect(results.map((result) => result.details)).toEqual([{ value: "ok" }, { value: "ok" }]);
    expect(new Set(fixture.executed).size).toBe(2);
    const events = await fixture.store.listRunEvents(fixture.run.id);
    const admitted = events.filter((event) => event.type === "tool.admitted");
    const completed = events.filter((event) => event.type === "tool.completed");
    expect(admitted).toHaveLength(2);
    expect(completed).toHaveLength(2);
    for (const event of [...admitted, ...completed]) {
      expect(event.payload).toMatchObject({ providerCallId: "call_1" });
      expect(fixture.executed).toContain(payload(event)["callId"]);
    }
    expect(new Set(completed.map((event) => payload(event)["subagentTaskId"]))).toEqual(new Set(["task_a", "task_b"]));
    expect(new Set(events.filter((event) => event.type === "tool.operation.proposed").map((event) => payload(event)["parentCallId"]))).toEqual(new Set(fixture.executed));
  });

  it("keeps the existing main Run claim distinct from a child's identical provider ID", async () => {
    const fixture = await createFixture();
    await fixture.parent("call_1");
    await fixture.child("task_a", "execution_a").execute("call_1", {});
    expect(fixture.executed[0]).toBe("call_1");
    expect(fixture.executed[1]).not.toBe("call_1");
    expect(fixture.executed).toHaveLength(2);
    const admitted = (await fixture.store.listRunEvents(fixture.run.id)).filter((event) => event.type === "tool.admitted");
    expect(payload(admitted[0]!)["callId"]).toBe("call_1");
    expect(payload(admitted[0]!)["providerCallId"]).toBeUndefined();
  });

  it("fences repeats and changed arguments after reopening the same execution", async () => {
    const fixture = await createFixture();
    await fixture.child("task_a", "execution_a").execute("call_1", {});
    fixture.store.close();
    stores.splice(stores.indexOf(fixture.store), 1);
    const reopened = new LocalStore({ workspaceRoot: fixture.root, dataRoot: path.join(fixture.root, "data") });
    stores.push(reopened); await reopened.initialize(false);
    const retry = governSubagentTools({ tools: [fixture.raw], store: reopened, run: fixture.run,
      taskId: "task_a", executionId: "execution_a", concurrencyGate: fixture.gate, onEvent: undefined })[0]!;
    await expect(retry.execute("call_1", {})).rejects.toMatchObject({ name: "ToolExecutionClaimError", disposition: "terminal_replay" });
    await expect(retry.execute("call_1", { value: "changed" })).rejects.toMatchObject({ name: "ToolExecutionClaimError", disposition: "rejected" });
    expect(fixture.executed).toHaveLength(1);
    expect((await reopened.listRunEvents(fixture.run.id)).filter((event) => event.type === "tool.completed")).toHaveLength(1);
  });

  it("binds the execution identity as well as the task and preserves a stable legacy task fallback", async () => {
    const fixture = await createFixture();
    await fixture.child("task_a", "execution_a").execute("call_1", {});
    await fixture.child("task_a", "execution_b").execute("call_1", {});
    await fixture.child("legacy_task").execute("call_1", {});
    await expect(fixture.child("legacy_task").execute("call_1", {})).rejects.toMatchObject({ name: "ToolExecutionClaimError", disposition: "terminal_replay" });
    expect(new Set(fixture.executed).size).toBe(3);
  });

  it("preserves legacy unscoped admissions for the same child instead of re-executing them after upgrade", async () => {
    const fixture = await createFixture();
    await fixture.parent("call_1", { subagentTaskId: "legacy_task" });
    await expect(fixture.child("legacy_task").execute("call_1", {})).rejects.toMatchObject({ name: "ToolExecutionClaimError" });
    expect(fixture.executed).toEqual(["call_1"]);
    await fixture.child("new_task", "new_execution").execute("call_1", {});
    expect(fixture.executed).toHaveLength(2);
  });

  it("keeps a failed sibling terminal separate from a successful sibling", async () => {
    const fixture = await createFixture();
    await expect(fixture.child("task_a", "execution_a").execute("call_1", { fail: true })).rejects.toThrow("controlled failure");
    await fixture.child("task_b", "execution_b").execute("call_1", {});
    const terminals = (await fixture.store.listRunEvents(fixture.run.id)).filter((event) => event.type === "tool.failed" || event.type === "tool.completed");
    expect(terminals.map((event) => [event.type, payload(event)["subagentTaskId"]])).toEqual([["tool.failed", "task_a"], ["tool.completed", "task_b"]]);
    expect(new Set(terminals.map((event) => payload(event)["callId"])).size).toBe(2);
  });
});

function payload(event: { payload: unknown }): Record<string, unknown> {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("Expected an object event payload");
  return event.payload as Record<string, unknown>;
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-tool-owner-")); roots.push(root);
  const store = new LocalStore({ workspaceRoot: root, dataRoot: path.join(root, "data") });
  stores.push(store); await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({ title: "Child tool ownership", agentId });
  const { run } = await store.createLeasedRun({ threadId: thread.id, agentId }, { ownerId: `process:${process.pid}:child-tool-test`, ttlMs: 60_000 });
  const gate = new ToolConcurrencyGate();
  const executed: string[] = [];
  const raw: AgentTool = defineReplayableTestReadTool({
    name: "inspect_child_fixture", label: "Inspect", description: "Controlled read-only child fixture",
    parameters: Type.Object({ value: Type.Optional(Type.String()), fail: Type.Optional(Type.Boolean()) }),
    execute: async (callId, args) => {
      executed.push(callId);
      if (args && typeof args === "object" && "fail" in args && args.fail) throw new Error("controlled failure");
      return { content: [{ type: "text" as const, text: "ok" }], details: { value: "ok" } };
    },
  });
  const child = (taskId: string, executionId?: string) => governSubagentTools({ tools: [raw], store, run, taskId,
    ...(executionId ? { executionId } : {}), concurrencyGate: gate, onEvent: undefined })[0]!;
  const parent = (callId: string, admissionPayload?: { subagentTaskId: string }) => executeAdmittedToolCall({
    store, run, callId, toolName: raw.name, args: {}, protocol: createOwnedToolRecordV2(raw), concurrencyGate: gate,
    startedPayload: {}, ...(admissionPayload ? { admissionPayload } : {}),
    execute: () => raw.execute(callId, {}), settlement: (result) => ({ result, isError: false }),
  });
  return { root, store, run, gate, executed, raw, child, parent };
}
