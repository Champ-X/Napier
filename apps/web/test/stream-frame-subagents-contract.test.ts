import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame subagent contract", () => {
  it("rejects projected cards containing private task fields", () => {
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
            subagentCards: [
              {
                id: "event_subagent",
                seq: 1,
                createdAt: "2026-08-16T00:00:01.000Z",
                task: {
                  id: "task_fixture0001",
                  role: "reviewer",
                  description: "Review evidence",
                  prompt: "PRIVATE_PROMPT",
                  status: "running",
                  model: { provider: "napier", id: "demo" },
                  stepCount: 1,
                  turnCount: 1,
                  usage: { inputTokens: 10, outputTokens: 5 },
                },
                itemCount: 0,
                evidenceCount: 0,
                unknownCount: 0,
                blockerCount: 0,
                warningCount: 0,
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
