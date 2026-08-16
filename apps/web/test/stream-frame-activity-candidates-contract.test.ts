import { describe, expect, it } from "vitest";

import { streamFrameContractReason } from "../src/stream-frame-contract";

describe("Stream frame activity candidate contract", () => {
  it("rejects projected candidates containing raw payload fields", () => {
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
            activityCandidates: [
              {
                id: "event_activity",
                seq: 1,
                type: "run.no_progress",
                label: "Run",
                summary: "Run no progress",
                tone: "info",
                createdAt: "2026-08-16T00:00:01.000Z",
                payload: { private: "PRIVATE_EVENT" },
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
