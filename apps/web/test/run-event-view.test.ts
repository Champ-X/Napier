import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { runEventTraceSummary, runEventTraceView } from "../src/run-event-view";

describe("Run event trace view", () => {
  it("projects run start metadata without raw limit bodies", () => {
    const event = runEvent("run.started", {
      agentId: "agent_1234567890",
      model: "openai/gpt-4.1",
      source: "user",
      agentRevision: 7,
      triggerId: "schedule_abcdef1234",
      parentRunId: "run_parent_1234567890",
      configurationSha256: "a".repeat(64),
      limits: {
        maxTurns: 4,
        maxTotalTokens: 5000,
        maxCostUsd: 0.25,
        timeoutMs: 60000,
      },
    });

    expect(runEventTraceView(event)).toEqual({
      action: "started",
      source: "user",
      model: "openai/gpt-4.1",
      agentId: "agent_1234567890",
      triggerId: "schedule_abcdef1234",
      parentRunId: "run_parent_1234567890",
      agentRevision: 7,
      maxTurns: 4,
      maxTotalTokens: 5000,
      maxCostUsd: 0.25,
      timeoutMs: 60000,
      configurationSha256: "a".repeat(64),
    });
    expect(runEventTraceSummary(event)).toBe(
      `run / started / source user / model openai/gpt-4.1 / agent 1234567890 / trigger abcdef1234 / parent-run 1234567890 / agent-revision 7 / max-turns 4 / max-tokens 5000 / max-cost 0.250000 / timeout-ms 60000 / config ${"a".repeat(12)}`,
    );
  });

  it("projects failures without message text", () => {
    const failed = runEvent("run.failed", {
      status: "failed",
      message: "TOP_SECRET_FAILURE_MESSAGE",
    });
    const recoveryFailed = runEvent("run.recovery.failed", {
      parentRunId: "run_parent_1234567890",
      status: "failed",
      message: "TOP_SECRET_RECOVERY_FAILURE",
      mode: "safe_read_only",
      attemptId: "attempt_1234567890",
    });

    expect(runEventTraceSummary(failed)).toBe("run / failed / status failed");
    expect(runEventTraceSummary(recoveryFailed)).toBe(
      "run / recovery.failed / status failed / mode safe_read_only / parent-run 1234567890 / attempt-id 1234567890",
    );
    expect(runEventTraceSummary(failed)).not.toContain("TOP_SECRET");
    expect(runEventTraceSummary(recoveryFailed)).not.toContain("TOP_SECRET");
  });

  it("projects recovery prompts and interruptions without prose", () => {
    const prompt = runEvent("run.recovery.prompt", {
      role: "user",
      text: "TOP_SECRET_RECOVERY_PROMPT",
    });
    const interrupted = runEvent("run.interrupted", {
      status: "interrupted",
      reason: "TOP_SECRET_INTERRUPTION_REASON",
      interruptedAt: "2026-07-28T12:00:00.000Z",
    });

    expect(runEventTraceSummary(prompt)).toBe(
      "run / recovery.prompt / role user",
    );
    expect(runEventTraceSummary(interrupted)).toBe(
      "run / interrupted / status interrupted / interrupted-at 2026-07-28T12:00:00.000Z",
    );
    expect(runEventTraceSummary(prompt)).not.toContain("TOP_SECRET");
    expect(runEventTraceSummary(interrupted)).not.toContain("TOP_SECRET");
  });

  it("projects budget and automatic recovery receipts without diagnostics", () => {
    const budget = runEvent("run.budget.exhausted", {
      status: "exhausted",
      reason: "turns",
      limit: 1,
      observed: {
        turns: 1,
        totalTokens: 128,
        costUsd: 0.015,
        elapsedMs: 2500,
      },
      message: "TOP_SECRET_BUDGET_MESSAGE",
    });
    const autoFailed = runEvent("run.recovery.auto.failed", {
      attemptId: "attempt_1234567890",
      sourceRunId: "run_source_1234567890",
      rootRunId: "run_root_1234567890",
      attempt: 2,
      maxAttempts: 3,
      assessmentSha256: "b".repeat(64),
      status: "failed",
      recoveryRunId: "run_recovery_1234567890",
      error: "TOP_SECRET_AUTO_RECOVERY_ERROR",
    });
    const autoSkipped = runEvent("run.recovery.auto.skipped", {
      sourceRunId: "run_source_1234567890",
      rootRunId: "run_root_1234567890",
      assessmentSha256: "c".repeat(64),
      blockReasons: ["TOP_SECRET_BLOCK_REASON"],
      priorAttempts: 2,
      toolCalls: [{ name: "read_file" }],
      eventStreamSha256: "d".repeat(64),
    });

    expect(runEventTraceSummary(budget)).toBe(
      "run / budget.exhausted / status exhausted / reason turns / limit 1 / observed-turns 1 / observed-tokens 128 / observed-cost 0.015000 / observed-ms 2500",
    );
    expect(runEventTraceSummary(autoFailed)).toBe(
      `run / recovery.auto.failed / status failed / attempt-id 1234567890 / recovery-run 1234567890 / source-run 1234567890 / root-run 1234567890 / attempt 2/3 / assessment ${"b".repeat(12)}`,
    );
    expect(runEventTraceSummary(autoSkipped)).toBe(
      `run / recovery.auto.skipped / source-run 1234567890 / root-run 1234567890 / prior-attempts 2 / block-reasons 1 / tool-calls 1 / assessment ${"c".repeat(12)} / event-stream ${"d".repeat(12)}`,
    );
    expect(runEventTraceSummary(budget)).not.toContain("TOP_SECRET");
    expect(runEventTraceSummary(autoFailed)).not.toContain("TOP_SECRET");
    expect(runEventTraceSummary(autoSkipped)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown run receipts", () => {
    expect(runEventTraceSummary(runEvent("run.failed", ["TOP_SECRET"]))).toBe(
      "run receipt",
    );
    expect(
      runEventTraceSummary(
        runEvent("run.future", { message: "TOP_SECRET_FUTURE_MESSAGE" }),
      ),
    ).toBe("lifecycle");
  });
});

function runEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_run",
    runId: "run_1234567890",
    seq: 43,
    type,
    category: "lifecycle",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
