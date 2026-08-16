import { describe, expect, it } from "vitest";

import { isConversationRecoveries } from "../src/conversation-recoveries-protocol";

describe("Conversation Recoveries protocol", () => {
  it("accepts strict recovery cards and rejects inconsistent status state", () => {
    const recovery = {
      id: "run_interrupted0001",
      seq: 4,
      createdAt: "2026-08-16T00:00:04.000Z",
      status: "running",
      assessment: {
        contentSha256: "a".repeat(64),
        interruptedRunId: "run_interrupted0001",
        rootRunId: "run_interrupted0001",
        eligible: true,
        blockReasons: [],
        policy: {
          mode: "safe_read_only",
          maxAttempts: 2,
          backoffMs: 1_000,
        },
        toolCalls: {
          total: 1,
          readOnly: 1,
          unsafe: 0,
          unknownEffect: 0,
          unresolved: 0,
        },
        eventRange: {
          fromSeq: 1,
          toSeq: 3,
          eventCount: 3,
          eventStreamSha256: "b".repeat(64),
        },
        priorAttempts: 0,
        assessedAt: "2026-08-16T00:00:02.000Z",
      },
      attempt: {
        id: "recovery_fixture0001",
        status: "running",
        attempt: 1,
        maxAttempts: 2,
        recoveryRunId: "run_recovery0001",
        revision: 2,
      },
      eventIds: ["event_1", "event_2"],
    };

    expect(isConversationRecoveries([recovery])).toBe(true);
    expect(
      isConversationRecoveries([
        { ...recovery, attempt: { ...recovery.attempt, status: "failed" } },
      ]),
    ).toBe(false);
    expect(
      isConversationRecoveries([
        {
          ...recovery,
          assessment: {
            ...recovery.assessment,
            eligible: false,
            blockReasons: [],
          },
        },
      ]),
    ).toBe(false);
    expect(isConversationRecoveries(Array(9).fill(recovery))).toBe(false);
  });
});
