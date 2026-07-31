import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelEventTraceSummary,
  modelEventTraceView,
} from "../src/model-event-view";

describe("Model event trace view", () => {
  it("projects text deltas without raw streamed text", () => {
    const raw = modelEvent("model.text.delta", {
      delta: "TOP_SECRET_DELTA",
      text: "TOP_SECRET_ACCUMULATED_TEXT",
    });
    const redacted = modelEvent("model.text.delta", {
      deltaSha256: "a".repeat(64),
      deltaBytes: 17,
      textSha256: "b".repeat(64),
      textBytes: 88,
      redacted: true,
    });

    expect(modelEventTraceSummary(raw)).toBe("model / text.delta");
    expect(modelEventTraceSummary(redacted)).toBe(
      `model / text.delta / redacted true / delta-bytes 17 / text-bytes 88 / delta ${"a".repeat(12)} / text ${"b".repeat(12)}`,
    );
    expect(modelEventTraceSummary(raw)).not.toContain("TOP_SECRET");
    expect(modelEventTraceSummary(redacted)).not.toContain("TOP_SECRET");
  });

  it("projects thinking deltas without raw reasoning text", () => {
    const event = modelEvent("model.thinking.delta", {
      delta: "TOP_SECRET_REASONING_DELTA",
      deltaSha256: "c".repeat(64),
      deltaBytes: 24,
      redacted: true,
    });

    expect(modelEventTraceView(event)).toEqual({
      action: "thinking.delta",
      redacted: true,
      deltaBytes: 24,
      deltaSha256: "c".repeat(64),
    });
    expect(modelEventTraceSummary(event)).toBe(
      `model / thinking.delta / redacted true / delta-bytes 24 / delta ${"c".repeat(12)}`,
    );
    expect(modelEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects tool-loop detections as bounded hash-only metadata", () => {
    const event = modelEvent("model.tool_loop.detected", {
      toolName: "read_file",
      threshold: 3,
      attemptCount: 3,
      fromSeq: 8,
      toSeq: 24,
      callSha256: "d".repeat(64),
      resultSha256: "e".repeat(64),
      attemptSetSha256: "f".repeat(64),
      policySha256: "0".repeat(64),
      contentSha256: "1".repeat(64),
      result: "TOP_SECRET_TOOL_RESULT",
    });

    expect(modelEventTraceSummary(event)).toBe(
      `model / tool_loop.detected / tool read_file / threshold 3 / attempts 3 / range 8-24 / call ${"d".repeat(12)} / result ${"e".repeat(12)} / attempt-set ${"f".repeat(12)} / policy ${"0".repeat(12)} / content ${"1".repeat(12)}`,
    );
    expect(modelEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects model-call experiment comparison without candidate bodies", () => {
    const event = modelEvent("model.experiment.compared", {
      sourceRunId: "run_source_12345678",
      targetRunId: "run_target_12345678",
      sourceTurnIndex: 2,
      status: "completed",
      outputChanged: true,
      textChanged: false,
      toolCallDelta: 1,
      durationMsDelta: -25,
      costUsdDelta: 0.0002,
      comparisonSha256: "2".repeat(64),
      previewSha256: "3".repeat(64),
      assistantText: "TOP_SECRET_CANDIDATE_BODY",
      toolArguments: { token: "TOP_SECRET_TOOL_ARGUMENT" },
    });

    expect(modelEventTraceSummary(event)).toContain(
      "model / experiment.compared",
    );
    expect(modelEventTraceSummary(event)).toContain(
      "status completed / output-changed true / text-changed false / tool-delta 1 / duration-delta -25 / cost-delta 0.0002",
    );
    expect(modelEventTraceSummary(event)).toContain(
      `comparison ${"2".repeat(12)} / preview ${"3".repeat(12)}`,
    );
    expect(modelEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown model receipts", () => {
    expect(
      modelEventTraceSummary(modelEvent("model.text.delta", ["TOP_SECRET"])),
    ).toBe("model receipt");
    expect(
      modelEventTraceSummary(
        modelEvent("model.future", { text: "TOP_SECRET_MODEL_TEXT" }),
      ),
    ).toBe("model");
  });
});

function modelEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_model",
    runId: "run_model",
    seq: 33,
    type,
    category: "model",
    visibility: "hidden",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
