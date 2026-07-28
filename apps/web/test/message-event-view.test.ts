import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  messageEventTraceSummary,
  messageEventTraceView,
} from "../src/message-event-view";

describe("Message event trace view", () => {
  it("projects user messages without prompt text", () => {
    const event = messageEvent("message.user", {
      role: "user",
      text: "TOP_SECRET_USER_PROMPT",
    });

    expect(messageEventTraceView(event)).toEqual({
      action: "message.user",
      role: "user",
      textBytes: 22,
    });
    expect(messageEventTraceSummary(event)).toBe(
      "message / message.user / role user / text-bytes 22",
    );
    expect(messageEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects assistant messages without answer or reasoning text", () => {
    const event = messageEvent("message.assistant", {
      role: "assistant",
      text: "TOP_SECRET_ASSISTANT_ANSWER",
      reasoning: "TOP_SECRET_REASONING",
      model: "openai/gpt-4.1",
      usage: {
        inputTokens: 12,
        outputTokens: 34,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        costUsd: 0.012345,
      },
    });

    expect(messageEventTraceSummary(event)).toBe(
      "message / message.assistant / role assistant / model openai/gpt-4.1 / text-bytes 27 / input 12 / output 34 / cache-read 2 / cache-write 1 / cost 0.012345",
    );
    expect(messageEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects delivered run-control user messages by hash", () => {
    const event = messageEvent("message.user", {
      role: "user",
      text: "TOP_SECRET_CONTROL_TEXT",
      controlMessageId: "control_1234567890",
      controlMode: "answer",
      textSha256: "a".repeat(64),
    });

    expect(messageEventTraceSummary(event)).toBe(
      `message / message.user / role user / control-mode answer / control-message 1234567890 / text-bytes 23 / text ${"a".repeat(12)}`,
    );
    expect(messageEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects system notes without note text", () => {
    const event = messageEvent("system.note", {
      text: "TOP_SECRET_SYSTEM_NOTE",
    });

    expect(messageEventTraceSummary(event)).toBe(
      "message / system.note / text-bytes 22",
    );
    expect(messageEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown message receipts", () => {
    expect(
      messageEventTraceSummary(messageEvent("message.user", ["TOP_SECRET"])),
    ).toBe("message receipt");
    expect(
      messageEventTraceSummary(
        messageEvent("message.future", { text: "TOP_SECRET_FUTURE_MESSAGE" }),
      ),
    ).toBe("message");
    expect(
      messageEventTraceSummary(
        messageEvent("system.future", { text: "TOP_SECRET_SYSTEM_MESSAGE" }),
      ),
    ).toBe("message");
  });
});

function messageEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_message",
    runId: "run_message",
    seq: 47,
    type,
    category: "message",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
