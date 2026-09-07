import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  traceTrajectoryInsights,
  traceTrajectoryUsage,
} from "../src/trace-trajectory-insights";
import {
  createTraceTrajectoryModel,
  traceTrajectoryIsKeyEvent,
  traceTrajectoryMatches,
} from "../src/trace-trajectory-model";
import {
  traceTrajectoryEventPreview,
  traceTrajectoryRowPresentation,
} from "../src/trace-trajectory-presentation";

describe("trajectory execution insights", () => {
  it("counts response usage once, including cache, without summing route or message copies", () => {
    const payload = {
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 400,
        cacheWriteTokens: 30,
        costUsd: 0.001,
      },
    };
    const response = event(2, "model.response", payload);
    const model = createTraceTrajectoryModel(
      [
        event(1, "route_attempt_ended", {
          ...payload,
          attemptId: "attempt_1",
          outcome: "success",
        }),
        response,
        event(3, "message.assistant", payload),
        event(4, "model.response", {
          usage: { inputTokens: 50, outputTokens: 10 },
        }),
        event(5, "model.response", { textBytes: 500 }),
        event(6, "tool.started", { callId: "call_1" }),
        event(7, "tool.completed", { callId: "call_1" }),
        event(8, "tool.failed", { callId: "call_1" }, "run_other"),
      ],
      [],
    );
    const insights = traceTrajectoryInsights([
      ...model.events,
      model.events[1]!,
    ]);
    expect(insights).toMatchObject({
      toolCalls: 2,
      responses: 3,
      measuredResponses: 2,
      usage: {
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 400,
        cacheWriteTokens: 30,
        totalTokens: 610,
        costUsd: 0.001,
      },
    });
  });

  it("uses reported totals and distinguishes missing, invalid and zero usage", () => {
    expect(
      traceTrajectoryUsage({
        usage: { inputTokens: 10, outputTokens: 20 },
        usageAccounting: { rawTotalTokens: 25 },
      }).totalTokens,
    ).toBe(25);
    expect(
      traceTrajectoryUsage({
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      }),
    ).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 });
    expect(
      traceTrajectoryUsage({ textBytes: 100, reasoningBytes: 200 }),
    ).toEqual({});
    expect(
      traceTrajectoryUsage({
        usage: {
          inputTokens: -1,
          outputTokens: Number.NaN,
          costUsd: Number.POSITIVE_INFINITY,
        },
      }),
    ).toEqual({});
  });

  it("settles paired starts and retains live calls and failed route attempts in the key view", () => {
    const model = createTraceTrajectoryModel(
      [
        event(1, "route_plan_created", {}),
        event(2, "route_attempt_started", { attemptId: "attempt_1" }),
        event(3, "route_attempt_ended", {
          attemptId: "attempt_1",
          outcome: "success",
        }),
        event(4, "tool.started", { callId: "call_1" }),
        event(5, "tool.completed", { callId: "call_1" }),
        event(6, "route_attempt_ended", {
          attemptId: "attempt_2",
          outcome: "retry",
          failureClass: "rate_limit",
        }),
        event(7, "tool.started", { callId: "call_live" }),
        event(8, "route_attempt_started", { attemptId: "attempt_live" }),
      ],
      [],
    );
    expect(model.events[1]?.status).toBe("completed");
    expect(model.events[3]?.status).toBe("completed");
    expect(
      model.events
        .filter(traceTrajectoryIsKeyEvent)
        .map((item) => item.event.seq),
    ).toEqual([5, 6, 7, 8]);
    expect(model.events[6]?.durationMs).toBeUndefined();
    expect(model.events[7]?.durationMs).toBeUndefined();
  });

  it("shows tool input and useful output while keeping the complete preview", () => {
    const output = `Web Source: websource_${"a".repeat(64)}\nContent SHA-256: ${"b".repeat(64)}\nTitle: Build report\nAll 42 checks passed`;
    const [tool] = createTraceTrajectoryModel(
      [
        event(1, "tool.completed", {
          toolName: "run_command",
          displaySchemaVersion: 1,
          displayInput: '{"command":"npm test","timeoutMs":1000}',
          displayOutput: output,
        }),
      ],
      [],
    ).events;
    const row = traceTrajectoryRowPresentation(tool!);
    expect(row).toEqual({
      subject: "run_command",
      summary: "npm test",
      detail: "Title: Build report · All 42 checks passed",
    });
    expect(
      traceTrajectoryEventPreview(tool!).find(
        (section) => section.id === "output",
      )?.value,
    ).toBe(output);
  });

  it("searches sanitized local content without indexing arbitrary private fields", () => {
    const [tool] = createTraceTrajectoryModel(
      [
        event(1, "tool.completed", {
          toolName: "read_file",
          displaySchemaVersion: 1,
          displayInput: '{"path":"src/receipt.ts"}',
          displayOutput: "verified receipt",
          privateOutput: "NEVER_INDEX_PRIVATE",
        }),
      ],
      [],
    ).events;
    expect(traceTrajectoryMatches(tool!, "src/receipt.ts")).toBe(true);
    expect(traceTrajectoryMatches(tool!, "verified receipt")).toBe(true);
    expect(traceTrajectoryMatches(tool!, "NEVER_INDEX_PRIVATE")).toBe(false);
    const [model] = createTraceTrajectoryModel(
      [
        event(2, "model.response", {
          localDisplaySchemaVersion: 1,
          localDisplayText: "A readable answer",
          localDisplayThinking: "A local explanation",
        }),
      ],
      [],
    ).events;
    expect(traceTrajectoryMatches(model!, "readable answer")).toBe(true);
    expect(traceTrajectoryMatches(model!, "local explanation")).toBe(true);
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  runId = "run_insights",
): RunEvent {
  return {
    id: `event_${runId}_${seq}`,
    runId,
    threadId: "thread_insights",
    seq,
    type,
    category: type.startsWith("tool.") ? "tool" : "model",
    visibility: "user",
    createdAt: new Date(Date.UTC(2026, 8, 6) + seq * 1000).toISOString(),
    payload,
  };
}
