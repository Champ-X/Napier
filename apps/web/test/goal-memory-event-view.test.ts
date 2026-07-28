import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  goalEventTraceSummary,
  goalEventTraceView,
  memoryEventTraceSummary,
  memoryEventTraceView,
} from "../src/goal-memory-event-view";

describe("Goal and memory event trace views", () => {
  it("projects goal receipts without objective, reason, or evidence text", () => {
    const event = traceEvent("goal.evaluated", "goal", {
      status: "active",
      blocker: "missing_evidence",
      reason: "TOP_SECRET_REASON",
      evidence: "TOP_SECRET_EVIDENCE",
      objective: "TOP_SECRET_OBJECTIVE",
      satisfied: false,
      continuationCount: 2,
      maxContinuations: 5,
      noProgressCount: 1,
    });

    expect(goalEventTraceView(event)).toEqual({
      action: "evaluated",
      status: "active",
      blocker: "missing_evidence",
      satisfied: false,
      continuation: 2,
      maxContinuations: 5,
      noProgressCount: 1,
    });
    expect(goalEventTraceSummary(event)).toBe(
      "goal / evaluated / status active / blocker missing_evidence / satisfied false / continuation 2/5 / no-progress 1",
    );
    expect(goalEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects goal setup and continuation events without raw objectives", () => {
    expect(
      goalEventTraceSummary(
        traceEvent("goal.set", "goal", {
          objective: "TOP_SECRET_OBJECTIVE",
          maxContinuations: 3,
        }),
      ),
    ).toBe("goal / set / max-continuations 3");
    expect(
      goalEventTraceSummary(
        traceEvent("goal.continuation.started", "goal", {
          objective: "TOP_SECRET_OBJECTIVE",
          continuation: 1,
          maxContinuations: 3,
        }),
      ),
    ).toBe("goal / continuation.started / continuation 1/3");
  });

  it("projects memory receipts without memory content or error messages", () => {
    const proposed = traceEvent("memory.proposed", "memory", {
      memoryId: "memory_abcdef123456",
      content: "TOP_SECRET_MEMORY",
      status: "proposed",
      category: "preference",
      scope: "agent",
      confidence: 0.8,
      reviewIntervalDays: 90,
    });
    const failed = traceEvent("memory.extraction.failed", "memory", {
      message: "TOP_SECRET_EXTRACTION_ERROR",
      reason: "model_error",
    });

    expect(memoryEventTraceView(proposed)).toEqual({
      action: "proposed",
      memoryId: "memory_abcdef123456",
      status: "proposed",
      category: "preference",
      scope: "agent",
      confidence: 0.8,
      reviewIntervalDays: 90,
    });
    expect(memoryEventTraceSummary(proposed)).toBe(
      "memory / proposed / id cdef123456 / status proposed / category preference / scope agent / confidence 0.8 / review 90d",
    );
    expect(memoryEventTraceSummary(failed)).toBe(
      "memory / extraction.failed / reason model_error",
    );
    expect(memoryEventTraceSummary(proposed)).not.toContain("TOP_SECRET");
    expect(memoryEventTraceSummary(failed)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed goal and memory receipts", () => {
    expect(
      goalEventTraceSummary(
        traceEvent("goal.evaluated", "goal", "TOP_SECRET_GOAL"),
      ),
    ).toBe("goal receipt");
    expect(
      memoryEventTraceSummary(
        traceEvent("memory.proposed", "memory", ["TOP_SECRET_MEMORY"]),
      ),
    ).toBe("memory receipt");
  });
});

function traceEvent(
  type: string,
  category: RunEvent["category"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_trace",
    runId: "runctl_trace",
    seq: 11,
    type,
    category,
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
