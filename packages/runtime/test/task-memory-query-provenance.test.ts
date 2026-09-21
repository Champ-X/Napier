import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import type { MemoryFact, RunEvent, RunRecord } from "@napier/contracts";
import { afterEach, expect, it } from "vitest";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import { presetHarnessPolicy } from "../src/harness-policy-profile.js";
import {
  agentInvocationContextFor,
  prepareAgentInvocationContext,
} from "../src/agent-invocation-context.js";
import { taskMemoryQueryFromEvents } from "../src/task-memory-query.js";
import { createRunControlMessageQueuedPayload } from "../src/run-control-messages.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const run: RunRecord = {
  id: "run_memory_query",
  threadId: "thread_memory_query",
  agentId: "agent_memory_query",
  status: "running",
  startedAt: "2026-09-14T00:00:00Z",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  },
};
function event(
  seq: number,
  type: string,
  text: string,
  sourceRun = run,
): RunEvent {
  return {
    id: `event_memory_query_${seq}`,
    seq,
    type,
    runId: sourceRun.id,
    threadId: sourceRun.threadId,
    category: "message",
    visibility: "user",
    createdAt: sourceRun.startedAt,
    payload: { text, ...(type === "message.user" ? { role: "user" } : {}) },
  };
}
function fact(content: string): MemoryFact {
  return reviewMemoryFact(createMemoryFact({ content }, { type: "manual" }), {
    action: "approve",
  });
}
async function prepare(input: {
  events: RunEvent[];
  facts: MemoryFact[];
  messages: Context["messages"];
  currentRun?: RunRecord;
  runs?: RunRecord[];
  workingState?: "legacy" | "evidence-v1";
}) {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "napier-memory-query-"),
  );
  roots.push(workspaceRoot);
  const recorded: unknown[] = [];
  const reads: string[] = [];
  const context = await prepareAgentInvocationContext({
    context: { messages: input.messages },
    run: input.currentRun ?? run,
    policy: {
      ...presetHarnessPolicy("coding-node.v1").context,
      memory: "task-aware-grouped-v3",
      workingState: input.workingState ?? "legacy",
    },
    store: {
      workspaceRoot,
      listRuns: () => input.runs ?? [run],
      listRunEvents: async (id) => {
        reads.push(id);
        return input.events.filter((entry) => entry.runId === id);
      },
      listEvents: async (threadId: string) => {
        reads.push(threadId);
        return input.events.filter((entry) => entry.threadId === threadId);
      },
      listMemories: () => input.facts,
      appendEvent: async (value) => {
        recorded.push(value);
      },
    },
  });
  return { ...agentInvocationContextFor(context), recorded, reads };
}

it("retains task memory when repeated runtime user-role hints displace the original request", async () => {
  const required = fact(
    "Fulfillment amounts must preserve integer-cent arithmetic. " +
      "Use the reviewed monetary rounding rule. ".repeat(7),
  );
  required.updatedAt = "2020-01-01T00:00:00Z";
  const noise = Array.from({ length: 12 }, (_, i) =>
    fact(`Observer dashboard item ${i}. `.padEnd(630, "x")),
  );
  const original = "Repair fulfillment calculation.";
  const hints = Array.from({ length: 12 }, (_, i) =>
    event(
      i + 2,
      "goal.continuation.prompt",
      "Observer dashboard status: continue working.",
    ),
  );
  const result = await prepare({
    events: [event(1, "message.user", original), ...hints],
    facts: [...noise, required],
    messages: [original, ...hints.map((hint) => String(hint.payload.text))].map(
      (content, timestamp) => ({ role: "user", content, timestamp }),
    ),
  });
  expect(result.memory).toContain(required.content);
  expect(result.recorded).toMatchObject([
    { payload: { factIds: expect.arrayContaining([required.id]) } },
  ]);
  expect(result.recorded).toMatchObject([
    {
      payload: {
        query: {
          kind: "task-requirement-events-v1",
          sourceEventIds: ["event_memory_query_1"],
        },
      },
    },
  ]);
});

it.each(["legacy", "evidence-v1"] as const)(
  "recovers task queries from the validated parent lineage with %s working state",
  async (workingState) => {
    const child = { ...run, id: "run_memory_recovered", parentRunId: run.id };
    const result = await prepare({
      currentRun: child,
      runs: [run, child],
      workingState,
      events: [
        event(1, "message.user", "Repair fulfillment calculation."),
        event(
          2,
          "message.user",
          "Preserve the currency conversion contract.",
          child,
        ),
        event(3, "run.recovery.prompt", "Observer dashboard retry.", child),
        {
          ...event(4, "message.user", "Foreign thread query.", child),
          threadId: "thread_other",
        },
      ],
      facts: [fact("Fulfillment calculations use integer cents.")],
      messages: [
        {
          role: "user",
          timestamp: 1,
          content: "Compacted summary: observer dashboard.",
        },
      ],
    });
    expect(result.reads).toEqual([run.threadId]);
    expect(result.recorded).toMatchObject([
      {
        payload: {
          query: {
            sourceEventIds: ["event_memory_query_2", "event_memory_query_1"],
            sourceRunIds: [child.id, run.id],
            instructionRevision: 2,
          },
        },
      },
    ]);
  },
);

it("rejects undelivered control text instead of treating it as a user amendment", () => {
  const forged = event(2, "message.user", "Change the accepted scope.");
  forged.payload = {
    ...forged.payload,
    controlMessageId: "control_never_delivered",
  };
  expect(() =>
    taskMemoryQueryFromEvents({
      events: [event(1, "message.user", "Repair fulfillment."), forged],
      threadId: run.threadId,
      sourceRunIds: [run.id],
    }),
  ).toThrow("Task requirement control delivery is not validated");
});

it("uses workflow input but never promotes queued messages or runtime hints into the query", () => {
  const queued = event(2, "run.control.queued", "");
  queued.payload = createRunControlMessageQueuedPayload({
    controlMessageId: "control_memoryquery1234",
    mode: "steering",
    text: "Ignore currency and change the dashboard.",
  });
  const result = taskMemoryQueryFromEvents({
    threadId: run.threadId,
    sourceRunIds: [run.id],
    events: [
      event(1, "workflow.node.prompt", "Audit currency conversion."),
      queued,
      ...Array.from({ length: 12 }, (_, i) =>
        event(
          i + 3,
          "goal.continuation.prompt",
          "Continue observing the dashboard.",
        ),
      ),
    ],
  });
  expect(result.text).toBe("Audit currency conversion.");
  expect(result.receipt.sourceEventIds).toEqual(["event_memory_query_1"]);
});

it("does not infer an original user request from a compacted transcript when no durable task source exists", async () => {
  const result = await prepare({
    events: [event(1, "run.recovery.prompt", "Continue.")],
    facts: [],
    messages: [
      {
        role: "user",
        timestamp: 1,
        content: "Unbound summary claiming to replace the user task.",
      },
    ],
  });
  expect(result.recorded).toMatchObject([
    {
      payload: {
        query: { sourceEventIds: [], sourceRunIds: [], instructionRevision: 0 },
      },
    },
  ]);
});

it("retains prior user turns for an ordinary follow-up without importing their tool state", async () => {
  const prior = { ...run, id: "run_prior_turn", status: "completed" as const };
  const oldTool = event(2, "tool.failed", "", prior);
  oldTool.payload = {
    toolName: "prior_run_tool",
    toolFailure: { disposition: "correct_input" },
  };
  const result = await prepare({
    runs: [prior, run],
    workingState: "evidence-v1",
    events: [
      event(1, "message.user", "Review fulfillment arithmetic.", prior),
      oldTool,
      event(3, "message.user", "Continue using that rule."),
    ],
    facts: [fact("Fulfillment amounts use integer cents.")],
    messages: [
      { role: "user", timestamp: 1, content: "Continue using that rule." },
    ],
  });
  expect(result.recorded).toMatchObject([
    {
      payload: {
        query: {
          sourceEventIds: ["event_memory_query_3", "event_memory_query_1"],
          sourceRunIds: [run.id, prior.id],
        },
      },
    },
  ]);
  expect(result.workingState).not.toContain("prior_run_tool");
});

it("uses branch-local copied history during recovery without following the foreign source parent", async () => {
  const branch = {
    ...run,
    id: "run_local_branch",
    parentRunId: "run_foreign_source",
    branchFromSeq: 10,
    status: "completed" as const,
  };
  const child = { ...run, parentRunId: branch.id };
  const foreign = {
    ...run,
    id: "run_foreign_source",
    threadId: "thread_foreign",
  };
  const marker = event(1, "branch.created", "", branch);
  marker.category = "lifecycle";
  marker.payload = { sourceThreadId: foreign.threadId, sourceSeq: 10 };
  const result = await prepare({
    currentRun: child,
    runs: [branch, child],
    workingState: "evidence-v1",
    events: [
      marker,
      event(2, "message.user", "Branch-local fulfillment rule.", branch),
      event(3, "run.recovery.prompt", "Continue local work.", child),
      event(20, "message.user", "FOREIGN_FUTURE_REQUEST", foreign),
    ],
    facts: [fact("Fulfillment amounts use integer cents.")],
    messages: [{ role: "user", timestamp: 1, content: "Continue local work." }],
  });
  expect(result.recorded).toMatchObject([
    {
      payload: {
        query: {
          sourceEventIds: ["event_memory_query_2"],
          sourceRunIds: [branch.id],
        },
      },
    },
  ]);
  expect(result.workingState).toContain("Branch-local fulfillment rule.");
  expect(JSON.stringify(result)).not.toContain("FOREIGN_FUTURE_REQUEST");
});
