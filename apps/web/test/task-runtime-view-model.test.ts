import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  hasTaskRuntime,
  taskRuntimeAvailability,
} from "../src/task-runtime-view-model";

describe("Task runtime availability", () => {
  it("shows active browser, process, and Sandbox resources", () => {
    const events = [
      event("tool.completed", {
        toolName: "browser",
        details: { action: "open" },
      }),
      event("workspace.process.started", { id: "process_active" }),
      event("sandbox.preview.completed", {}),
    ];

    const availability = taskRuntimeAvailability(events, "run_1");
    expect(availability).toEqual({
      browser: true,
      process: true,
      sandbox: true,
    });
    expect(hasTaskRuntime(availability)).toBe(true);
  });

  it("hides runtime after browser close and process settlement", () => {
    const events = [
      event("workspace.process.started", { id: "process_done" }),
      event("workspace.process.settled", { id: "process_done" }),
      event("tool.completed", {
        toolName: "browser",
        details: { action: "close" },
      }),
    ];

    const availability = taskRuntimeAvailability(events, "run_1");
    expect(availability).toEqual({
      browser: false,
      process: false,
      sandbox: false,
    });
    expect(hasTaskRuntime(availability)).toBe(false);
  });
});

function event(type: string, payload: Record<string, unknown>): RunEvent {
  return {
    id: `event_${type}`,
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-19T00:00:00.000Z",
    payload: payload as RunEvent["payload"],
  };
}
