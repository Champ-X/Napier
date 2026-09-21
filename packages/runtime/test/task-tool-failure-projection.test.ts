import type { RunEvent } from "@napier/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "../src/ed25519.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import {
  prepareAgentWorkingStateContext,
  taskWorkingStateForContext,
} from "../src/agent-working-state-context.js";

function event(
  seq: number,
  type: string,
  callId: string,
  input?: string,
  runId = "run_test",
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_test",
    runId,
    seq,
    type,
    category: "tool",
    visibility: "debug",
    createdAt: "2026-09-14T00:00:00.000Z",
    payload: {
      toolName: "update_plan_artifact",
      callId,
      ...(input ? { callInputSha256: sha256(input) } : {}),
    },
  };
}
const project = (events: RunEvent[]) =>
  projectTaskWorkingState({ runId: "run_test", events });

it("delivers distinct failure and matching-retry observations in the compacted model context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-failure-context-"));
  try {
    const context = await prepareAgentWorkingStateContext({
      context: { messages: [] },
      runId: "run_test",
      workspaceRoot: root,
      enabled: true,
      listEvents: async () => [
        event(1, "tool.failed", "first"),
        event(2, "tool.failed", "second"),
        event(3, "tool.completed", "third"),
        {
          ...event(4, "context.run_compaction.completed", "none"),
          payload: { summary: "all fixed" },
        },
      ],
    });
    const rendered = taskWorkingStateForContext(context);
    const state = JSON.parse(rendered.split("\n").at(-1)!);
    expect(
      state.rejectedAttempts.map((x: { callId: string }) => x.callId),
    ).toEqual(["first", "second"]);
    expect(
      state.rejectedAttempts.every(
        (x: { matchingCompletionObserved: boolean }) =>
          !x.matchingCompletionObserved,
      ),
    ).toBe(true);
    expect(state.pendingActions).toHaveLength(2);
    expect(rendered).toContain("not extra work obligations");
    expect(rendered).toContain("does not establish task correctness");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps both rejected invocations and does not clear them after unrelated tool completion", () => {
  const state = project([
    event(1, "tool.started", "first", "verify artifact A"),
    event(2, "tool.failed", "first"),
    event(3, "tool.started", "second", "verify artifact B"),
    event(4, "tool.failed", "second"),
    event(5, "tool.started", "third", "produce artifact A"),
    event(6, "tool.completed", "third"),
  ]);
  expect(state.rejectedAttempts.map((x) => x.eventId)).toEqual([
    "event_2",
    "event_4",
  ]);
  expect(state.pendingActions.map((x) => x.eventId)).toEqual([
    "event_2",
    "event_4",
  ]);
  expect(state.rejectedAttempts.every((x) => x.laterCompletionObserved)).toBe(
    true,
  );
  expect(state.completion).toBe("not_determined");
});

it("clears only the matching-input pending failure, while preserving both rejected attempts", () => {
  const state = project([
    event(1, "tool.started", "first", "verify artifact A"),
    event(2, "tool.failed", "first"),
    event(3, "tool.started", "second", "verify artifact B"),
    event(4, "tool.failed", "second"),
    event(5, "tool.started", "retry", "verify artifact A"),
    event(6, "tool.completed", "retry"),
  ]);
  expect(state.rejectedAttempts).toHaveLength(2);
  expect(state.pendingActions.map((x) => x.eventId)).toEqual(["event_4"]);
});

it.each(["missing", "conflicting", "late", "malformed", "duplicate"])(
  "does not infer a matching retry from %s invocation bindings",
  (mode) => {
    const events = [
      event(1, "tool.started", "first", "verify artifact A"),
      event(2, "tool.failed", "first"),
      event(5, "tool.completed", "retry"),
    ];
    if (mode !== "missing")
      events.push(
        event(
          mode === "late" ? 6 : 3,
          "tool.started",
          "retry",
          "verify artifact A",
        ),
      );
    if (mode === "conflicting")
      events.push(event(4, "tool.started", "retry", "verify artifact B"));
    if (mode === "duplicate")
      events.push(event(4, "tool.started", "retry", "verify artifact A"));
    if (mode === "malformed")
      events.at(-1)!.payload = {
        ...events.at(-1)!.payload,
        callInputSha256: "invalid",
      };
    const state = project(events);
    expect(state.pendingActions.map((x) => x.eventId)).toEqual(["event_2"]);
  },
);

it("does not borrow an invocation binding from another Run with the same call ID", () => {
  const events = [
    event(1, "tool.started", "first", "verify artifact A"),
    event(2, "tool.failed", "first"),
    event(3, "tool.started", "retry", "verify artifact A", "run_parent"),
    event(4, "tool.completed", "retry"),
  ];
  const state = projectTaskWorkingState({
    runId: "run_test",
    sourceRunIds: ["run_parent"],
    events,
  });
  expect(state.pendingActions.map((x) => x.eventId)).toEqual(["event_2"]);
});

it("observes a bound retry across same-thread recovery without claiming task completion", () => {
  const state = projectTaskWorkingState({
    runId: "run_test",
    sourceRunIds: ["run_parent"],
    events: [
      event(1, "tool.started", "old", "same input", "run_parent"),
      event(2, "tool.failed", "old", undefined, "run_parent"),
      event(3, "tool.started", "retry", "same input"),
      event(4, "tool.completed", "retry"),
    ],
  });
  expect(state.pendingActions).toEqual([]);
  expect(state.rejectedAttempts[0]).toMatchObject({
    eventId: "event_2",
    matchingCompletionObserved: true,
    matchingCompletionEventId: "event_4",
  });
  expect(state.completion).toBe("not_determined");
});

it("does not let earlier success settle a later failure or unbound blocked call", () => {
  const state = project([
    event(1, "tool.started", "success", "same input"),
    event(2, "tool.completed", "success"),
    event(3, "tool.started", "failure", "same input"),
    event(4, "tool.failed", "failure"),
    event(5, "tool.blocked", "blocked"),
  ]);
  expect(state.pendingActions.map((x) => x.eventId)).toEqual([
    "event_4",
    "event_5",
  ]);
});

it("retains unbound legacy failures after compaction and marks omitted failure history", () => {
  const events = Array.from({ length: 15 }, (_, i) =>
    event(i + 1, "tool.failed", `call_${i}`),
  );
  events.push(event(16, "tool.completed", "unrelated"));
  const before = project(events);
  events.push({
    ...event(17, "context.run_compaction.completed", "none"),
    payload: { summary: "all fixed" },
  });
  expect(project(events)).toEqual(before);
  expect(before.rejectedAttempts).toHaveLength(12);
  expect(before.omittedRejectedAttemptCount).toBe(3);
  expect(before.pendingActions).toHaveLength(15);
  expect(before.truncated).toBe(true);
});
