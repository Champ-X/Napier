import type { RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { latestManuallyResumableRun } from "../src/manual-run-recovery";

describe("manual Run recovery view model", () => {
  it("exposes the latest paused-budget Run from an idle Thread", () => {
    const completed = run("completed", "run_completed");
    const pausedBudget = run("failed", "run_paused", {
      outcome: "paused_budget",
    });

    expect(
      latestManuallyResumableRun("idle", [completed, pausedBudget]),
    ).toEqual(pausedBudget);
  });

  it("preserves interrupted recovery and does not expose partial settlements", () => {
    const interrupted = run("interrupted", "run_interrupted");
    const partial = run("failed", "run_partial", { outcome: "partial" });

    expect(latestManuallyResumableRun("waiting", [interrupted])).toEqual(
      interrupted,
    );
    expect(latestManuallyResumableRun("idle", [partial])).toBeUndefined();
  });

  it("does not fall back past a latest Workflow-owned settlement", () => {
    const ordinary = run("failed", "run_ordinary", {
      outcome: "paused_budget",
    });
    const workflow = run("failed", "run_workflow", {
      outcome: "paused_budget",
      source: "workflow",
    });

    expect(
      latestManuallyResumableRun("idle", [ordinary, workflow]),
    ).toBeUndefined();
  });
});

function run(
  status: RunRecord["status"],
  id: string,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    threadId: "thread_manual_recovery",
    agentId: "agent_manual_recovery",
    status,
    source: "user",
    startedAt: "2026-08-17T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    ...overrides,
  };
}
