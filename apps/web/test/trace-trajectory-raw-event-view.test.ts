import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { traceTrajectoryRawEventView } from "../src/trace-trajectory-raw-event-view";

describe("Trace trajectory raw event view", () => {
  it("preserves the complete received envelope and provider-visible model content", () => {
    const event = runEvent("model.response", {
      model: "deepseek/deepseek-v4",
      stopReason: "toolUse",
      reasoning: "RECORDED_PROVIDER_REASONING",
      text: "RECORDED_MODEL_CONTENT",
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
          arguments: { path: "/workspace/index.html" },
        },
      ],
      providerMetadata: { requestId: "req_original_1" },
    });

    const raw = traceTrajectoryRawEventView(event);

    expect(JSON.parse(raw.envelope)).toEqual(event);
    expect(raw.envelope).toContain("RECORDED_PROVIDER_REASONING");
    expect(raw.envelope).toContain("RECORDED_MODEL_CONTENT");
    expect(raw.envelope).toContain("req_original_1");
    expect(raw.payloadFieldCount).toBe(6);
    expect(raw.fields).toEqual([
      {
        key: "reasoning",
        kind: "reasoning",
        state: "recorded",
        value: "RECORDED_PROVIDER_REASONING",
      },
      {
        key: "text",
        kind: "content",
        state: "recorded",
        value: "RECORDED_MODEL_CONTENT",
      },
    ]);
  });

  it("shows tool input and output exactly when those values reached the event", () => {
    const started = traceTrajectoryRawEventView(
      runEvent("tool.started", {
        callId: "call_raw_1",
        toolName: "web_fetch",
        input: { url: "https://example.com/private?q=raw" },
      }),
    );
    const completed = traceTrajectoryRawEventView(
      runEvent("tool.completed", {
        callId: "call_raw_1",
        toolName: "web_fetch",
        output: "RAW_TOOL_OUTPUT",
      }),
    );

    expect(started.fields).toEqual([
      {
        key: "input",
        kind: "toolInput",
        state: "recorded",
        value: '{\n  "url": "https://example.com/private?q=raw"\n}',
      },
    ]);
    expect(completed.fields).toEqual([
      {
        key: "output",
        kind: "toolOutput",
        state: "recorded",
        value: "RAW_TOOL_OUTPUT",
      },
    ]);
  });

  it("does not pretend a receipt contains recoverable original content", () => {
    const model = traceTrajectoryRawEventView(
      runEvent("model.response", {
        reasoningSha256: "a".repeat(64),
        reasoningBytes: 2048,
        textSha256: "b".repeat(64),
        textBytes: 512,
        contentRedacted: true,
      }),
    );
    const tool = traceTrajectoryRawEventView(
      runEvent("tool.completed", {
        outputSha256: "c".repeat(64),
        outputBytes: 4096,
        outputRedacted: true,
      }),
    );

    expect(model.fields).toEqual([
      { key: "reasoning", kind: "reasoning", state: "receipt_only" },
      { key: "content", kind: "content", state: "receipt_only" },
    ]);
    expect(tool.fields).toEqual([
      { key: "toolOutput", kind: "toolOutput", state: "receipt_only" },
    ]);
    expect(model.envelope).toContain('"contentRedacted": true');
    expect(model.envelope).not.toContain("RECOVERED_REASONING");
  });

  it("labels a missing provider reasoning channel as not provided", () => {
    const raw = traceTrajectoryRawEventView(
      runEvent("message.assistant", {
        role: "assistant",
        text: "Visible answer only",
      }),
    );

    expect(raw.fields).toEqual([
      { key: "reasoning", kind: "reasoning", state: "not_provided" },
      {
        key: "text",
        kind: "content",
        state: "recorded",
        value: "Visible answer only",
      },
    ]);
  });
});

function runEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_raw_1",
    threadId: "thread_raw_1",
    runId: "run_raw_1",
    seq: 42,
    type,
    category: type.startsWith("tool.") ? "tool" : "model",
    visibility: "debug",
    createdAt: "2026-08-31T01:02:03.000Z",
    payload,
    schemaVersion: 1,
  };
}
