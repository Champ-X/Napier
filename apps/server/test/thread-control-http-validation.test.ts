import { describe, expect, it } from "vitest";

import { MAX_RUN_CONTROL_MESSAGE_BYTES } from "@napier/runtime";

import {
  parseAnswerOperatorDecisionRequest,
  parseBrowserInteractionConfirmationDecision,
  parseCreateBranchRequest,
  parseQueueRunControlMessageRequest,
} from "../src/thread-control-http-validation.js";

describe("Thread control HTTP validation", () => {
  it("preserves branch sequence and normalized title bounds", () => {
    expect(
      parseCreateBranchRequest({ fromSeq: 1, title: "  Review   branch  " }),
    ).toEqual({ fromSeq: 1, title: "Review branch" });
    expect(parseCreateBranchRequest({ fromSeq: 0 })).toBeUndefined();
    expect(
      parseCreateBranchRequest({ fromSeq: 1, extra: true }),
    ).toBeUndefined();
  });

  it("bounds trimmed control messages by UTF-8 bytes", () => {
    const text = "a".repeat(MAX_RUN_CONTROL_MESSAGE_BYTES);
    expect(
      parseQueueRunControlMessageRequest({ mode: "steering", text }),
    ).toEqual({ mode: "steering", text });
    expect(
      parseQueueRunControlMessageRequest({
        mode: "follow_up",
        text: `${text}a`,
      }),
    ).toBeUndefined();
  });

  it("requires a unique option set or bounded custom answer", () => {
    expect(
      parseAnswerOperatorDecisionRequest({
        selectedOptionIds: ["option_1", "option_2"],
        customText: "  context  ",
      }),
    ).toEqual({
      selectedOptionIds: ["option_1", "option_2"],
      customText: "context",
    });
    expect(
      parseAnswerOperatorDecisionRequest({
        selectedOptionIds: ["option_1", "option_1"],
      }),
    ).toBeUndefined();
    expect(
      parseAnswerOperatorDecisionRequest({ selectedOptionIds: [] }),
    ).toBeUndefined();
  });

  it("requires an exact Browser decision and request hash", () => {
    expect(
      parseBrowserInteractionConfirmationDecision({
        decision: "approve",
        expectedRequestSha256: "a".repeat(64),
      }),
    ).toEqual({
      decision: "approve",
      expectedRequestSha256: "a".repeat(64),
    });
    expect(
      parseBrowserInteractionConfirmationDecision({
        decision: "allow",
        expectedRequestSha256: "a".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      parseBrowserInteractionConfirmationDecision({
        decision: "reject",
        expectedRequestSha256: "not-a-hash",
      }),
    ).toBeUndefined();
  });
});
