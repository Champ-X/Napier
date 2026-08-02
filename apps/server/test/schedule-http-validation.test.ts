import { describe, expect, it } from "vitest";

import {
  parseCreateAutomationScheduleRequest,
  parseUpdateAutomationScheduleRequest,
} from "../src/schedule-http-validation.js";

describe("Schedule HTTP validation", () => {
  it("normalizes an interval schedule and rejects unknown fields", () => {
    expect(
      parseCreateAutomationScheduleRequest({
        name: "  Evidence   review ",
        threadId: "thread_0123456789abcdef",
        prompt: "  Review durable evidence.  ",
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
        trigger: {
          type: "interval",
          everyMs: 60_000,
          anchorAt: "2026-08-03T00:00:00.000Z",
        },
        misfirePolicy: "run_once",
      }),
    ).toEqual({
      name: "Evidence review",
      threadId: "thread_0123456789abcdef",
      prompt: "Review durable evidence.",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      trigger: {
        type: "interval",
        everyMs: 60_000,
        anchorAt: "2026-08-03T00:00:00.000Z",
      },
      misfirePolicy: "run_once",
    });
    expect(
      parseCreateAutomationScheduleRequest({
        name: "Evidence review",
        threadId: "thread_0123456789abcdef",
        prompt: "Review durable evidence.",
        trigger: { type: "interval", everyMs: 60_000 },
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it("bounds interval and UTC cron trigger forms", () => {
    expect(
      parseCreateAutomationScheduleRequest({
        name: "Too frequent",
        threadId: "thread_0123456789abcdef",
        prompt: "Review durable evidence.",
        trigger: { type: "interval", everyMs: 59_999 },
      }),
    ).toBeUndefined();
    expect(
      parseUpdateAutomationScheduleRequest({
        trigger: {
          type: "cron",
          expression: " 0   9   *   *   1-5 ",
          timezone: "UTC",
        },
      }),
    ).toEqual({
      trigger: {
        type: "cron",
        expression: "0 9 * * 1-5",
        timezone: "UTC",
      },
    });
    expect(
      parseUpdateAutomationScheduleRequest({
        trigger: {
          type: "cron",
          expression: "0 9 * * 1-5",
          timezone: "Europe/Paris",
        },
      }),
    ).toBeUndefined();
  });

  it("accepts only bounded update fields and known statuses", () => {
    expect(
      parseUpdateAutomationScheduleRequest({
        name: " Paused review ",
        status: "paused",
        misfirePolicy: "skip",
      }),
    ).toEqual({
      name: "Paused review",
      status: "paused",
      misfirePolicy: "skip",
    });
    expect(
      parseUpdateAutomationScheduleRequest({
        model: { provider: "x", id: "model" },
      }),
    ).toBeUndefined();
    expect(
      parseUpdateAutomationScheduleRequest({ status: "deleted" }),
    ).toBeUndefined();
  });
});
