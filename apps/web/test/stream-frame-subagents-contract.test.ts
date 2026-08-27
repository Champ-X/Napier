import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame subagent contract", () => {
  it("accepts a strictly projected Subagent Hub", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: runEvent(),
          projections: { subagentHub: hubProjection() },
        },
        helpers(),
      ),
    ).toBeUndefined();
  });

  it("rejects a Subagent Hub containing an uncontracted field", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: runEvent(),
          projections: {
            subagentHub: { ...hubProjection(), privatePrompt: "secret" },
          },
        },
        helpers(),
      ),
    ).toBe("invalid_event");
  });

  it("rejects projected cards containing private task fields", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: {
            id: "event_1",
            threadId: "thread_1",
            runId: "run_1",
            seq: 1,
            type: "model.text.delta",
            category: "model",
            visibility: "user",
            createdAt: "2026-08-16T00:00:01.000Z",
            payload: { delta: "hello" },
          },
          projections: {
            subagentCards: [
              {
                id: "event_subagent",
                seq: 1,
                createdAt: "2026-08-16T00:00:01.000Z",
                task: {
                  id: "task_fixture0001",
                  role: "reviewer",
                  description: "Review evidence",
                  prompt: "PRIVATE_PROMPT",
                  status: "running",
                  model: { provider: "napier", id: "demo" },
                  stepCount: 1,
                  turnCount: 1,
                  usage: { inputTokens: 10, outputTokens: 5 },
                },
                itemCount: 0,
                evidenceCount: 0,
                unknownCount: 0,
                blockerCount: 0,
                warningCount: 0,
              },
            ],
          },
        },
        {
          snapshot: () => true,
          error: () => true,
          done: () => true,
        },
      ),
    ).toBe("invalid_event");
  });
});

function helpers() {
  return { snapshot: () => true, error: () => true, done: () => true };
}

function runEvent() {
  return {
    id: "event_1",
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type: "subagent.started",
    category: "subagent",
    visibility: "user",
    createdAt: "2026-08-16T00:00:01.000Z",
    payload: { taskId: "task_fixture0001" },
  };
}

function hubProjection() {
  return {
    kind: "napier.subagent-hub-projection",
    schemaVersion: 1,
    threadId: "thread_1",
    taskCount: 1,
    selectedTaskCount: 1,
    activeTaskCount: 1,
    terminalTaskCount: 0,
    orphanedTaskCount: 0,
    omittedTaskCount: 0,
    eventWatermark: 1,
    tasks: [
      {
        taskId: "task_fixture0001",
        runId: "run_1",
        role: "reviewer",
        description: "Review evidence",
        status: "running",
        taskStatus: "running",
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
        revision: 2,
        createdAt: "2026-08-16T00:00:00.000Z",
        mailbox: { acceptedCount: 0, deliveredCount: 0, pendingCount: 0 },
        lineage: { childTaskIds: [] },
        transcript: [],
        worktree: { state: "none" },
        control: { steer: true, cancel: true, revive: false },
      },
    ],
  };
}
