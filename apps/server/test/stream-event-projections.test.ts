import { expect, it } from "vitest";
import type { RunEvent } from "@napier/contracts";
import { streamEventNeedsProjections } from "../src/stream-event-projections.js";

function event(type: string, category: RunEvent["category"]): RunEvent {
  return {
    id: "event_1",
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type,
    category,
    visibility: "debug",
    createdAt: "2026-11-11T00:00:00.000Z",
    payload: {},
  };
}

it("projects conversation-changing events and skips debug lifecycle noise", () => {
  expect(streamEventNeedsProjections(event("message.user", "message"))).toBe(
    true,
  );
  expect(streamEventNeedsProjections(event("tool.started", "tool"))).toBe(true);
  expect(
    streamEventNeedsProjections(event("model.response.delta", "model")),
  ).toBe(true);
  expect(streamEventNeedsProjections(event("run.started", "lifecycle"))).toBe(
    true,
  );
  expect(
    streamEventNeedsProjections(event("run.prompt.admitted", "lifecycle")),
  ).toBe(false);
  expect(
    streamEventNeedsProjections(event("run.inputs.captured", "lifecycle")),
  ).toBe(false);
});
