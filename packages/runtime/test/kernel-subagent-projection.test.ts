import type { RunEvent, SubagentTask, ThreadRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { KernelProjectionRegistry } from "../src/kernel-projections.js";
import { ConversationSubagentsProjectionService } from "../src/kernel-subagent-projection.js";

describe("Kernel Subagent projection", () => {
  it("reuses event state while joining current task progress", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const events = [event(1, "subagent.started")];
    const tasks = [task("running")];
    thread.eventCount = 1;
    const service = new ConversationSubagentsProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listEvents: async (_threadId, afterSeq = 0) =>
        events.filter((eventRecord) => eventRecord.seq > afterSeq),
      listSubagentTasks: () => structuredClone(tasks),
    });

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            seq: 1,
            task: expect.objectContaining({
              status: "running",
              stepCount: 1,
            }),
          }),
        ],
      }),
    );

    tasks[0] = task("running", { stepCount: 3, turnCount: 2, revision: 4 });
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 0,
        view: [
          expect.objectContaining({
            task: expect.objectContaining({
              stepCount: 3,
              turnCount: 2,
            }),
          }),
        ],
      }),
    );

    events.push(event(2, "subagent.completed"));
    tasks[0] = task("completed", {
      stopReason: "completed",
      revision: 5,
      outcome: {
        kind: "napier.subagent-outcome",
        schemaVersion: 2,
        taskId: "task_fixture0001",
        role: "reviewer",
        model: { provider: "napier", id: "demo" },
        summary: "Review complete.",
        items: [],
        unknowns: [],
        itemCount: 0,
        unknownCount: 0,
        evidenceCount: 0,
        promptSha256: "1".repeat(64),
        instructionsSha256: "2".repeat(64),
        resultSha256: "3".repeat(64),
        itemSetSha256: "4".repeat(64),
        evidenceSetSha256: "5".repeat(64),
        contentSha256: "6".repeat(64),
      },
    });
    thread.eventCount = 2;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            seq: 2,
            task: expect.objectContaining({ status: "completed" }),
          }),
        ],
      }),
    );
  });
});

function projectionThread(): ThreadRecord {
  return {
    id: "thread_subagent",
    title: "Subagent projection",
    agentId: "agent_subagent",
    status: "running",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
    runIds: ["run_subagent"],
  };
}

function task(
  status: SubagentTask["status"],
  overrides: Partial<SubagentTask> = {},
): SubagentTask {
  return {
    id: "task_fixture0001",
    threadId: "thread_subagent",
    runId: "run_subagent",
    role: "reviewer",
    description: "Review current evidence",
    prompt: "PRIVATE_PROMPT",
    status,
    model: { provider: "napier", id: "demo" },
    stepCount: 1,
    turnCount: 1,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    createdAt: "2026-08-16T00:00:00.000Z",
    revision: 2,
    ...overrides,
  };
}

function event(seq: number, type: string): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_subagent",
    runId: "run_subagent",
    seq,
    type,
    category: "subagent",
    visibility: "user",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload: { taskId: "task_fixture0001" },
  };
}
