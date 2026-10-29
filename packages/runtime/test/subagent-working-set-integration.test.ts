import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupModelSessionFixtures, createModelSessionFixture, awaitedEventBarrier } from "./subagent-model-session-fixture.js";
import { LocalPrivateCapsuleDurabilityUnavailableError } from "../src/local-private-capsule-store.js";

afterEach(async () => { vi.restoreAllMocks(); await cleanupModelSessionFixtures(); });

describe("private child working set", () => {
  it("keeps an earlier pointer and consumed cursor unchanged when directory durability becomes unavailable", async () => {
    const barrier = awaitedEventBarrier((event) => event.type === "subagent.model.invocation");
    const fixture = await createModelSessionFixture({ onEvent: barrier.onEvent });
    const prepare = fixture.store.prepareSubagentChildCheckpoint.bind(fixture.store);
    let preparations = 0;
    vi.spyOn(fixture.store, "prepareSubagentChildCheckpoint").mockImplementation((input) => ++preparations === 1
      ? prepare(input) : Promise.reject(new LocalPrivateCapsuleDurabilityUnavailableError("fixture directory support changed")));
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Completed with a stale private checkpoint", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    await barrier.reached;
    try { await fixture.supervisor.send(handle, { text: "This constraint reaches the model but has no durable source checkpoint." }); }
    finally { barrier.release(); }
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(result.task.turnCount).toBe(2);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    expect(child.subagent!.checkpoint).toMatchObject({ revision: 1, messageCount: 1, mailboxConsumedCount: 0, mailboxConsumedThroughSeq: 0 });
    expect((await fixture.supervisor.inspect(handle)).mailbox).toMatchObject({ acceptedCount: 1, deliveredCount: 1, consumedCount: 0 });
    const events = await fixture.store.listRunEvents(child.id);
    expect(events.filter((event) => event.type === "subagent.child.checkpoint_unavailable")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(2);
  });
  it("retains the denied repeated tool ID and lets the model continue with a fresh call", async () => {
    const fixture = await createModelSessionFixture();
    fixture.faux.setResponses([
      ...["reused-call", "reused-call", "fresh-call"].map((id) => fauxAssistantMessage(
        fauxToolCall("list_files", { path: ".", depth: 0 }, { id }), { stopReason: "toolUse" })),
      fauxAssistantMessage(JSON.stringify({ summary: "Completed after choosing a fresh call identity", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(result.task.turnCount).toBe(4);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    const capsule = JSON.parse(await readFile(path.join(fixture.store.dataRoot, "subagent-working-sets", `${child.subagent!.checkpoint!.capsuleSha256}.json`), "utf8"));
    expect(capsule.messages[4]).toMatchObject({ role: "toolResult", toolCallId: "reused-call", isError: true });
    const events = await fixture.store.listRunEvents(child.id);
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(2);
  });
  it("retains ordinary execution with explicit checkpoint unavailability on unsupported directory durability", async () => {
    const fixture = await createModelSessionFixture();
    vi.spyOn(fixture.store, "prepareSubagentChildCheckpoint").mockRejectedValue(new LocalPrivateCapsuleDurabilityUnavailableError("unsupported fixture platform"));
    fixture.faux.setResponses([fauxAssistantMessage(JSON.stringify({ summary: "Completed without restart guarantee", items: [], unknowns: [] }))]);
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(result.task.turnCount).toBe(1);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    expect(child.subagent!.checkpoint).toBeUndefined();
    const unavailable = (await fixture.store.listRunEvents(child.id)).filter((event) => event.type === "subagent.child.checkpoint_unavailable");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]!.payload).toMatchObject({ reason: "durable_directory_unsupported", continuationAvailable: false });
  });
  it("preserves a schema-rejected tool result so the next model turn can correct the request", async () => {
    const fixture = await createModelSessionFixture();
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", {}, { id: "invalid-arguments" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Stopped the invalid request safely", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(result.task.turnCount).toBe(2);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    const capsule = JSON.parse(await readFile(path.join(fixture.store.dataRoot, "subagent-working-sets", `${child.subagent!.checkpoint!.capsuleSha256}.json`), "utf8"));
    expect(capsule.messages[2]).toMatchObject({ role: "toolResult", toolCallId: "invalid-arguments", isError: true });
    expect((await fixture.store.listRunEvents(child.id)).filter((event) => event.type === "tool.started")).toHaveLength(0);
  });
  it("settles a checkpoint write failure without dispatching or counting a synthetic model turn", async () => {
    const fixture = await createModelSessionFixture();
    vi.spyOn(fixture.store, "commitSubagentChildCheckpoint").mockRejectedValue(new Error("fixture checkpoint write failed"));
    const physical = vi.spyOn(fixture.registry.models, "streamSimple");
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("failed");
    expect(result.task.error).toContain("fixture checkpoint write failed");
    expect(result.task.turnCount).toBe(0);
    expect(physical).not.toHaveBeenCalled();
  });
  it("persists the full settled tool transcript under the child identity without public conversation messages", async () => {
    const fixture = await createModelSessionFixture();
    await writeFile(path.join(fixture.store.workspaceRoot, "private-tool-marker.txt"), "fixture only");
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Inspected files", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("completed");
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    const pointer = (child.subagent as unknown as { checkpoint?: { capsuleSha256: string; messageCount: number } }).checkpoint;
    expect(pointer).toBeDefined();
    const capsule = JSON.parse(await readFile(path.join(fixture.store.dataRoot, "subagent-working-sets", `${pointer!.capsuleSha256}.json`), "utf8"));
    expect(capsule.frontier).toMatchObject({ runId: child.id, parentRunId: fixture.run.id, taskId: result.task.id, executionId: handle.executionId });
    expect(capsule.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(JSON.stringify(capsule.messages[2])).toContain("private-tool-marker.txt");
    expect(pointer!.messageCount).toBe(4);
    const events = await fixture.store.listEvents(fixture.thread.id);
    expect(events.filter((event) => event.runId === child.id && ["message.user", "message.assistant"].includes(event.type))).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("private-tool-marker.txt");
  });

  it("distinguishes steering enqueue delivery from durable transcript consumption", async () => {
    const barrier = awaitedEventBarrier((event) => event.type === "subagent.model.invocation");
    const fixture = await createModelSessionFixture({ onEvent: barrier.onEvent });
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Applied steering", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    await barrier.reached;
    try {
      await fixture.supervisor.send(handle, { text: "Keep the original task and include the extra constraint." });
      const pending = await fixture.supervisor.inspect(handle);
      expect(pending.mailbox).toMatchObject({ acceptedCount: 1, deliveredCount: 1, consumedCount: 0 });
    } finally { barrier.release(); }
    expect((await fixture.supervisor.collect(handle)).status).toBe("completed");
    expect((await fixture.supervisor.inspect(handle)).mailbox).toMatchObject({ acceptedCount: 1, deliveredCount: 1, consumedCount: 1 });
  });

  it("keeps a sparse consumed set when a later accepted message reaches the child first", async () => {
    let invocation = 0;
    const first = awaitedEventBarrier((event) => event.type === "subagent.model.invocation" && ++invocation === 1);
    let secondCount = 0;
    const second = awaitedEventBarrier((event) => event.type === "subagent.model.invocation" && ++secondCount === 2);
    const acceptedA = awaitedEventBarrier((event) => event.type === "subagent.message.accepted" &&
      event.payload !== null && typeof event.payload === "object" && !Array.isArray(event.payload) && event.payload["text"] === "Constraint A");
    const fixture = await createModelSessionFixture({ timeoutMs: 15_000,
      onEvent: async (event) => { await acceptedA.onEvent(event); await second.onEvent(event); await first.onEvent(event); } });
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }, { id: "first-call" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }, { id: "second-call" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Both constraints applied", items: [], unknowns: [] })),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    await first.reached;
    const sendA = fixture.supervisor.send(handle, { text: "Constraint A" });
    try {
      await acceptedA.reached;
      await fixture.supervisor.send(handle, { text: "Constraint B" });
      first.release();
      await second.reached;
      expect((await fixture.supervisor.inspect(handle)).mailbox).toMatchObject({ acceptedCount: 2, consumedCount: 1, consumedThroughSeq: 0 });
      acceptedA.release();
      await sendA;
    } finally { acceptedA.release(); first.release(); second.release(); }
    expect((await fixture.supervisor.collect(handle)).status).toBe("completed");
    const final = await fixture.supervisor.inspect(handle);
    expect(final.mailbox).toMatchObject({ acceptedCount: 2, consumedCount: 2 });
    expect(final.mailbox.consumedThroughSeq).toBeGreaterThan(0);
  });
});
