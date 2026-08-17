import type { RunRecord } from "../src/index.js";
import {
  isManuallyResumableRun,
  manualRunRecoveryBlockReason,
  manualRunRecoverySettlementMatches,
} from "../src/manual-run-recovery.js";
import { describe, expect, it } from "vitest";

describe("manual Run recovery", () => {
  it("accepts interrupted and paused-budget settlements only in their matching Thread states", () => {
    const interrupted = run("interrupted");
    const pausedBudget = run("failed", { outcome: "paused_budget" });

    expect(manualRunRecoverySettlementMatches("waiting", interrupted)).toBe(
      true,
    );
    expect(manualRunRecoverySettlementMatches("idle", pausedBudget)).toBe(
      true,
    );
    expect(manualRunRecoverySettlementMatches("idle", interrupted)).toBe(
      false,
    );
    expect(manualRunRecoverySettlementMatches("waiting", pausedBudget)).toBe(
      false,
    );
    expect(
      manualRunRecoverySettlementMatches(
        "idle",
        run("failed", { outcome: "partial" }),
      ),
    ).toBe(false);
  });

  it("keeps Workflow and experiment settlements out of manual recovery", () => {
    const pausedBudget = run("failed", { outcome: "paused_budget" });
    const workflow = { ...pausedBudget, source: "workflow" as const };
    const modelExperiment = {
      ...pausedBudget,
      source: "model_experiment" as const,
    };

    expect(manualRunRecoveryBlockReason(workflow)).toBe("workflow_managed");
    expect(manualRunRecoveryBlockReason(modelExperiment)).toBe(
      "model_experiment",
    );
    expect(isManuallyResumableRun("idle", pausedBudget)).toBe(true);
    expect(isManuallyResumableRun("idle", workflow)).toBe(false);
    expect(isManuallyResumableRun("idle", modelExperiment)).toBe(false);
  });
});

function run(
  status: RunRecord["status"],
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id: "run_manual_recovery",
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
