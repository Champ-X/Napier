import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { conversationRecoveries } from "../src/conversation-recovery-view-model";

describe("Conversation recoveries", () => {
  it("joins the latest event position to authoritative recovery state", () => {
    const assessment = recoveryAssessment(true);
    const attempt = recoveryAttempt("completed");
    const recoveries = conversationRecoveries(
      [
        event(2, "run.recovery.auto.claimed", {
          attemptId: attempt.id,
          assessmentSha256: assessment.contentSha256,
          error: "PRIVATE_EVENT_ERROR",
        }),
        event(3, "run.recovery.started", {
          attemptId: attempt.id,
          parentRunId: assessment.runId,
          message: "PRIVATE_RECOVERY_PROMPT",
        }),
        event(4, "run.recovery.auto.completed", {
          attemptId: attempt.id,
          assessmentSha256: assessment.contentSha256,
          status: "completed",
          error: "PRIVATE_COMPLETION_ERROR",
        }),
      ],
      [assessment],
      [attempt],
    );

    expect(recoveries).toEqual([
      expect.objectContaining({
        id: assessment.runId,
        seq: 4,
        createdAt: timestamp(4),
        status: "completed",
        assessment: expect.objectContaining({
          interruptedRunId: assessment.runId,
          eligible: true,
          priorAttempts: 0,
          blockReasons: [],
        }),
        attempt: expect.objectContaining({
          id: attempt.id,
          status: "completed",
          attempt: 1,
          maxAttempts: 2,
          recoveryRunId: "run_recovery0001",
        }),
        eventIds: ["event_2", "event_3", "event_4"],
      }),
    ]);
    expect(JSON.stringify(recoveries)).not.toContain("PRIVATE_");
  });

  it("projects blocked assessments without inventing an attempt", () => {
    const assessment = recoveryAssessment(false, [
      "unsafe_tool_effect",
      "unresolved_tool_call",
    ]);
    const recovery = conversationRecoveries(
      [
        event(7, "run.recovery.auto.skipped", {
          sourceRunId: assessment.runId,
          assessmentSha256: assessment.contentSha256,
          blockReasons: ["PRIVATE_BLOCK_REASON"],
          toolCalls: [{ name: "PRIVATE_TOOL_NAME" }],
        }),
      ],
      [assessment],
      [],
    )[0]!;

    expect(recovery.status).toBe("skipped");
    expect(recovery.attempt).toBeUndefined();
    expect(recovery.assessment.blockReasons).toEqual([
      "unsafe_tool_effect",
      "unresolved_tool_call",
    ]);
    expect(recovery.assessment.toolCalls).toEqual({
      total: 2,
      readOnly: 0,
      unsafe: 1,
      unknownEffect: 0,
      unresolved: 1,
    });
    expect(JSON.stringify(recovery)).not.toContain("PRIVATE_");
  });

  it("projects a safe budget settlement and owns the recovery lifecycle", () => {
    const assessment = recoveryAssessment(true);
    const attempt = recoveryAttempt("failed", {
      error: "PRIVATE_ATTEMPT_ERROR",
      recoveryRunId: "run_recovery0001",
    });
    const recovery = conversationRecoveries(
      [
        event(
          1,
          "run.interrupted",
          {
            status: "interrupted",
            reason: "PRIVATE_INTERRUPTION_REASON",
          },
          "user",
          assessment.runId,
        ),
        event(2, "run.recovery.auto.started", {
          attemptId: attempt.id,
          assessmentSha256: assessment.contentSha256,
        }),
        event(
          3,
          "run.budget.exhausted",
          {
            status: "exhausted",
            reason: "timeout",
            limit: 300_000,
            observed: {
              turns: 2,
              totalTokens: 4_096,
              costUsd: 0.25,
              elapsedMs: 300_001,
            },
            message: "PRIVATE_BUDGET_MESSAGE",
          },
          "user",
          "run_recovery0001",
        ),
        event(
          4,
          "run.failed",
          { status: "failed", message: "PRIVATE_RUN_ERROR" },
          "user",
          "run_recovery0001",
        ),
        event(5, "run.recovery.auto.failed", {
          attemptId: attempt.id,
          assessmentSha256: assessment.contentSha256,
          error: "PRIVATE_AUTO_ERROR",
        }),
      ],
      [assessment],
      [attempt],
    )[0]!;

    expect(recovery).toEqual(
      expect.objectContaining({
        status: "failed",
        seq: 5,
        settlement: {
          budgetReason: "timeout",
          limit: 300_000,
          observedTurns: 2,
          observedTotalTokens: 4_096,
          observedCostUsd: 0.25,
          observedElapsedMs: 300_001,
        },
        eventIds: ["event_1", "event_2", "event_3", "event_4", "event_5"],
      }),
    );
    expect(JSON.stringify(recovery)).not.toContain("PRIVATE_");
  });

  it("keeps retries as one card per interrupted Run", () => {
    const first = recoveryAssessment(true);
    const second = recoveryAssessment(true, [], {
      runId: "run_recovery0001",
      rootRunId: first.runId,
      priorAttempts: 1,
      contentSha256: "c".repeat(64),
    });
    const firstAttempt = recoveryAttempt("interrupted");
    const secondAttempt = recoveryAttempt("running", {
      id: "recovery_fixture0002",
      interruptedRunId: second.runId,
      rootRunId: first.runId,
      assessmentSha256: second.contentSha256,
      attempt: 2,
      recoveryRunId: "run_recovery0002",
    });
    const recoveries = conversationRecoveries(
      [
        event(4, "run.recovery.auto.interrupted", {
          attemptId: firstAttempt.id,
          assessmentSha256: first.contentSha256,
        }),
        event(8, "run.recovery.auto.started", {
          attemptId: secondAttempt.id,
          assessmentSha256: second.contentSha256,
        }),
      ],
      [first, second],
      [firstAttempt, secondAttempt],
    );

    expect(recoveries.map((recovery) => recovery.id)).toEqual([
      "run_interrupted0001",
      "run_recovery0001",
    ]);
    expect(recoveries.map((recovery) => recovery.status)).toEqual([
      "interrupted",
      "running",
    ]);
  });

  it("filters hidden, malformed, future, and unbound recovery events", () => {
    const assessment = recoveryAssessment(true);
    const attempt = recoveryAttempt("running");
    const events = [
      event(
        1,
        "run.recovery.auto.started",
        {
          attemptId: attempt.id,
          assessmentSha256: assessment.contentSha256,
        },
        "hidden",
      ),
      event(2, "run.recovery.auto.future", {
        attemptId: attempt.id,
        assessmentSha256: assessment.contentSha256,
      }),
      event(3, "run.recovery.auto.started", ["PRIVATE_PAYLOAD"]),
      event(4, "run.recovery.auto.started", {
        attemptId: "recovery_missing0001",
        assessmentSha256: "d".repeat(64),
      }),
    ];

    expect(
      conversationRecoveries(events, [assessment], [attempt]),
    ).toHaveLength(0);
  });
});

function recoveryAssessment(
  eligible: boolean,
  blockReasons: AutomaticRecoveryAssessment["blockReasons"] = [],
  overrides: Partial<AutomaticRecoveryAssessment> = {},
): AutomaticRecoveryAssessment {
  return {
    schemaVersion: 1,
    threadId: "thread_1",
    runId: "run_interrupted0001",
    rootRunId: "run_interrupted0001",
    agentId: "agent_1",
    policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 },
    eligible,
    blockReasons,
    toolCalls: {
      total: eligible ? 1 : 2,
      readOnly: eligible ? 1 : 0,
      unsafe: eligible ? 0 : 1,
      unknownEffect: 0,
      unresolved: eligible ? 0 : 1,
    },
    unsafeToolNames: eligible ? [] : ["PRIVATE_UNSAFE_TOOL"],
    unknownEffectToolNames: [],
    unresolvedToolNames: eligible ? [] : ["PRIVATE_UNRESOLVED_TOOL"],
    eventRange: {
      fromSeq: 1,
      toSeq: 6,
      eventCount: 6,
      eventStreamSha256: "a".repeat(64),
    },
    priorAttempts: 0,
    eligibleAt: timestamp(1),
    assessedAt: timestamp(2),
    contentSha256: "b".repeat(64),
    ...overrides,
  };
}

function recoveryAttempt(
  status: AutomaticRecoveryAttempt["status"],
  overrides: Partial<AutomaticRecoveryAttempt> = {},
): AutomaticRecoveryAttempt {
  return {
    id: "recovery_fixture0001",
    threadId: "thread_1",
    agentId: "agent_1",
    rootRunId: "run_interrupted0001",
    interruptedRunId: "run_interrupted0001",
    attempt: 1,
    maxAttempts: 2,
    triggerId: "automatic-recovery:run_interrupted0001:1",
    assessmentSha256: "b".repeat(64),
    status,
    ...(status === "running" ||
    status === "completed" ||
    status === "interrupted"
      ? { recoveryRunId: "run_recovery0001", startedAt: timestamp(3) }
      : {}),
    ...(!["claimed", "running"].includes(status)
      ? { finishedAt: timestamp(4) }
      : {}),
    createdAt: timestamp(2),
    updatedAt: timestamp(4),
    revision: 3,
    contentSha256: "e".repeat(64),
    ...overrides,
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  visibility: RunEvent["visibility"] = "user",
  runId = "runctl_fixture0001",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "automation",
    visibility,
    createdAt: timestamp(seq),
    payload,
  };
}

function timestamp(second: number): string {
  return `2026-08-08T00:00:0${String(second)}.000Z`;
}
