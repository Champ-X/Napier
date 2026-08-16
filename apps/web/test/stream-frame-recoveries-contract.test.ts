import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame recovery contract", () => {
  it("rejects inconsistent projected recovery status before dispatch", () => {
    expect(
      streamFrameContractReason(
        {
          type: "event",
          eventSha256: "a".repeat(64),
          event: {
            id: "event_1",
            threadId: "thread_1",
            runId: "run_1",
            seq: 1,
            type: "model.text.delta",
            category: "model",
            visibility: "user",
            createdAt: "2026-08-16T00:00:01.000Z",
            payload: { delta: "hello" },
          },
          projections: {
            recoveries: [
              {
                id: "run_interrupted0001",
                seq: 1,
                createdAt: "2026-08-16T00:00:01.000Z",
                status: "completed",
                assessment: {
                  contentSha256: "1".repeat(64),
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
                    toSeq: 1,
                    eventCount: 1,
                    eventStreamSha256: "2".repeat(64),
                  },
                  priorAttempts: 0,
                  assessedAt: "2026-08-16T00:00:01.000Z",
                },
                attempt: {
                  id: "recovery_fixture0001",
                  status: "running",
                  attempt: 1,
                  maxAttempts: 2,
                  recoveryRunId: "run_recovery0001",
                  revision: 2,
                },
                eventIds: ["event_recovery"],
              },
            ],
          },
        },
        {
          snapshot: () => true,
          error: () => true,
          done: () => true,
        },
      ),
    ).toBe("invalid_event");
  });
});
