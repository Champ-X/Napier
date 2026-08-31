import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { traceTrajectoryEventDetailView } from "../src/trace-trajectory-event-detail-view";
import type { TraceTrajectoryEvent } from "../src/trace-trajectory-model";

describe("Trace trajectory event detail view", () => {
  it("projects tool receipts without exposing arguments or output text", () => {
    const detail = traceTrajectoryEventDetailView(
      event("tool.completed", {
        callId: "call_private_123456",
        toolName: "web_fetch",
        status: "completed",
        inputSha256: "a".repeat(64),
        outputTextSha256: "b".repeat(64),
        outputTextBytes: 4096,
        input: { url: "https://private.example/TOP_SECRET" },
        output: "TOP_SECRET_TOOL_RESULT",
      }),
    );
    const serialized = JSON.stringify(detail);

    expect(detail.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "eventType", value: "tool.completed" }),
        expect.objectContaining({ key: "call", value: "C7" }),
      ]),
    );
    expect(detail.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "toolName", value: "web_fetch" }),
        expect.objectContaining({ key: "inputSha256", value: "aaaaaaaaaaaa…" }),
        expect.objectContaining({
          key: "outputTextSha256",
          value: "bbbbbbbbbbbb…",
        }),
        expect.objectContaining({ key: "outputTextBytes", value: "4096" }),
      ]),
    );
    expect(serialized).not.toContain("TOP_SECRET");
    expect(serialized).not.toContain("private.example");
  });

  it("projects model usage, digests, and paired timing", () => {
    const detail = traceTrajectoryEventDetailView(
      event("model.response", {
        model: "deepseek-v4-flash",
        stopReason: "toolUse",
        modelContextEnvelopeTurnIndex: 5,
        usage: { inputTokens: 6873, outputTokens: 1217 },
        textSha256: "c".repeat(64),
        reasoningSha256: "d".repeat(64),
        privateText: "TOP_SECRET_MODEL_OUTPUT",
      }),
    );

    expect(detail.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "model", value: "deepseek-v4-flash" }),
        expect.objectContaining({ key: "inputTokens", value: "6873" }),
        expect.objectContaining({ key: "outputTokens", value: "1217" }),
        expect.objectContaining({
          key: "reasoningSha256",
          value: "dddddddddddd…",
        }),
      ]),
    );
    expect(detail.timing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "startedAt" }),
        expect.objectContaining({ key: "finishedAt" }),
        expect.objectContaining({ key: "duration", value: "1.20 s" }),
      ]),
    );
    expect(JSON.stringify(detail)).not.toContain("TOP_SECRET_MODEL_OUTPUT");
  });

  it("derives a bounded request path, receipts, TTFT, and throughput", () => {
    const started = timedEvent(
      "route_attempt_started",
      {
        attemptId: "route_attempt_1",
        attempt: 1,
        stepAttempt: 1,
        providerId: "deepseek",
        modelId: "deepseek-v4-flash-vision-exp",
      },
      20,
      0,
    );
    const reasoningDelta = timedEvent(
      "model.thinking.delta",
      { deltaBytes: 48 },
      21,
      1_000,
    );
    const contentDelta = timedEvent(
      "model.text.delta",
      { deltaBytes: 24 },
      22,
      1_200,
    );
    const finished = timedEvent(
      "route_attempt_ended",
      {
        attemptId: "route_attempt_1",
        attempt: 1,
        stepAttempt: 1,
        providerId: "deepseek",
        modelId: "deepseek-v4-flash-vision-exp",
        durationMs: 3_000,
      },
      23,
      3_000,
    );
    const response = timedEvent(
      "model.response",
      {
        model: "deepseek/deepseek-v4-flash-vision-exp",
        stopReason: "toolUse",
        text: "TOP_SECRET_VISIBLE_CONTENT",
        reasoning: "TOP_SECRET_PRIVATE_REASONING",
        usage: {
          inputTokens: 800,
          outputTokens: 120,
          cacheReadTokens: 80,
          cacheWriteTokens: 0,
          costUsd: 0.0012,
        },
        usageAccounting: { rawTotalTokens: 1_000 },
      },
      24,
      3_040,
    );

    const detail = traceTrajectoryEventDetailView(started, [
      started,
      reasoningDelta,
      contentDelta,
      finished,
      response,
    ]);

    expect(detail.keyPath).toBe(
      "ROUTE / attempt.started / deepseek/deepseek-v4-flash-vision-exp / attempt 1 / step 1 / turn 6 / call C7",
    );
    expect(detail.metrics).toEqual(
      expect.arrayContaining([
        { key: "totalTokens", value: "1000" },
        expect.objectContaining({ key: "reasoningBytes" }),
        expect.objectContaining({ key: "contentBytes" }),
        { key: "requestDuration", value: "3.00 s" },
      ]),
    );
    expect(detail.timing).toEqual(
      expect.arrayContaining([
        { key: "requestDuration", value: "3.00 s" },
        { key: "ttft", value: "1.00 s" },
        { key: "contentLatency", value: "1.20 s" },
        { key: "generationDuration", value: "2.00 s" },
        { key: "throughput", value: "60.0 tok/s" },
      ]),
    );
    expect(detail.evidence).toEqual(
      expect.arrayContaining([
        { key: "action", value: "attempt.started" },
        {
          key: "servingModel",
          value: "deepseek/deepseek-v4-flash-vision-exp",
        },
      ]),
    );
    expect(JSON.stringify(detail)).not.toContain("TOP_SECRET");
  });

  it("diagnoses failed tools from bounded receipts and links the retry chain", () => {
    const started = event(
      "tool.started",
      {
        callId: "call_failed_1",
        toolName: "run_command",
        callInputSha256: "a".repeat(64),
        input: "TOP_SECRET_COMMAND",
        details: { runtime: "node", status: "failed", argumentCount: 3 },
      },
      { id: "event_started", seq: 10, status: "active" },
    );
    const failed = event(
      "tool.failed",
      {
        callId: "call_failed_1",
        toolName: "run_command",
        outputTextSha256: "b".repeat(64),
        outputTextBytes: 2048,
        error: "TOP_SECRET_ERROR",
        details: {
          runtime: "node",
          status: "timed_out",
          argumentCount: 3,
          exitCode: 124,
          stderrTruncated: true,
        },
        parentEvaluationId: "eval_bridge_1",
      },
      { id: "event_failed", seq: 11, status: "failed" },
    );
    const retry = event(
      "tool.started",
      { callId: "call_retry_2", toolName: "run_command" },
      { id: "event_retry", seq: 12, status: "active" },
    );
    const detail = traceTrajectoryEventDetailView(failed, [
      started,
      failed,
      retry,
    ]);

    expect(detail.diagnosis).toMatchObject({
      category: "timeout",
      subject: "run_command",
      related: [
        { eventId: "event_started", relation: "started", sequence: 10 },
        { eventId: "event_failed", relation: "failed", sequence: 11 },
        { eventId: "event_retry", relation: "retry", sequence: 12 },
      ],
    });
    expect(detail.diagnosis?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "inputSha256", value: "aaaaaaaaaaaa…" }),
        expect.objectContaining({ key: "argumentCount", value: "3" }),
      ]),
    );
    expect(detail.diagnosis?.outcome).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "exitCode", value: "124" }),
        expect.objectContaining({ key: "outputBytes", value: "2048" }),
        expect.objectContaining({ key: "outputTruncated", value: "true" }),
      ]),
    );
    expect(detail.diagnosis?.parent).toEqual([
      expect.objectContaining({ key: "codeBridge", value: "eval_bridge_1" }),
    ]);
    expect(JSON.stringify(detail)).not.toContain("TOP_SECRET");
  });
});

function event(
  type: string,
  payload: RunEvent["payload"],
  overrides: Partial<
    Pick<TraceTrajectoryEvent, "status"> &
      Pick<TraceTrajectoryEvent["event"], "id" | "seq">
  > = {},
): TraceTrajectoryEvent {
  return {
    event: {
      id: overrides.id ?? "event_detail_1",
      threadId: "thread_detail_1",
      runId: "run_detail_123456789",
      seq: overrides.seq ?? 158,
      type,
      category: type.startsWith("tool.") ? "tool" : "model",
      visibility: "user",
      createdAt: "2026-08-21T04:51:33.000Z",
      payload,
    },
    summary: "privacy bounded summary",
    summarySource: "fixed",
    lane: type.startsWith("tool.") ? "tools" : "model",
    role: type.startsWith("tool.") ? "TOOL" : "MODEL",
    label: type.startsWith("tool.")
      ? "web_fetch · completed"
      : "Model response",
    turnIndex: 6,
    callOrdinal: 7,
    timestampMs: Date.parse("2026-08-21T04:51:33.000Z"),
    status: overrides.status ?? "completed",
    durationMs: 1200,
  };
}

function timedEvent(
  type: string,
  payload: RunEvent["payload"],
  seq: number,
  offsetMs: number,
): TraceTrajectoryEvent {
  const projected = event(type, payload, {
    id: `event_${String(seq)}`,
    seq,
    status: type.endsWith("started") ? "active" : "completed",
  });
  const timestampMs = Date.parse("2026-08-21T04:51:30.000Z") + offsetMs;
  projected.event.createdAt = new Date(timestampMs).toISOString();
  projected.timestampMs = timestampMs;
  projected.role = type.startsWith("route_") ? "ROUTE" : "MODEL";
  projected.lane = "model";
  return projected;
}
