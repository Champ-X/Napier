import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { collectToolTraces } from "../src/opentelemetry-tool-traces.js";

describe("OpenTelemetry tool trace projection", () => {
  it("ignores tool-domain facts that do not identify an invocation", () => {
    const events = [
      event("tool.operation.effect_indeterminate", {
        operationId: "operation_abandoned",
      }),
      event("tool.effect.journaled", { effectSha256: "a".repeat(64) }),
      event("tool.started", {
        callId: "call_read",
        toolName: "read_file",
      }),
    ];

    expect(collectToolTraces(events)).toMatchObject([
      {
        callId: "call_read",
        toolName: "read_file",
        started: { type: "tool.started" },
      },
    ]);
  });
});

function event(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type}`,
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type,
    category: "tool",
    visibility: "debug",
    payload,
    createdAt: "2026-09-03T00:00:00.000Z",
  };
}
