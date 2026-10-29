import type { JsonObject, RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";
import { RunInvocationContextCursor } from "../src/run-invocation-context-cursor.js";
import { taskMemoryQueryFromEvents } from "../src/task-memory-query.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import { createRunControlMessageDeliveredPayload, createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload, nextPendingRunControlMessage } from "../src/run-control-messages.js";
import type { RunEventQueryPort } from "../src/run-event-query-port.js";

const RUN = { id: "run_invocation_cursor", threadId: "thread_invocation_cursor" };
const TYPES = ["message.user", "workflow.node.prompt", "goal.continuation.prompt", "run.recovery.prompt",
  "run.control.queued", "run.control.delivered", "run.control.cancelled",
  "tool.started", "tool.completed", "tool.failed", "tool.blocked"];
const event = (seq: number, type = "message.user", payload: JsonObject = { role: "user", text: "Preserve integer cents." }): RunEvent => ({
  ...RUN, id: `event_invocation_${seq}`, runId: RUN.id, seq, type, payload,
  category: "message", visibility: "user", createdAt: "2026-10-30T00:00:00Z",
});
const oracle = async (events: RunEvent[]) => ({
  memory: taskMemoryQueryFromEvents({ events, threadId: RUN.threadId, sourceRunIds: [RUN.id] }),
  state: projectTaskWorkingState({ events, runId: RUN.id }),
});

function reader() {
  let events: RunEvent[] = [];
  const source = {
    findLatestEvent: vi.fn<RunEventQueryPort["findLatestEvent"]>(async () => structuredClone(events.at(-1))),
    listEventsRange: vi.fn<RunEventQueryPort["listEventsRange"]>(async (_id, from, to, types) =>
      structuredClone(events.filter(item => item.seq >= from && item.seq <= to && (!types || types.includes(item.type))))),
  };
  return { source, set: (value: RunEvent[]) => { events = value; }, cursor: new RunInvocationContextCursor(source, RUN) };
}

describe("Run invocation context event input cursor", () => {
  it("equals complete replay at each valid prefix, including noise and late matching tool evidence", async () => {
    const f = reader();
    const events = [event(1), event(2, "model.text.delta", { text: "noise" }),
      event(3, "tool.started", { toolName: "read_file", callId: "first", callInputSha256: "a".repeat(64) }),
      event(4, "tool.failed", { toolName: "read_file", callId: "first" }),
      event(5, "tool.started", { toolName: "read_file", callId: "retry", callInputSha256: "a".repeat(64) }),
      event(6, "tool.completed", { toolName: "read_file", callId: "retry" }),
      event(7, "goal.continuation.prompt", { text: "Continue unrelated runtime hint." }),
      event(8, "message.user", { role: "user", text: "Preserve the accepted threshold." })];
    expect(f.cursor.canRead(RUN, [])).toBe(true);
    for (let length = 0; length <= events.length; length++) {
      f.set(events.slice(0, length));
      expect(await f.cursor.refresh(oracle)).toEqual(await oracle(events.slice(0, length)));
    }
    expect(f.source.listEventsRange.mock.calls.map(([, from, to]) => [from, to]))
      .toEqual(events.map(item => [item.seq, item.seq]));
    expect(f.source.listEventsRange.mock.calls.every(([, , , types]) => JSON.stringify(types) === JSON.stringify(TYPES))).toBe(true);
    await f.cursor.refresh(oracle);
    expect(f.source.listEventsRange).toHaveBeenCalledTimes(events.length);
  });

  it("does not commit an incomplete delivery prefix and accepts its later adjacent user event", async () => {
    const f = reader();
    const queued = event(2, "run.control.queued", createRunControlMessageQueuedPayload({
      controlMessageId: "control_cursor1234", mode: "steering", text: "Keep the public API unchanged.",
    }));
    const pending = nextPendingRunControlMessage([queued], RUN.id, "steering")!;
    const delivered = event(3, "run.control.delivered", createRunControlMessageDeliveredPayload({ message: pending.message, messageEventSeq: 4 }));
    const user = event(4, "message.user", createRunControlMessageUserPayload(pending));
    f.set([event(1), queued]);
    await f.cursor.refresh(oracle);
    f.set([event(1), queued, delivered]);
    await expect(f.cursor.refresh(oracle)).rejects.toThrow("adjacent user message");
    f.set([event(1), queued, delivered, user]);
    expect(await f.cursor.refresh(oracle)).toEqual(await oracle([event(1), queued, delivered, user]));
    expect(f.source.listEventsRange.mock.calls.map(([, from, to]) => [from, to])).toEqual([[1, 2], [3, 3], [3, 4]]);
  });

  it("keeps a captured durable head when a later event appears during the range read", async () => {
    const f = reader(); f.set([event(1)]);
    f.source.listEventsRange.mockImplementationOnce(async (_id, from, to) => {
      expect([from, to]).toEqual([1, 1]);
      f.set([event(1), event(2)]);
      return [event(1)];
    });
    expect(await f.cursor.refresh(oracle)).toEqual(await oracle([event(1)]));
    expect(await f.cursor.refresh(oracle)).toEqual(await oracle([event(1), event(2)]));
  });

  it.each([
    ["wrong thread", [{ ...event(2), threadId: "thread_other" }]],
    ["unrequested type", [event(2, "model.text.delta")]],
    ["beyond fixed head", [event(4)]],
    ["duplicate sequence", [event(2), event(2)]],
    ["unordered sequence", [event(3), event(2)]],
    ["stale sequence", [event(1)]],
    ["unsafe sequence", [event(Number.MAX_SAFE_INTEGER + 1)]],
    ["missing payload", [{ ...event(2), payload: undefined }]],
    ["non-array", null],
  ])("does not commit any part of an invalid delta: %s", async (_name, invalid) => {
    const f = reader(); f.set([event(1)]); await f.cursor.refresh(oracle);
    f.set([event(1), event(2), event(3)]);
    f.source.listEventsRange.mockResolvedValueOnce(invalid as RunEvent[]);
    await expect(f.cursor.refresh(oracle)).rejects.toThrow();
    expect(await f.cursor.refresh(oracle)).toEqual(await oracle([event(1), event(2), event(3)]));
    expect(f.source.listEventsRange.mock.calls.map(([, from]) => from)).toEqual([1, 2, 2]);
  });

  it("does not advance after backward/invalid heads or failed reads and projections", async () => {
    const f = reader(); f.set([event(1)]); await f.cursor.refresh(oracle);
    for (const head of [undefined, { ...event(2), threadId: "thread_other" }, event(0), event(1.5)]) {
      f.source.findLatestEvent.mockResolvedValueOnce(head);
      await expect(f.cursor.refresh(oracle)).rejects.toThrow();
    }
    f.set([event(1), event(2)]);
    f.source.findLatestEvent.mockRejectedValueOnce(new Error("head unavailable"));
    await expect(f.cursor.refresh(oracle)).rejects.toThrow("head unavailable");
    f.source.listEventsRange.mockRejectedValueOnce(new Error("range unavailable"));
    await expect(f.cursor.refresh(oracle)).rejects.toThrow("range unavailable");
    await expect(f.cursor.refresh(async () => { throw new Error("projection failed"); })).rejects.toThrow("projection failed");
    expect(await f.cursor.refresh(oracle)).toEqual(await oracle([event(1), event(2)]));
    expect(f.source.listEventsRange.mock.calls.map(([, from]) => from)).toEqual([1, 2, 2, 2]);
  });

  it("serializes refreshes and detaches cached history from callback and returned rows", async () => {
    const f = reader(); f.set([event(1)]);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = f.cursor.refresh(async events => { await barrier; events[0]!.payload = {}; return events; });
    const second = f.cursor.refresh(oracle);
    await vi.waitFor(() => expect(f.source.findLatestEvent).toHaveBeenCalledTimes(1));
    release(); (await first).length = 0;
    expect(await second).toEqual(await oracle([event(1)]));
    expect(f.source.listEventsRange).toHaveBeenCalledOnce();
  });

  it("supports legacy fallback, rejects cross-Run reuse and permanently leaves branch history to full replay", () => {
    expect(new RunInvocationContextCursor({}, RUN).canRead(RUN, [])).toBe(false);
    const f = reader();
    expect(() => f.cursor.canRead({ ...RUN, id: "run_other" }, [])).toThrow("another Run");
    expect(f.cursor.canRead(RUN, [{ ...RUN, branchFromSeq: 3 } as RunRecord])).toBe(false);
    expect(f.cursor.canRead(RUN, [])).toBe(false);
    expect(f.source.findLatestEvent).not.toHaveBeenCalled();
  });
});
