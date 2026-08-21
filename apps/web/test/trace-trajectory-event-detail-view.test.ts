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
});

function event(
  type: string,
  payload: RunEvent["payload"],
): TraceTrajectoryEvent {
  return {
    event: {
      id: "event_detail_1",
      threadId: "thread_detail_1",
      runId: "run_detail_123456789",
      seq: 158,
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
    status: "completed",
    durationMs: 1200,
  };
}
