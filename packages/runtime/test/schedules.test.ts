import { describe, expect, it } from "vitest";

import {
  createAutomationSchedule,
  nextScheduleOccurrence,
  updateAutomationSchedule,
} from "../src/schedules.js";

describe("automation schedules", () => {
  it("calculates anchored interval occurrences without drift", () => {
    const next = nextScheduleOccurrence(
      {
        type: "interval",
        everyMs: 5 * 60_000,
        anchorAt: "2026-07-25T00:00:00.000Z",
      },
      new Date("2026-07-25T00:12:30.000Z"),
    );
    expect(next.toISOString()).toBe("2026-07-25T00:15:00.000Z");
  });

  it("supports bounded five-field UTC cron expressions", () => {
    expect(
      nextScheduleOccurrence(
        {
          type: "cron",
          expression: "*/15 9-10 * * 1-5",
          timezone: "UTC",
        },
        new Date("2026-07-24T10:58:00.000Z"),
      ).toISOString(),
    ).toBe("2026-07-27T09:00:00.000Z");
    expect(() =>
      nextScheduleOccurrence(
        {
          type: "cron",
          expression: "61 * * * *",
          timezone: "UTC",
        },
        new Date(),
      ),
    ).toThrow("outside 0-59");
  });

  it("recalculates nextRunAt when a paused schedule resumes", () => {
    const created = createAutomationSchedule(
      {
        name: "Daily ledger review",
        threadId: "thread_schedule_test",
        prompt: "Review the durable ledger.",
        trigger: {
          type: "interval",
          everyMs: 60_000,
        },
        status: "paused",
      },
      new Date("2026-07-25T01:00:00.000Z"),
    );
    const updated = updateAutomationSchedule(
      created,
      { status: "active" },
      new Date("2026-07-25T02:00:00.000Z"),
    );
    expect(updated).toEqual(
      expect.objectContaining({
        status: "active",
        nextRunAt: "2026-07-25T02:01:00.000Z",
        revision: 2,
      }),
    );
    expect(updateAutomationSchedule(updated, {})).toEqual(updated);
  });
});
