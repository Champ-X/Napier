import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { toolDeadlineEventTraceSummary } from "../src/tool-deadline-event-view";

describe("Tool deadline event trace view", () => {
  it("projects deadline and cancellation metadata without tool output", () => {
    const deadline = event("tool.deadline.exceeded", {
      toolName: "apply_patch",
      reason: "deadline_exceeded",
      effect: "write",
      state: "started_unknown",
      timeoutMs: 120_000,
      graceMs: 5_000,
      callSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      output: "TOP_SECRET_LATE_OUTPUT",
    });
    const cancelled = event("tool.cancellation.settled", {
      toolName: "read_file",
      reason: "parent_cancelled",
      effect: "read",
      state: "completed",
      timeoutMs: 30_000,
      graceMs: 5_000,
      callSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
      diagnostic: "TOP_SECRET_CANCEL_REASON",
    });

    expect(toolDeadlineEventTraceSummary(deadline)).toBe(
      `tool / apply_patch / deadline.exceeded / reason deadline_exceeded / effect write / state started_unknown / timeout-ms 120000 / grace-ms 5000 / call ${"a".repeat(12)} / content ${"b".repeat(12)}`,
    );
    expect(toolDeadlineEventTraceSummary(cancelled)).toBe(
      `tool / read_file / cancellation.settled / reason parent_cancelled / effect read / state completed / timeout-ms 30000 / grace-ms 5000 / call ${"c".repeat(12)} / content ${"d".repeat(12)}`,
    );
    expect(toolDeadlineEventTraceSummary(deadline)).not.toContain("TOP_SECRET");
    expect(toolDeadlineEventTraceSummary(cancelled)).not.toContain(
      "TOP_SECRET",
    );
  });

  it("fails closed for malformed deadline evidence", () => {
    expect(
      toolDeadlineEventTraceSummary(
        event("tool.deadline.exceeded", {
          toolName: "apply_patch",
          output: "TOP_SECRET",
        }),
      ),
    ).toBe("tool receipt");
    expect(
      toolDeadlineEventTraceSummary(event("tool.completed", { status: "ok" })),
    ).toBeUndefined();
  });
});

function event(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_tool",
    runId: "run_tool",
    seq: 55,
    type,
    category: "tool",
    visibility: "user",
    payload,
    createdAt: "2026-08-16T00:00:00.000Z",
  };
}
