import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  scheduleEventTraceSummary,
  scheduleEventTraceView,
} from "../src/schedule-event-view";

describe("Schedule event trace view", () => {
  it("projects schedule creation metadata without schedule names or prompts", () => {
    const event = scheduleEvent("schedule.created", {
      scheduleId: "schedule_1234567890",
      name: "TOP_SECRET_SCHEDULE_NAME",
      scheduleName: "TOP_SECRET_SCHEDULE_NAME",
      prompt: "TOP_SECRET_SCHEDULE_PROMPT",
      status: "active",
      triggerType: "interval",
      nextRunAt: "2026-07-28T12:00:00.000Z",
      revision: 1,
    });

    expect(scheduleEventTraceView(event)).toEqual({
      action: "created",
      scheduleId: "schedule_1234567890",
      status: "active",
      triggerType: "interval",
      nextRunAt: "2026-07-28T12:00:00.000Z",
      revision: 1,
    });
    expect(scheduleEventTraceSummary(event)).toBe(
      "schedule / created / schedule 1234567890 / status active / trigger interval / next 2026-07-28T12:00:00.000Z / revision 1",
    );
    expect(scheduleEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects runtime schedule outcomes without worker IDs or error prose", () => {
    const failed = scheduleEvent("schedule.failed", {
      scheduleId: "schedule_1234567890",
      scheduleName: "TOP_SECRET_SCHEDULE_NAME",
      scheduledFor: "2026-07-28T12:00:00.000Z",
      triggerId: "schedule:schedule_1234567890:2026-07-28T12:00:00.000Z",
      runId: "run_1234567890",
      error: "TOP_SECRET_SCHEDULE_ERROR",
    });
    const claimed = scheduleEvent("schedule.claimed", {
      scheduleId: "schedule_1234567890",
      scheduledFor: "2026-07-28T12:00:00.000Z",
      triggerId: "schedule:schedule_1234567890:2026-07-28T12:00:00.000Z",
      workerId: "TOP_SECRET_WORKER_ID",
    });

    expect(scheduleEventTraceSummary(failed)).toBe(
      "schedule / failed / schedule 1234567890 / trigger 00:00.000Z / run 1234567890 / scheduled-for 2026-07-28T12:00:00.000Z",
    );
    expect(scheduleEventTraceSummary(claimed)).toBe(
      "schedule / claimed / schedule 1234567890 / trigger 00:00.000Z / scheduled-for 2026-07-28T12:00:00.000Z",
    );
    expect(scheduleEventTraceSummary(failed)).not.toContain("TOP_SECRET");
    expect(scheduleEventTraceSummary(claimed)).not.toContain("TOP_SECRET");
  });

  it("projects updates and skipped occurrences as bounded metadata", () => {
    const updated = scheduleEvent("schedule.updated", {
      scheduleId: "schedule_1234567890",
      status: "paused",
      nextRunAt: "2026-07-29T12:00:00.000Z",
      revision: 4,
      changedFields: ["name", "prompt", "trigger"],
    });
    const skipped = scheduleEvent("schedule.skipped", {
      scheduleId: "schedule_1234567890",
      scheduledFor: "2026-07-28T12:00:00.000Z",
      reason: "overlap_active_run",
      message: "TOP_SECRET_SKIP_MESSAGE",
    });

    expect(scheduleEventTraceSummary(updated)).toBe(
      "schedule / updated / schedule 1234567890 / status paused / next 2026-07-29T12:00:00.000Z / revision 4 / changed-fields 3",
    );
    expect(scheduleEventTraceSummary(skipped)).toBe(
      "schedule / skipped / schedule 1234567890 / reason overlap_active_run / scheduled-for 2026-07-28T12:00:00.000Z",
    );
    expect(scheduleEventTraceSummary(updated)).not.toContain("prompt");
    expect(scheduleEventTraceSummary(skipped)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown schedule receipts", () => {
    expect(
      scheduleEventTraceSummary(scheduleEvent("schedule.failed", [])),
    ).toBe("schedule receipt");
    expect(
      scheduleEventTraceSummary(
        scheduleEvent("schedule.future", {
          error: "TOP_SECRET_FUTURE_ERROR",
        }),
      ),
    ).toBe("automation");
  });
});

function scheduleEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_schedule",
    runId: "run_schedule",
    seq: 44,
    type,
    category: "automation",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
