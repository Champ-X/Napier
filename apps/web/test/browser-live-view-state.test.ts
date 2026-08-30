import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { browserLiveViewExpected } from "../src/browser-live-view-state";

describe("Browser Live view state", () => {
  it("opens after a successful Browser start, survives an action failure, and closes after close", () => {
    expect(
      browserLiveViewExpected(
        [event(1, "start", "run_live"), event(2, "click", "run_other")],
        "run_live",
      ),
    ).toBe(true);
    expect(
      browserLiveViewExpected(
        [event(1, "start", "run_live"), event(2, "close", "run_live")],
        "run_live",
      ),
    ).toBe(false);
    expect(
      browserLiveViewExpected(
        [
          event(1, "start", "run_live"),
          event(
            2,
            "navigate",
            "run_live",
            "tool.failed",
            "Cross-origin navigation requires allowCrossOrigin",
          ),
        ],
        "run_live",
      ),
    ).toBe(true);
    expect(browserLiveViewExpected([], "run_live")).toBe(false);
  });
});

function event(
  seq: number,
  action: string,
  runId: string,
  type: "tool.completed" | "tool.failed" = "tool.completed",
  displayError?: string,
): RunEvent {
  return {
    id: `event_live_${String(seq)}`,
    threadId: "thread_live",
    runId,
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-04T00:00:00.000Z",
    payload: {
      toolName: "browser",
      ...(displayError ? { displayError } : {}),
      ...(type === "tool.completed" ? { details: { action } } : {}),
    },
  };
}
