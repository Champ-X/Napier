import type { RunEvent, SubagentTask } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  applyConversationSubagentEvent,
  createConversationSubagentEventState,
  projectConversationSubagents,
} from "../src/conversation-subagents-projection.js";

describe("Conversation Subagents projection", () => {
  it("joins latest event positions to privacy-minimized task state", () => {
    const events = [
      event(1, "subagent.queued", {
        taskId: "task_fixture0001",
        description: "PRIVATE_EVENT_DESCRIPTION",
      }),
      event(2, "subagent.completed", {
        taskId: "task_fixture0001",
        result: "PRIVATE_EVENT_RESULT",
      }),
    ];
    const state = events.reduce(
      applyConversationSubagentEvent,
      createConversationSubagentEventState(),
    );
    const view = projectConversationSubagents([task("completed")], state);

    expect(view).toEqual([
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
          usage: { inputTokens: 100, outputTokens: 50 },
          outcome: {
            summary: "One release blocker remains.",
            items: [
              {
                kind: "risk",
                severity: "blocker",
                title: "Missing release proof",
                evidenceCount: 1,
              },
              {
                kind: "recommendation",
                severity: "info",
                title: "Collect release proof",
                evidenceCount: 0,
              },
            ],
          },
        }),
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_");
  });

  it("retains only the latest eight task positions", () => {
    const events = Array.from({ length: 10 }, (_value, index) =>
      event(index + 1, "subagent.queued", {
        taskId: `task_fixture${String(index + 1).padStart(4, "0")}`,
      }),
    );
    const tasks = events.map((eventRecord, index) =>
      task(
        "pending",
        {
          id: `task_fixture${String(index + 1).padStart(4, "0")}`,
        },
        false,
      ),
    );
    const state = events.reduce(
      applyConversationSubagentEvent,
      createConversationSubagentEventState(),
    );

    expect(
      projectConversationSubagents(tasks, state).map((item) => item.seq),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
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
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      costUsd: 0.01,
    },
    createdAt: "2026-08-16T00:00:01.000Z",
    revision: 3,
    ...(includeOutcome
      ? {
          stopReason: "completed" as const,
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
                evidence: [{ path: "PRIVATE_PATH", lineStart: 1, lineEnd: 2 }],
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
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "subagent",
    visibility: "user",
    createdAt: `2026-08-16T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}
