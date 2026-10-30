import type { Context } from "@earendil-works/pi-ai";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { expect, it, vi } from "vitest";
import { agentInvocationContextFor } from "../src/agent-invocation-context.js";
import { createSubagentInvocationContextPreparer } from "../src/subagent-invocation-context.js";

const policy = { prompt: "stable-v1", memory: "task-aware-v1", workingState: "evidence-v1" } as const;

function fixture() {
  const parent = { id: "parent", threadId: "thread", agentId: "agent", source: "user" } as RunRecord;
  const previous = { id: "prior-child", threadId: "thread", agentId: "agent", source: "subagent", parentRunId: parent.id,
    subagent: { taskId: "prior-task", executionId: "prior-execution" } } as RunRecord;
  const child = { id: "child", threadId: "thread", agentId: "agent", source: "subagent", parentRunId: parent.id,
    subagent: { taskId: "task", executionId: "execution", continuation: {
      targetRunId: "child", targetTaskId: "task", targetExecutionId: "execution", targetParentRunId: "parent",
      predecessorRunId: previous.id, predecessorTaskId: "prior-task", predecessorExecutionId: "prior-execution", predecessorRunHeadSeq: 10,
    } } } as RunRecord;
  const message = (runId: string, seq: number, text: string) => ({ id: `event-${seq}`, runId, threadId: "thread", seq,
    type: "message.user", category: "message", visibility: "user", createdAt: new Date(0).toISOString(), payload: { role: "user", text } } as RunEvent);
  const events = [message(parent.id, 1, "SUPERVISOR_ONLY"), message(previous.id, 10, "PRIOR_CHILD_ALLOWED"),
    message(previous.id, 11, "PRIOR_CHILD_FUTURE"), message(child.id, 12, "CURRENT_CHILD_TASK")];
  const store = {
    workspaceRoot: "/unused", listRuns: () => [parent, previous, child],
    listEvents: vi.fn(async () => events),
    // Include unrelated data in the query response to exercise the boundary oracle.
    listRunEvents: vi.fn(async (_runId: string) => events), listMemories: () => [], appendEvent: vi.fn(async () => undefined),
  };
  return { parent, previous, child, store };
}

it("binds task context to the actual child and predecessor window without rewriting supervisor ancestry", async () => {
  const f = fixture();
  const original = structuredClone(f.child);
  const prepare = createSubagentInvocationContextPreparer(f.store, f.child);
  const context: Context = { messages: [{ role: "user", content: "BOUND_TASK", timestamp: 0 }] };
  const prepared = await prepare({ context, policy });
  const state = agentInvocationContextFor(prepared).workingState;
  expect(state).toContain("CURRENT_CHILD_TASK");
  expect(state).toContain("PRIOR_CHILD_ALLOWED");
  expect(state).not.toContain("SUPERVISOR_ONLY");
  expect(state).not.toContain("PRIOR_CHILD_FUTURE");
  expect(f.store.listEvents).not.toHaveBeenCalled();
  expect(f.store.listRunEvents.mock.calls.map(call => call[0])).toEqual(["child", "prior-child"]);
  expect(f.child).toEqual(original);
  expect(prepared.messages).toEqual(context.messages);
  expect(JSON.stringify(f.store.appendEvent.mock.calls)).not.toContain("SUPERVISOR_ONLY");
  expect(JSON.stringify(f.store.appendEvent.mock.calls)).not.toContain("PRIOR_CHILD_FUTURE");
});

it.each(["targetTaskId", "predecessorExecutionId", "predecessorRunId", "predecessorRunHeadSeq"])(
  "rejects an invalid continuation context binding for %s before any event query", async (field) => {
    const f = fixture();
    Object.assign(f.child.subagent!.continuation!, { [field]: field === "predecessorRunHeadSeq" ? -1 : "unrelated" });
    const prepare = createSubagentInvocationContextPreparer(f.store, f.child);
    await expect(async () => prepare({ context: { messages: [] }, policy })).rejects.toThrow(/lineage|binding|target/u);
    expect(f.store.listEvents).not.toHaveBeenCalled();
    expect(f.store.listRunEvents).not.toHaveBeenCalled();
  },
);
