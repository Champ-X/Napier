import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createRunControlMessageCancelledPayload,
  createRunControlMessageDeliveredPayload,
  createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload,
  nextPendingRunControlMessage,
  projectRunControlMessages,
} from "../src/run-control-messages.js";

const THREAD_ID = "thread_control";
const RUN_ID = "run_control";

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: "message",
    visibility: "user",
    createdAt: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}

describe("Run control messages", () => {
  it("projects one hash-bound queued message without exposing its text", () => {
    const payload = createRunControlMessageQueuedPayload({
      controlMessageId: "control_queued1234",
      mode: "steering",
      text: "  Stop the broad scan and inspect src/runtime.ts.  ",
    });
    const events = [event(1, "run.control.queued", payload)];

    const messages = projectRunControlMessages(events, RUN_ID);
    expect(messages).toEqual([
      expect.objectContaining({
        kind: "napier.run-control-message",
        schemaVersion: 1,
        id: "control_queued1234",
        threadId: THREAD_ID,
        runId: RUN_ID,
        mode: "steering",
        status: "queued",
        textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        textBytes: 47,
        queuedEventSeq: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain("broad scan");
    expect(nextPendingRunControlMessage(events, RUN_ID, "steering")).toEqual({
      message: messages[0],
      text: "Stop the broad scan and inspect src/runtime.ts.",
    });
    expect(
      nextPendingRunControlMessage(events, RUN_ID, "follow_up"),
    ).toBeUndefined();
  });

  it("binds delivery to the exact durable user-message event", () => {
    const queuedPayload = createRunControlMessageQueuedPayload({
      controlMessageId: "control_delivered1",
      mode: "follow_up",
      text: "Summarize the verified result.",
    });
    const queued = event(1, "run.control.queued", queuedPayload);
    const pending = nextPendingRunControlMessage(
      [queued],
      RUN_ID,
      "follow_up",
    )!;
    const deliveredPayload = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 3,
    });
    const delivered = event(2, "run.control.delivered", deliveredPayload);
    const userMessage = event(
      3,
      "message.user",
      createRunControlMessageUserPayload(pending),
    );

    const [message] = projectRunControlMessages(
      [queued, delivered, userMessage],
      RUN_ID,
    );
    expect(message).toEqual(
      expect.objectContaining({
        status: "delivered",
        deliveredEventSeq: 2,
        messageEventSeq: 3,
      }),
    );

    const tamperedUser = structuredClone(userMessage);
    tamperedUser.payload = {
      ...tamperedUser.payload,
      text: "Different operator instruction.",
    };
    expect(
      projectRunControlMessages([queued, delivered, tamperedUser], RUN_ID)[0]
        ?.status,
    ).toBe("queued");

    const nonAdjacentDelivered = event(
      2,
      "run.control.delivered",
      createRunControlMessageDeliveredPayload({
        message: pending.message,
        messageEventSeq: 4,
      }),
    );
    const interveningEvent = event(3, "tool.completed", {});
    const nonAdjacentUser = event(
      4,
      "message.user",
      createRunControlMessageUserPayload(pending),
    );
    expect(
      projectRunControlMessages(
        [queued, nonAdjacentDelivered, interveningEvent, nonAdjacentUser],
        RUN_ID,
      )[0]?.status,
    ).toBe("queued");

    const crossThreadUser = {
      ...userMessage,
      threadId: "thread_other",
    };
    expect(
      projectRunControlMessages([queued, delivered, crossThreadUser], RUN_ID)[0]
        ?.status,
    ).toBe("queued");
  });

  it("uses first-terminal-wins and rejects tampered queue evidence", () => {
    const queuedPayload = createRunControlMessageQueuedPayload({
      controlMessageId: "control_cancelled1",
      mode: "steering",
      text: "Use the narrower verification path.",
    });
    const queued = event(1, "run.control.queued", queuedPayload);
    const pending = nextPendingRunControlMessage([queued], RUN_ID, "steering")!;
    const cancelled = event(
      2,
      "run.control.cancelled",
      createRunControlMessageCancelledPayload({
        message: pending.message,
        reason: "operator_cancelled",
      }),
    );
    const lateDelivery = event(
      3,
      "run.control.delivered",
      createRunControlMessageDeliveredPayload({
        message: pending.message,
        messageEventSeq: 4,
      }),
    );
    const lateUser = event(
      4,
      "message.user",
      createRunControlMessageUserPayload(pending),
    );

    expect(
      projectRunControlMessages(
        [queued, cancelled, lateDelivery, lateUser],
        RUN_ID,
      )[0],
    ).toEqual(
      expect.objectContaining({
        status: "cancelled",
        cancellationReason: "operator_cancelled",
        cancellationEventSeq: 2,
      }),
    );

    const tamperedQueue = structuredClone(queued);
    tamperedQueue.payload = {
      ...tamperedQueue.payload,
      text: "Tampered control text.",
    };
    expect(projectRunControlMessages([tamperedQueue], RUN_ID)).toEqual([]);
  });

  it("rejects empty, oversized, and invalid-mode queue input", () => {
    expect(() =>
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_empty1234",
        mode: "steering",
        text: " ",
      }),
    ).toThrow("1-16384 UTF-8 bytes");
    expect(() =>
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_large1234",
        mode: "steering",
        text: "x".repeat(16_385),
      }),
    ).toThrow("1-16384 UTF-8 bytes");
    expect(() =>
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_mode12345",
        mode: "invalid" as "steering",
        text: "Valid text.",
      }),
    ).toThrow("mode is invalid");
  });
});
