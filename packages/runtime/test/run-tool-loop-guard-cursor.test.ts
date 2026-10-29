import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvent, ToolLoopGuardPolicy } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunToolLoopGuardCursor } from "../src/run-tool-loop-guard-cursor.js";
import { LocalStore } from "../src/store.js";
import {
  createToolCallSha256, detectToolCallLoop, latestActiveToolLoopGuard,
  projectToolLoopGuardTriggers,
} from "../src/tool-loop-guard.js";

const RUN = { id: "run_cursor", threadId: "thread_cursor" };
const POLICY: ToolLoopGuardPolicy = { enabled: true, threshold: 3, exemptTools: [] };
const TYPES = ["model.response", "tool.completed", "tool.failed", "tool.blocked", "model.tool_loop.detected"];
const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) await store.shutdown();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Run tool-loop guard cursor", () => {
  it.each(prefixCases())("equals unchanged full replay at every prefix: $name", async ({ events }) => {
    let prefix: RunEvent[] = [];
    const query = vi.fn(async (runId: string, afterSeq = 0, types?: readonly string[]) =>
      structuredClone(prefix.filter((item) => item.runId === runId && item.seq > afterSeq && (!types || types.includes(item.type)))),
    );
    const cursor = new RunToolLoopGuardCursor({ listRunEvents: query }, RUN);
    let watermark = 0;
    for (let end = 0; end <= events.length; end += 1) {
      prefix = events.slice(0, end);
      expect(await cursor.refresh(POLICY), `prefix ${end}`).toEqual(oracle(prefix, RUN.id, POLICY));
      const [, afterSeq, types] = query.mock.calls.at(-1)!;
      expect(afterSeq).toBe(watermark);
      expect(new Set(types)).toEqual(new Set(TYPES));
      const typed = prefix.filter((item) => item.runId === RUN.id && TYPES.includes(item.type));
      watermark = typed.at(-1)?.seq ?? 0;
    }
  });

  it("reprojects policy changes and isolates cached rows and returned receipts", async () => {
    const events = triggered();
    let returned: RunEvent[] = [];
    const reader = { listRunEvents: vi.fn(async (_runId: string, afterSeq = 0) => {
      returned = structuredClone(events.filter((item) => item.seq > afterSeq));
      return returned;
    }) };
    const cursor = new RunToolLoopGuardCursor(reader, RUN);
    const first = await cursor.refresh(POLICY);
    expect(first.active).toBeDefined();
    first.active!.receipt.toolName = "mutated";
    first.triggers.length = 0;
    first.detection!.toolName = "mutated";
    returned[0]!.payload = {};
    for (const policy of [
      POLICY, undefined, { ...POLICY, threshold: 2 }, { ...POLICY, threshold: 4 },
      { ...POLICY, enabled: false }, { ...POLICY, exemptTools: ["read_file"] }, POLICY,
    ]) expect(await cursor.refresh(policy)).toEqual(oracle(events, RUN.id, policy));
    expect(reader.listRunEvents.mock.calls.slice(1).map(([, after]) => after)).toEqual(Array(7).fill(7));
  });

  it("serializes concurrent refreshes and resumes after a failed query without advancing", async () => {
    const first = deferred<RunEvent[]>();
    const second = deferred<RunEvent[]>();
    const fault = new Error("read worker unavailable");
    const query = vi.fn<LocalStore["listRunEvents"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockRejectedValueOnce(fault)
      .mockResolvedValueOnce([response(3, "b")]);
    const cursor = new RunToolLoopGuardCursor({ listRunEvents: query }, RUN);
    const a = cursor.refresh(POLICY);
    const b = cursor.refresh(POLICY);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    first.resolve([response(1, "a")]);
    expect(await a).toEqual(oracle([response(1, "a")], RUN.id, POLICY));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls[1]![1]).toBe(1);
    second.resolve([terminal(2, "a")]);
    await b;
    await expect(cursor.refresh(POLICY)).rejects.toBe(fault);
    expect(await cursor.refresh(POLICY)).toEqual(oracle([response(1, "a"), terminal(2, "a"), response(3, "b")], RUN.id, POLICY));
    expect(query.mock.calls.map(([, after]) => after)).toEqual([0, 1, 2, 2]);
  });

  it.each([
    { name: "non-array", rows: null },
    { name: "wrong Run", rows: [response(2, "b", { runId: "run_other" })] },
    { name: "wrong Thread", rows: [response(2, "b", { threadId: "thread_other" })] },
    { name: "unrequested type", rows: [event(2, "model.text.delta", { text: "noise" })] },
    { name: "unsafe sequence", rows: [response(Number.MAX_SAFE_INTEGER + 1, "b")] },
    { name: "fractional sequence", rows: [response(2.5, "b")] },
    { name: "stale sequence", rows: [response(1, "b")] },
    { name: "duplicate sequence", rows: [terminal(2, "a"), response(2, "b")] },
    { name: "unordered sequence", rows: [response(3, "b"), terminal(2, "a")] },
    { name: "partially valid then wrong Run", rows: [terminal(2, "a"), response(3, "b", { runId: "run_other" })] },
  ])("does not commit any part of a malformed delta: $name", async ({ rows }) => {
    const query = vi.fn<LocalStore["listRunEvents"]>()
      .mockResolvedValueOnce([response(1, "a")])
      .mockResolvedValueOnce(rows as RunEvent[])
      .mockResolvedValueOnce([terminal(2, "a"), response(3, "b"), terminal(4, "b"), response(5, "c"), terminal(6, "c")]);
    const cursor = new RunToolLoopGuardCursor({ listRunEvents: query }, RUN);
    await cursor.refresh(POLICY);
    await expect(cursor.refresh(POLICY)).rejects.toThrow();
    const recovered = await cursor.refresh(POLICY);
    expect(recovered).toEqual(oracle([response(1, "a"), terminal(2, "a"), response(3, "b"), terminal(4, "b"), response(5, "c"), terminal(6, "c")], RUN.id, POLICY));
    expect(recovered.detection).toBeDefined();
    expect(query.mock.calls.map(([, after]) => after)).toEqual([0, 1, 1]);
  });

  it("rejects invalid policy without advancing and allows a valid retry", async () => {
    const query = vi.fn<LocalStore["listRunEvents"]>().mockResolvedValue([response(1, "a")]);
    const cursor = new RunToolLoopGuardCursor({ listRunEvents: query }, RUN);
    await expect(cursor.refresh({ ...POLICY, threshold: 1 })).rejects.toThrow();
    expect(await cursor.refresh(POLICY)).toEqual(oracle([response(1, "a")], RUN.id, POLICY));
    expect(query.mock.calls.map(([, after]) => after)).toEqual([0]);
  });

  it("reads only new typed rows through real SQLite and keeps independent Runs isolated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-loop-cursor-")); roots.push(root);
    const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") });
    stores.push(store); await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({ title: "Cursor delta", agentId: agent.id });
    const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
    const otherThread = await store.createThread({ title: "Foreign cursor", agentId: agent.id });
    const other = await store.createRun({ threadId: otherThread.id, agentId: agent.id });
    const list = store.listRunEvents.bind(store);
    const returned: RunEvent[][] = [];
    const query = vi.spyOn(store, "listRunEvents").mockImplementation(async (...args) => {
      const rows = await list(...args); returned.push(rows); return rows;
    });
    const cursor = new RunToolLoopGuardCursor(store, { id: run.id, threadId: thread.id });
    const foreignCursor = new RunToolLoopGuardCursor(store, { id: other.id, threadId: otherThread.id });
    const append = async (item: RunEvent, target = run) => {
      if (item.payload === null || typeof item.payload !== "object" || Array.isArray(item.payload)) throw new Error("SQLite fixture requires an object payload");
      const type = item.type;
      if (type !== "model.response" && type !== "model.text.delta" && type !== "tool.completed") throw new Error("Unexpected SQLite fixture event type");
      const input = { threadId: target.threadId, runId: target.id, payload: item.payload };
      switch (type) {
        case "model.response": return store.appendEvent({ ...input, type, category: "model" });
        case "model.text.delta": return store.appendEvent({ ...input, type, category: "model" });
        case "tool.completed": {
          const { callId, toolName } = item.payload;
          if (typeof callId !== "string" || typeof toolName !== "string") throw new Error("SQLite fixture terminal requires tool identity");
          return store.appendEvent({ ...input, type, category: "tool", payload: { ...item.payload, callId, toolName } });
        }
      }
    };
    try {
      for (let index = 0; index < 20; index += 1) await append(event(index + 1, "model.text.delta", { text: "noise" }));
      await append(response(1, "foreign"), other);
      const first = await append(response(1, "a"));
      expect(await cursor.refresh(POLICY)).toEqual(oracle(await list(run.id), run.id, POLICY));
      expect(returned.at(-1)!.map((row) => row.seq)).toEqual([first.seq]);
      for (let index = 0; index < 20; index += 1) await append(event(index + 1, "model.text.delta", { text: "more noise" }));
      await cursor.refresh(POLICY);
      expect(returned.at(-1)).toEqual([]);
      const completed = await append(terminal(2, "a"));
      expect(await cursor.refresh(POLICY)).toEqual(oracle(await list(run.id), run.id, POLICY));
      expect(returned.at(-1)!.map((row) => row.seq)).toEqual([completed.seq]);
      expect(query.mock.calls.map(([, after]) => after)).toEqual([0, first.seq, first.seq]);
      for (const [id, , types] of query.mock.calls) { expect(id).toBe(run.id); expect(new Set(types)).toEqual(new Set(TYPES)); }
      expect(await foreignCursor.refresh(POLICY)).toEqual(oracle(await list(other.id), other.id, POLICY));
      expect(query.mock.calls.at(-1)![1]).toBe(0);
      expect(returned.at(-1)!.every((row) => row.runId === other.id)).toBe(true);
    } finally { query.mockRestore(); }
  });
});

function prefixCases() {
  const base = attempts(3);
  const trigger = triggered();
  const redacted = Array.from({ length: 3 }, (_, index) => [
    event(index * 2 + 1, "model.response", { toolCalls: [{ id: `c${index}`, name: "read_file", arguments: {
      kind: "napier.private-workspace-read-arguments", schemaVersion: 1, redacted: true,
      inputSha256: createToolCallSha256("read_file", { path: "secret" }),
    } }] }),
    event(index * 2 + 2, "tool.completed", { callId: `c${index}`, toolName: "read_file", resultSha256: "a".repeat(64) }),
  ]).flat();
  return [
    { name: "completed repeated calls", events: base },
    { name: "late terminal in open tail", events: [...base.slice(0, -1), event(6, "model.text.delta", { text: "noise" }), terminal(7, "c2")] },
    { name: "late terminal after next response", events: [...base.slice(0, -1), response(6, "c3"), terminal(7, "c2"), terminal(8, "c3")] },
    { name: "duplicate terminal after trigger", events: [...trigger, terminal(8, "c2")] },
    { name: "blocked by loop guard", events: [...base.slice(0, -1), event(6, "tool.blocked", { callId: "c2", policyReason: "tool_loop_guard" }), terminal(7, "c2")] },
    { name: "blocked by other policy", events: [...base.slice(0, -1), event(6, "tool.blocked", { callId: "c2", policyReason: "other" }), terminal(7, "c2")] },
    { name: "multicall retires active guard", events: [...trigger, event(8, "model.response", { toolCalls: [call("a"), call("b")] })] },
    { name: "empty tool list retires active guard", events: [...trigger, event(8, "model.response", { toolCalls: [] })] },
    { name: "malformed response still bounds prior turn", events: [...base.slice(0, -1), event(6, "model.response", null), terminal(7, "c2")] },
    { name: "malformed call and terminal payloads", events: [...trigger, event(8, "model.response", { toolCalls: [null] }), event(9, "tool.completed", [])] },
    { name: "changed strategy", events: [...trigger, event(8, "model.response", { toolCalls: [{ ...call("c3"), arguments: { path: "different" } }] }), terminal(9, "c3")] },
    { name: "changed output", events: [...base.slice(0, -1), event(6, "tool.completed", { callId: "c2", toolName: "read_file", output: "different" })] },
    { name: "changed terminal status", events: [...base.slice(0, -1), { ...terminal(6, "c2"), type: "tool.failed" }] },
    { name: "all failed attempts", events: base.map((item) => item.type === "tool.completed" ? { ...item, type: "tool.failed" } : item) },
    { name: "redacted calls and results", events: redacted },
    { name: "reused call IDs", events: attempts(3, true) },
    { name: "malformed trigger ignored", events: [...trigger, event(8, "model.tool_loop.detected", { invalid: true })] },
    { name: "interleaved noise and foreign Run", events: [...base, event(7, "model.text.delta", { text: "noise" }), response(8, "foreign", { runId: "run_other" })] },
  ];
}

function oracle(events: RunEvent[], runId: string, policy: ToolLoopGuardPolicy | undefined) {
  return { detection: detectToolCallLoop(events, runId, policy), triggers: projectToolLoopGuardTriggers(events, runId), active: latestActiveToolLoopGuard(events, runId, policy) };
}
function attempts(count: number, reuse = false) {
  return Array.from({ length: count }, (_, index) => [response(index * 2 + 1, reuse ? "same" : `c${index}`), terminal(index * 2 + 2, reuse ? "same" : `c${index}`)]).flat();
}
function triggered() {
  const events = attempts(3);
  return [...events, event(7, "model.tool_loop.detected", JSON.parse(JSON.stringify(detectToolCallLoop(events, RUN.id, POLICY))))];
}
function call(id: string) { return { id, name: "read_file", arguments: { path: "README.md" } }; }
function response(seq: number, id: string, override: Partial<RunEvent> = {}) { return { ...event(seq, "model.response", { toolCalls: [call(id)] }), ...override }; }
function terminal(seq: number, id: string) { return event(seq, "tool.completed", { callId: id, toolName: "read_file", status: "completed", output: "same result" }); }
function event(seq: number, type: string, payload: RunEvent["payload"]): RunEvent {
  return { id: `event_${seq}`, threadId: RUN.threadId, runId: RUN.id, seq, type,
    category: type.startsWith("tool.") ? "tool" : type.startsWith("model.") ? "model" : "system",
    visibility: "debug", createdAt: "2026-10-29T00:00:00.000Z", payload };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
