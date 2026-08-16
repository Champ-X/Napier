import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  applyConversationRecoveryEvent,
  createConversationRecoveryEventState,
  projectConversationRecoveries,
} from "../src/conversation-recoveries-projection.js";

describe("Conversation Recoveries projection", () => {
  it("joins authoritative state to bounded hash-only lifecycle evidence", () => {
    const assessment = recoveryAssessment();
    const attempt = recoveryAttempt("failed");
    const events = [
      event(1, "run.interrupted", {}, assessment.runId),
      event(2, "run.recovery.auto.started", {
        attemptId: attempt.id,
        privateError: "PRIVATE_START",
      }),
      event(
        3,
        "run.recovery.started",
        { attemptId: attempt.id, message: "PRIVATE_PROMPT" },
        attempt.recoveryRunId,
      ),
      event(
        4,
        "run.budget.exhausted",
        {
          reason: "timeout",
          limit: 30_000,
          observed: {
            turns: 2,
            totalTokens: 4_096,
            costUsd: 0.25,
            elapsedMs: 30_001,
          },
          message: "PRIVATE_BUDGET",
        },
        attempt.recoveryRunId,
      ),
      event(
        5,
        "run.failed",
        { message: "PRIVATE_FAILURE" },
        attempt.recoveryRunId,
      ),
      event(6, "run.recovery.auto.failed", {
        attemptId: attempt.id,
        privateError: "PRIVATE_AUTO_FAILURE",
      }),
    ];
    const state = events.reduce(
      applyConversationRecoveryEvent,
      createConversationRecoveryEventState(),
    );
    const view = projectConversationRecoveries([assessment], [attempt], state);

    expect(view).toEqual([
      expect.objectContaining({
        id: assessment.runId,
        seq: 6,
        status: "failed",
        settlement: {
          budgetReason: "timeout",
          limit: 30_000,
          observedTurns: 2,
          observedTotalTokens: 4_096,
          observedCostUsd: 0.25,
          observedElapsedMs: 30_001,
        },
        eventIds: [
          "event_1",
          "event_2",
          "event_3",
          "event_4",
          "event_5",
          "event_6",
        ],
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_");
  });

  it("projects blocked assessments without inventing attempts", () => {
    const assessment = recoveryAssessment({
      eligible: false,
      blockReasons: ["unsafe_tool_effect"],
      toolCalls: {
        total: 1,
        readOnly: 0,
        unsafe: 1,
        unknownEffect: 0,
        unresolved: 0,
      },
    });
    const state = applyConversationRecoveryEvent(
      createConversationRecoveryEventState(),
      event(1, "run.recovery.auto.skipped", {
        assessmentSha256: assessment.contentSha256,
        blockReasons: ["PRIVATE_REASON"],
      }),
    );

    const recovery = projectConversationRecoveries([assessment], [], state)[0]!;
    expect(recovery).toEqual(
      expect.objectContaining({
        status: "skipped",
        assessment: expect.objectContaining({
          blockReasons: ["unsafe_tool_effect"],
        }),
      }),
    );
    expect(recovery.attempt).toBeUndefined();
  });
});

function recoveryAssessment(
  overrides: Partial<AutomaticRecoveryAssessment> = {},
): AutomaticRecoveryAssessment {
  return {
    schemaVersion: 1,
    threadId: "thread_recovery",
    runId: "run_interrupted0001",
    rootRunId: "run_interrupted0001",
    agentId: "agent_recovery",
    policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 },
    eligible: true,
    blockReasons: [],
    toolCalls: {
      total: 1,
      readOnly: 1,
      unsafe: 0,
      unknownEffect: 0,
      unresolved: 0,
    },
    unsafeToolNames: [],
    unknownEffectToolNames: [],
    unresolvedToolNames: [],
    eventRange: {
      fromSeq: 1,
      toSeq: 1,
      eventCount: 1,
      eventStreamSha256: "a".repeat(64),
    },
    priorAttempts: 0,
    eligibleAt: "2026-08-16T00:00:01.000Z",
    assessedAt: "2026-08-16T00:00:02.000Z",
    contentSha256: "b".repeat(64),
    ...overrides,
  };
}

function recoveryAttempt(
  status: AutomaticRecoveryAttempt["status"],
): AutomaticRecoveryAttempt {
  return {
    id: "recovery_fixture0001",
    threadId: "thread_recovery",
    agentId: "agent_recovery",
    rootRunId: "run_interrupted0001",
    interruptedRunId: "run_interrupted0001",
    attempt: 1,
    maxAttempts: 2,
    triggerId: "automatic-recovery:run_interrupted0001:1",
    assessmentSha256: "b".repeat(64),
    status,
    recoveryRunId: "run_recovery0001",
    createdAt: "2026-08-16T00:00:02.000Z",
    updatedAt: "2026-08-16T00:00:05.000Z",
    startedAt: "2026-08-16T00:00:03.000Z",
    finishedAt: "2026-08-16T00:00:05.000Z",
    revision: 3,
    contentSha256: "c".repeat(64),
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  runId = "runctl_recovery",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_recovery",
    runId,
    seq,
    type,
    category: "automation",
    visibility: "user",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
