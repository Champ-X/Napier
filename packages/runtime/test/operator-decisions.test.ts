import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  createOperatorDecisionAnsweredPayload,
  createOperatorDecisionCancelledPayload,
  createOperatorDecisionContinuedPayload,
  createOperatorDecisionRequestedPayload,
  formatOperatorDecisionContinuation,
  projectOperatorDecisions,
} from "../src/operator-decisions.js";

const THREAD_ID = "thread_decision";
const RUN_ID = "run_decision";

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: "system",
    visibility: "user",
    createdAt: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}

describe("Operator decisions", () => {
  it("projects a strict hash-bound pending decision", () => {
    const payload = createOperatorDecisionRequestedPayload({
      decisionId: "decision_pending1234",
      request: {
        header: "Scope",
        question: "Which implementation scope should continue?",
        options: [
          {
            label: "Runtime only",
            description: "Implement the durable runtime boundary first.",
          },
          {
            label: "Full product",
            description: "Include management and Workbench surfaces.",
          },
        ],
        multiSelect: false,
      },
    });

    expect(
      projectOperatorDecisions([
        event(1, "operator.decision.requested", payload),
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "napier.operator-decision",
        schemaVersion: 1,
        id: "decision_pending1234",
        threadId: THREAD_ID,
        runId: RUN_ID,
        status: "pending",
        questionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        options: [
          expect.objectContaining({ id: "option_1", label: "Runtime only" }),
          expect.objectContaining({ id: "option_2", label: "Full product" }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("binds an answer and continuation to the exact predecessor events", () => {
    const requested = event(
      1,
      "operator.decision.requested",
      createOperatorDecisionRequestedPayload({
        decisionId: "decision_answered1",
        request: {
          header: "Deploy",
          question: "Which deployment lane should be used?",
          options: [
            { label: "Canary", description: "Deploy to the canary lane." },
            {
              label: "Production",
              description: "Deploy directly to the production lane.",
            },
          ],
          multiSelect: false,
        },
      }),
    );
    const pending = projectOperatorDecisions([requested])[0]!;
    const answered = event(
      2,
      "operator.decision.answered",
      createOperatorDecisionAnsweredPayload({
        decision: pending,
        answer: {
          selectedOptionIds: ["option_1"],
          customText: "Use a 5% traffic slice.",
        },
      }),
    );
    const answer = projectOperatorDecisions([requested, answered])[0]!;
    expect(answer).toEqual(
      expect.objectContaining({
        status: "answered",
        answeredEventSeq: 2,
        selectedOptionIds: ["option_1"],
        customText: "Use a 5% traffic slice.",
        answerSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(formatOperatorDecisionContinuation(answer)).toContain(
      "Use a 5% traffic slice.",
    );

    const continued = event(
      3,
      "operator.decision.continued",
      createOperatorDecisionContinuedPayload({
        decision: answer,
        continuationRunId: "run_continuation1234",
      }),
    );
    expect(
      projectOperatorDecisions([requested, answered, continued])[0],
    ).toEqual(
      expect.objectContaining({
        status: "continued",
        continuedEventSeq: 3,
        continuationRunId: "run_continuation1234",
      }),
    );

    const wrongAnswerReference = structuredClone(continued);
    wrongAnswerReference.payload = {
      ...wrongAnswerReference.payload,
      answeredEventSeq: 99,
    };
    expect(
      projectOperatorDecisions([requested, answered, wrongAnswerReference])[0]
        ?.status,
    ).toBe("answered");
  });

  it("uses first terminal state wins and rejects tampered answer evidence", () => {
    const requested = event(
      1,
      "operator.decision.requested",
      createOperatorDecisionRequestedPayload({
        decisionId: "decision_cancelled1",
        request: {
          header: "Mode",
          question: "Which mode should be used?",
          options: [
            { label: "Observe", description: "Keep the run read-only." },
            { label: "Workspace", description: "Allow bounded edits." },
          ],
          multiSelect: false,
        },
      }),
    );
    const pending = projectOperatorDecisions([requested])[0]!;
    const cancelled = event(
      2,
      "operator.decision.cancelled",
      createOperatorDecisionCancelledPayload({
        decision: pending,
        reason: "operator_cancelled",
      }),
    );
    const answeredPayload = createOperatorDecisionAnsweredPayload({
      decision: pending,
      answer: { selectedOptionIds: ["option_1"] },
    });
    const lateAnswer = event(3, "operator.decision.answered", answeredPayload);
    expect(
      projectOperatorDecisions([requested, cancelled, lateAnswer])[0],
    ).toEqual(
      expect.objectContaining({
        status: "cancelled",
        cancellationReason: "operator_cancelled",
      }),
    );

    const tamperedAnswer = structuredClone(lateAnswer);
    tamperedAnswer.payload = {
      ...tamperedAnswer.payload,
      selectedOptionIds: ["option_2"],
    };
    expect(
      projectOperatorDecisions([requested, tamperedAnswer])[0]?.status,
    ).toBe("pending");
  });

  it("rejects malformed requests and answers outside their option contract", () => {
    expect(() =>
      createOperatorDecisionRequestedPayload({
        decisionId: "decision_invalid12",
        request: {
          header: "Scope",
          question: "Choose scope.",
          options: [
            { label: "Same", description: "First." },
            { label: "same", description: "Second." },
          ],
          multiSelect: false,
        },
      }),
    ).toThrow("labels must be distinct");

    const duplicateLabelPayload = createOperatorDecisionRequestedPayload({
      decisionId: "decision_duplicate1",
      request: {
        header: "Scope",
        question: "Choose scope.",
        options: [
          { label: "One", description: "First." },
          { label: "Two", description: "Second." },
        ],
        multiSelect: false,
      },
    });
    duplicateLabelPayload.options[1]!.label = "one";
    const { requestSha256: _requestSha256, ...duplicateLabelContent } =
      duplicateLabelPayload;
    duplicateLabelPayload.requestSha256 = sha256(
      canonicalJson(duplicateLabelContent),
    );
    expect(
      projectOperatorDecisions([
        event(1, "operator.decision.requested", duplicateLabelPayload),
      ]),
    ).toEqual([]);

    const requested = event(
      1,
      "operator.decision.requested",
      createOperatorDecisionRequestedPayload({
        decisionId: "decision_invalid34",
        request: {
          header: "Scope",
          question: "Choose scope.",
          options: [
            { label: "One", description: "First." },
            { label: "Two", description: "Second." },
          ],
          multiSelect: false,
        },
      }),
    );
    const pending = projectOperatorDecisions([requested])[0]!;
    expect(() =>
      createOperatorDecisionAnsweredPayload({
        decision: pending,
        answer: { selectedOptionIds: ["option_1", "option_2"] },
      }),
    ).toThrow("selections are invalid");
    expect(() =>
      createOperatorDecisionAnsweredPayload({
        decision: pending,
        answer: { selectedOptionIds: [] },
      }),
    ).toThrow("answer is empty");
  });
});
