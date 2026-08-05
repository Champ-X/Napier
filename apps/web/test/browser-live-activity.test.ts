import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { browserLiveActivity } from "../src/browser-live-activity";

describe("Browser Live activity projection", () => {
  it("tracks one unmatched Browser tool call by call ID", () => {
    expect(
      browserLiveActivity(
        [
          toolEvent(1, "tool.started", "call_navigation", "navigate"),
          toolEvent(2, "tool.started", "call_other", "scroll", "run_other"),
        ],
        "run_live",
        { pauseStatus: "running", takeoverOpen: false },
      ),
    ).toEqual({ state: "active", label: "Agent · navigating" });

    expect(
      browserLiveActivity(
        [
          toolEvent(1, "tool.started", "call_navigation", "navigate"),
          toolEvent(2, "tool.completed", "call_navigation"),
        ],
        "run_live",
        { pauseStatus: "running", takeoverOpen: false },
      ),
    ).toEqual({ state: "idle", label: "Ready · waiting for Agent" });
  });

  it("describes pause queueing and paused operator waits", () => {
    const events = [
      toolEvent(1, "tool.started", "call_wait", "wait"),
      pauseEvent(2),
    ] satisfies RunEvent[];
    expect(
      browserLiveActivity(events, "run_live", {
        pauseStatus: "paused",
        takeoverOpen: false,
      }),
    ).toEqual({
      state: "active",
      label: "Agent · waiting for page · pause queued",
    });
    expect(
      browserLiveActivity(
        [
          pauseEvent(1),
          toolEvent(2, "tool.started", "call_snapshot", "snapshot"),
        ],
        "run_live",
        {
          pauseStatus: "paused",
          takeoverOpen: false,
        },
      ),
    ).toEqual({
      state: "paused",
      label: "Agent · reading page · waiting for resume",
    });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "paused",
        takeoverOpen: false,
      }),
    ).toEqual({
      state: "paused",
      label: "Waiting · operator paused automation",
    });
  });

  it("prioritizes real control, operator, and confirmation states", () => {
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "running",
        takeoverOpen: false,
        controlTransition: "pausing",
        confirmationAction: "download",
        operatorAction: "save_screenshot",
      }),
    ).toEqual({
      state: "control",
      label: "Control · pausing after current action",
    });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "paused",
        takeoverOpen: true,
        confirmationAction: "download",
        operatorAction: "save_screenshot",
      }),
    ).toEqual({
      state: "operator",
      label: "Operator · capturing screenshot",
    });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "running",
        takeoverOpen: false,
        confirmationAction: "download",
      }),
    ).toEqual({
      state: "confirmation",
      label: "Waiting · approve downloading file",
    });
  });

  it("ignores malformed, foreign, and non-Browser tool events", () => {
    expect(
      browserLiveActivity(
        [
          toolEvent(1, "tool.started", "call_bad", "PRIVATE_ACTION"),
          {
            ...toolEvent(2, "tool.started", "call_shell", "navigate"),
            payload: {
              toolName: "bash",
              callId: "call_shell",
              action: "navigate",
            },
          },
          toolEvent(3, "tool.started", "call_foreign", "navigate", "run_other"),
        ],
        "run_live",
        { pauseStatus: "running", takeoverOpen: false },
      ),
    ).toEqual({ state: "idle", label: "Ready · waiting for Agent" });
  });
});

function pauseEvent(seq: number): RunEvent {
  return {
    id: `event_browser_pause_${String(seq)}`,
    threadId: "thread_live",
    runId: "run_live",
    seq,
    type: "browser.session_pause.requested",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-05T00:00:00.000Z",
    payload: {
      kind: "napier.browser-session-pause-state",
      schemaVersion: 1,
      threadId: "thread_live",
      runId: "run_live",
      status: "paused",
      pauseRequestedAt: "2026-08-05T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
  };
}

function toolEvent(
  seq: number,
  type: "tool.started" | "tool.completed" | "tool.failed",
  callId: string,
  action?: string,
  runId = "run_live",
): RunEvent {
  return {
    id: `event_browser_activity_${String(seq)}`,
    threadId: "thread_live",
    runId,
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-05T00:00:00.000Z",
    payload: {
      toolName: "browser",
      callId,
      ...(action ? { action } : {}),
    },
  };
}
