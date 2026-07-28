import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  operatorDecisionTraceSummary,
  operatorDecisionTraceView,
  runControlTraceSummary,
  runControlTraceView,
} from "../src/control-event-view";

describe("Control event trace view", () => {
  it("projects operator decision requests without prompt or option text", () => {
    const event = traceEvent("operator.decision.requested", "system", {
      decisionId: "decision_abcdef123456",
      header: "TOP_SECRET_HEADER",
      question: "TOP_SECRET_QUESTION",
      options: [
        {
          id: "option_1",
          label: "TOP_SECRET_LABEL",
          description: "TOP_SECRET_DESCRIPTION",
        },
        { id: "option_2", label: "Other", description: "Other" },
      ],
      multiSelect: true,
      questionSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
    });

    expect(operatorDecisionTraceView(event)).toEqual({
      action: "requested",
      decisionId: "decision_abcdef123456",
      optionCount: 2,
      multiSelect: true,
      questionSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
    });
    expect(operatorDecisionTraceSummary(event)).toBe(
      `operator / requested / id cdef123456 / options 2 / multi true / question ${"a".repeat(12)} / request ${"b".repeat(12)}`,
    );
    expect(operatorDecisionTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects operator answers and continuations without custom text", () => {
    const answered = traceEvent("operator.decision.answered", "system", {
      decisionId: "decision_abcdef123456",
      selectedOptionIds: ["option_1"],
      customText: "TOP_SECRET_CUSTOM_ANSWER",
      answerSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
    });
    const continued = traceEvent("operator.decision.continued", "system", {
      decisionId: "decision_abcdef123456",
      continuationRunId: "run_abcdef123456",
    });

    expect(operatorDecisionTraceSummary(answered)).toBe(
      `operator / answered / id cdef123456 / selected 1 / answer ${"c".repeat(12)} / receipt ${"d".repeat(12)}`,
    );
    expect(operatorDecisionTraceSummary(continued)).toBe(
      "operator / continued / id cdef123456 / run cdef123456",
    );
    expect(operatorDecisionTraceSummary(answered)).not.toContain("TOP_SECRET");
  });

  it("projects run control receipts without control text", () => {
    const queued = traceEvent("run.control.queued", "message", {
      controlMessageId: "control_abcdef123456",
      mode: "steering",
      text: "TOP_SECRET_CONTROL_TEXT",
      textSha256: "e".repeat(64),
      textBytes: 23,
      requestSha256: "f".repeat(64),
    });
    const delivered = traceEvent("run.control.delivered", "message", {
      controlMessageId: "control_abcdef123456",
      mode: "steering",
      textSha256: "e".repeat(64),
      queuedEventSeq: 7,
      messageEventSeq: 8,
      contentSha256: "0".repeat(64),
    });

    expect(runControlTraceView(queued)).toEqual({
      action: "queued",
      controlMessageId: "control_abcdef123456",
      mode: "steering",
      textSha256: "e".repeat(64),
      textBytes: 23,
      requestSha256: "f".repeat(64),
    });
    expect(runControlTraceSummary(queued)).toBe(
      `control / queued / id cdef123456 / mode steering / text ${"e".repeat(12)} / bytes 23 / request ${"f".repeat(12)}`,
    );
    expect(runControlTraceSummary(delivered)).toBe(
      `control / delivered / id cdef123456 / mode steering / text ${"e".repeat(12)} / receipt ${"0".repeat(12)} / queued 7 / message 8`,
    );
    expect(runControlTraceSummary(queued)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed control receipts", () => {
    expect(
      operatorDecisionTraceSummary(
        traceEvent("operator.decision.requested", "system", {
          decisionId: "bad decision",
          question: "TOP_SECRET_QUESTION",
        }),
      ),
    ).toBe("operator decision receipt");
    expect(
      runControlTraceSummary(
        traceEvent("run.control.queued", "message", {
          controlMessageId: "bad control",
          text: "TOP_SECRET_CONTROL",
        }),
      ),
    ).toBe("run control receipt");
  });
});

function traceEvent(
  type: string,
  category: RunEvent["category"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_control",
    runId: "runctl_control",
    seq: 13,
    type,
    category,
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
