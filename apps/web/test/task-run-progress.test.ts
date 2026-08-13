import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { taskRunProgress } from "../src/task-run-progress";

describe("Task run progress", () => {
  it("groups durable completed calls and keeps the latest active call", () => {
    const events = [
      toolEvent(1, "tool.started", "read_file", "read_1"),
      toolEvent(2, "tool.completed", "read_file", "read_1"),
      toolEvent(3, "tool.started", "read_file", "read_2"),
      toolEvent(4, "tool.completed", "read_file", "read_2"),
      toolEvent(5, "tool.started", "run_command", "command_1"),
      toolEvent(6, "tool.completed", "run_command", "command_1", {
        details: { status: "succeeded" },
      }),
      toolEvent(7, "tool.started", "web_search", "search_1"),
    ];

    expect(taskRunProgress(events, "run_1")).toEqual({
      currentAction: "Running web search",
      completedItems: ["Read 2 files", "Ran 1 command"],
    });
  });

  it("bounds long-run groups and ignores hidden, failed, and other-run work", () => {
    const events = [
      completedCall(1, "read_file", "read_1"),
      completedCall(3, "run_command", "command_1", {
        details: { status: "failed" },
      }),
      completedCall(5, "web_search", "search_1"),
      completedCall(7, "web_fetch", "fetch_1"),
      completedCall(9, "browser", "browser_1"),
      {
        ...toolEvent(11, "tool.completed", "apply_patch", "hidden_1"),
        visibility: "hidden" as const,
      },
      {
        ...toolEvent(12, "tool.completed", "apply_patch", "other_1"),
        runId: "run_2",
      },
    ].flat();

    expect(taskRunProgress(events, "run_1").completedItems).toEqual([
      "2 earlier actions",
      "Fetched 1 source",
      "Completed 1 browser step",
    ]);
  });
});

function completedCall(
  seq: number,
  toolName: string,
  callId: string,
  extra: Record<string, unknown> = {},
): RunEvent[] {
  return [
    toolEvent(seq, "tool.started", toolName, callId),
    toolEvent(seq + 1, "tool.completed", toolName, callId, extra),
  ];
}

function toolEvent(
  seq: number,
  type: "tool.started" | "tool.completed",
  toolName: string,
  callId: string,
  extra: Record<string, unknown> = {},
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
    payload: { callId, toolName, ...extra },
  };
}
