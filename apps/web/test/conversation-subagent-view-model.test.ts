import type { RunEvent, SubagentTask } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationSubagentEventId,
  conversationSubagents,
} from "../src/conversation-subagent-view-model";

describe("Conversation Subagents", () => {
  it("joins event order to authoritative task and outcome counts", () => {
    const subagents = conversationSubagents(
      [
        event(1, "subagent.queued", {
          taskId: "task_fixture0001",
          description: "PRIVATE_EVENT_DESCRIPTION",
        }),
        event(2, "subagent.completed", {
          taskId: "task_fixture0001",
          result: "PRIVATE_EVENT_RESULT",
        }),
      ],
      [task("completed")],
    );

    expect(subagents).toEqual([
      expect.objectContaining({
        id: "event_2",
        seq: 2,
        itemCount: 2,
        evidenceCount: 1,
        unknownCount: 1,
        blockerCount: 1,
        warningCount: 0,
        task: expect.objectContaining({
          description: "Review the release evidence",
          status: "completed",
        }),
      }),
    ]);
    expect(JSON.stringify(subagents)).not.toContain("PRIVATE_EVENT");
  });

  it("projects running and failed tasks without exposing result or error text", () => {
    const running = conversationSubagents(
      [event(3, "subagent.started", { taskId: "task_fixture0001" })],
      [task("running")],
    )[0]!;
    const failed = conversationSubagents(
      [event(4, "subagent.failed", { taskId: "task_fixture0001" })],
      [
        task(
          "failed",
          {
            result: "PRIVATE_TASK_RESULT",
            error: "PRIVATE_TASK_ERROR",
            stopReason: "error",
          },
          false,
        ),
      ],
    )[0]!;

    expect(running.task.status).toBe("running");
    expect(failed.task.status).toBe("failed");
    expect(failed.itemCount).toBe(0);
    const safeProjection = {
      status: failed.task.status,
      stopReason: failed.task.stopReason,
      itemCount: failed.itemCount,
    };
    expect(JSON.stringify(safeProjection)).not.toContain("PRIVATE_TASK");
  });

  it("filters hidden, malformed, and unbound Subagent events", () => {
    const events = [
      event(1, "subagent.queued", { taskId: "task_fixture0001" }, "hidden"),
      event(2, "subagent.future", { taskId: "task_fixture0001" }),
      event(3, "subagent.started", { taskId: "PRIVATE_TASK" }),
      event(4, "subagent.started", { taskId: "task_missing0001" }),
      event(5, "subagent.started", { taskId: "task_fixture0001" }),
    ];

    expect(conversationSubagentEventId(events[0]!)).toBeUndefined();
    expect(conversationSubagentEventId(events[1]!)).toBeUndefined();
    expect(conversationSubagentEventId(events[2]!)).toBeUndefined();
    expect(conversationSubagents(events, [task("running")])).toHaveLength(1);
  });
});

function task(
  status: SubagentTask["status"],
  overrides: Partial<SubagentTask> = {},
  includeOutcome = true,
): SubagentTask {
  return {
    id: "task_fixture0001",
    threadId: "thread_1",
    runId: "run_1",
    role: "reviewer",
    description: "Review the release evidence",
    prompt: "PRIVATE_TASK_PROMPT",
    status,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    stepCount: 3,
    turnCount: 2,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    },
    createdAt: timestamp(1),
    ...(status !== "pending" ? { startedAt: timestamp(2) } : {}),
    ...(!["pending", "running"].includes(status)
      ? { finishedAt: timestamp(3) }
      : {}),
    revision: 3,
    ...(includeOutcome
      ? {
          outcome: {
            kind: "napier.subagent-outcome" as const,
            schemaVersion: 2 as const,
            taskId: "task_fixture0001",
            role: "reviewer" as const,
            model: { provider: "deepseek", id: "deepseek-v4-flash" },
            summary: "One release blocker remains.",
            items: [
              {
                kind: "risk" as const,
                severity: "blocker" as const,
                title: "Missing release proof",
                detail: "PRIVATE_OUTCOME_DETAIL",
                evidence: [
                  {
                    path: "PRIVATE_EVIDENCE_PATH",
                    lineStart: 1,
                    lineEnd: 2,
                  },
                ],
              },
              {
                kind: "recommendation" as const,
                severity: "info" as const,
                title: "Collect release proof",
                detail: "PRIVATE_RECOMMENDATION_DETAIL",
                evidence: [],
              },
            ],
            unknowns: ["PRIVATE_UNKNOWN"],
            itemCount: 2,
            unknownCount: 1,
            evidenceCount: 1,
            promptSha256: "a".repeat(64),
            instructionsSha256: "b".repeat(64),
            resultSha256: "c".repeat(64),
            itemSetSha256: "d".repeat(64),
            evidenceSetSha256: "e".repeat(64),
            contentSha256: "f".repeat(64),
          },
        }
      : {}),
    ...overrides,
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  visibility: RunEvent["visibility"] = "user",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "subagent",
    visibility,
    createdAt: timestamp(seq),
    payload,
  };
}

function timestamp(second: number): string {
  return `2026-08-08T00:00:0${String(second)}.000Z`;
}
