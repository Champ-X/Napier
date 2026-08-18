import type { RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createTraceTrajectoryModel,
  traceTrajectoryMatches,
  traceTrajectoryIsKeyEvent,
  traceTrajectoryPosition,
} from "../src/trace-trajectory-model";
import { layoutTraceTrajectoryLane } from "../src/trace-trajectory-layout";

describe("Trace trajectory model", () => {
  it("projects chronological lanes, turns, calls, and paired spans", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);

    expect(model).toMatchObject({
      durationMs: 10_000,
      turnCount: 1,
      callCount: 2,
      eventCount: 10,
    });
    expect(model.events.map((event) => event.event.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(model.events.map((event) => event.lane)).toEqual([
      "input",
      "model",
      "input",
      "input",
      "model",
      "tools",
      "tools",
      "model",
      "model",
      "input",
    ]);
    expect(model.runs[0]?.turns.map((turn) => turn.label)).toEqual([
      "Setup",
      "Turn 1",
    ]);
    expect(model.segments.map((segment) => segment.label)).toEqual([
      "Run Started",
      "Turn Started",
      "User message",
      "Context Model Envelope",
      "read_file · started",
      "Assistant result",
    ]);
    expect(
      model.segments.find((segment) => segment.label === "read_file · started"),
    ).toMatchObject({
      eventId: "event_7",
      lane: "tools",
      status: "completed",
      callOrdinal: 2,
      startMs: Date.parse("2026-08-17T00:00:04.000Z"),
      endMs: Date.parse("2026-08-17T00:00:06.000Z"),
    });
  });

  it("positions spans across duration, turns, and calls", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);
    const tool = model.segments.find(
      (segment) => segment.label === "read_file · started",
    )!;

    expect(traceTrajectoryPosition(tool, model, "duration")).toEqual({
      left: 40,
      width: 20,
    });
    expect(traceTrajectoryPosition(tool, model, "turns")).toEqual({
      left: 50,
      width: 36,
    });
    expect(traceTrajectoryPosition(tool, model, "calls")).toEqual({
      left: 50,
      width: 36,
    });
  });

  it("places visually colliding events on concurrent subtracks", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);
    const source = model.segments.find(
      (segment) => segment.label === "Run Started",
    )!;
    const sameMoment = [
      source,
      {
        ...source,
        id: "trajectory_event_colliding",
        eventId: "event_colliding",
        seq: source.seq + 1,
      },
    ];
    const layout = layoutTraceTrajectoryLane(
      sameMoment,
      model,
      "duration",
      800,
    );

    expect(layout.rowCount).toBe(2);
    expect(layout.items.map((item) => item.row)).toEqual([0, 1]);
    expect(layout.items.every((item) => item.width >= 0.375)).toBe(true);
  });

  it("reuses a subtrack after the previous visible interval ends", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);
    const layout = layoutTraceTrajectoryLane(
      model.segments.filter((segment) => segment.lane === "tools"),
      model,
      "duration",
      800,
    );

    expect(layout.rowCount).toBe(1);
    expect(layout.items.map((item) => item.row)).toEqual([0]);
  });

  it("searches only privacy-bounded labels and summaries", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);
    const tool = model.events.find(
      (event) => event.event.type === "tool.started",
    )!;
    const user = model.events.find(
      (event) => event.event.type === "message.user",
    )!;

    expect(traceTrajectoryMatches(tool, "read_file")).toBe(true);
    expect(traceTrajectoryMatches(user, "message.user")).toBe(true);
    expect(traceTrajectoryMatches(user, "PRIVATE_PROMPT")).toBe(false);
  });

  it("separates readable key actions from the complete audit stream", () => {
    const model = createTraceTrajectoryModel(events(), [run()]);
    const keyEvents = model.events.filter(traceTrajectoryIsKeyEvent);

    expect(keyEvents.map((event) => event.event.type)).toEqual([
      "message.user",
      "tool.completed",
      "model.response",
      "message.assistant",
      "run.completed",
    ]);
    expect(
      keyEvents.find((event) => event.event.type === "tool.completed"),
    ).toMatchObject({ status: "completed", durationMs: 2_000 });
  });
});

function run(): RunRecord {
  return {
    id: "run_trace0001",
    threadId: "thread_trace0001",
    agentId: "agent_trace0001",
    status: "completed",
    startedAt: "2026-08-17T00:00:00.000Z",
    finishedAt: "2026-08-17T00:00:10.000Z",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function events(): RunEvent[] {
  return [
    event(10, "run.completed", "lifecycle", {}, 10),
    event(1, "run.started", "lifecycle", {}, 0),
    event(2, "context.prepared", "model", {}, 1),
    event(3, "turn.started", "lifecycle", {}, 2),
    event(4, "message.user", "message", { text: "PRIVATE_PROMPT" }, 3),
    event(5, "context.model_envelope", "model", { turnIndex: 0 }, 3.5),
    event(
      6,
      "tool.started",
      "tool",
      { toolName: "read_file", callId: "call_read" },
      4,
    ),
    event(
      7,
      "tool.completed",
      "tool",
      { toolName: "read_file", callId: "call_read" },
      6,
    ),
    event(
      8,
      "model.response",
      "model",
      { modelContextEnvelopeTurnIndex: 0 },
      7,
    ),
    event(9, "message.assistant", "message", {}, 8),
  ];
}

function event(
  seq: number,
  type: string,
  category: RunEvent["category"],
  payload: RunEvent["payload"],
  second: number,
): RunEvent {
  const createdAt = new Date(
    Date.parse("2026-08-17T00:00:00.000Z") + second * 1_000,
  ).toISOString();
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_trace0001",
    runId: "run_trace0001",
    seq,
    type,
    category,
    visibility: "user",
    createdAt,
    payload,
  };
}
