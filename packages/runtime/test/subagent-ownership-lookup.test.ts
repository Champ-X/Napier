import type { SubagentTask } from "@napier/contracts";
import { expect, it } from "vitest";
import { findOwnedSubagentByDelegationIntent } from "../src/subagent-ownership-lookup.js";

it("indexes owned children by delegation intent", () => {
  const task = {
    id: "task_1",
    threadId: "thread_1",
    runId: "run_parent",
    role: "researcher",
    description: "lookup",
    prompt: "find ownership",
    status: "running",
    model: { provider: "napier", id: "demo" },
    stepCount: 0,
    turnCount: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    createdAt: "2026-11-04T00:00:00.000Z",
    revision: 1,
  } as SubagentTask;

  expect(
    findOwnedSubagentByDelegationIntent([task], "researcher", "find ownership")
      ?.id,
  ).toBe("task_1");
});
