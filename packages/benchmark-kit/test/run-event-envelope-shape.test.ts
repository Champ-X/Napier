import { describe, expect, it } from "vitest";

import { hasExactRunEventEnvelope } from "../src/run-event-envelope-shape.js";

const EVENT = {
  id: "event_1",
  threadId: "thread_1",
  runId: "run_1",
  seq: 1,
  type: "benchmark.evaluated",
  category: "evaluation",
  visibility: "user",
  createdAt: "2026-08-26T00:00:00.000Z",
  payload: {},
};

describe("Run event envelope shape", () => {
  it("accepts legacy and registered v1 envelopes only", () => {
    expect(hasExactRunEventEnvelope(EVENT)).toBe(true);
    expect(hasExactRunEventEnvelope({ ...EVENT, schemaVersion: 1 })).toBe(true);
    expect(
      hasExactRunEventEnvelope({
        ...EVENT,
        schemaVersion: 1,
        idempotency: {
          namespace: "durable-tool-execution-terminal",
          key: "run_1:call_1:terminal",
        },
      }),
    ).toBe(true);
    expect(hasExactRunEventEnvelope({ ...EVENT, schemaVersion: 2 })).toBe(
      false,
    );
    expect(
      hasExactRunEventEnvelope({ ...EVENT, schemaVersion: 1, extra: true }),
    ).toBe(false);
    expect(
      hasExactRunEventEnvelope({
        ...EVENT,
        idempotency: { namespace: "INVALID", key: "call" },
      }),
    ).toBe(false);
  });
});
