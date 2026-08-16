import { describe, expect, it } from "vitest";

import { isOperatorDecisions } from "../src/operator-decisions-protocol";

describe("Operator Decisions protocol", () => {
  it("accepts strict status shapes and rejects malformed decisions", () => {
    const decision = {
      kind: "napier.operator-decision",
      schemaVersion: 1,
      id: "decision_fixture0001",
      threadId: "thread_1",
      runId: "run_1",
      status: "pending",
      header: "Scope",
      question: "Continue?",
      options: [
        { id: "option_1", label: "Continue", description: "Continue work." },
        { id: "option_2", label: "Stop", description: "Stop work." },
      ],
      multiSelect: false,
      questionSha256: "a".repeat(64),
      requestedAt: "2026-08-16T00:00:00.000Z",
      requestedEventSeq: 1,
      contentSha256: "b".repeat(64),
    };
    expect(isOperatorDecisions([decision])).toBe(true);
    expect(isOperatorDecisions([{ ...decision, status: "unknown" }])).toBe(
      false,
    );
    expect(isOperatorDecisions([{ ...decision, options: [] }])).toBe(false);

    const answered = {
      ...decision,
      status: "answered",
      answeredAt: "2026-08-16T00:01:00.000Z",
      answeredEventSeq: 2,
      selectedOptionIds: ["option_1"],
      answerSha256: "c".repeat(64),
    };
    expect(isOperatorDecisions([answered])).toBe(true);
    expect(
      isOperatorDecisions([{ ...answered, selectedOptionIds: ["option_3"] }]),
    ).toBe(false);

    const continued = {
      ...answered,
      status: "continued",
      continuedAt: "2026-08-16T00:02:00.000Z",
      continuedEventSeq: 3,
      continuationRunId: "run_continuation",
    };
    expect(isOperatorDecisions([continued])).toBe(true);
    expect(
      isOperatorDecisions([{ ...continued, continuationRunId: undefined }]),
    ).toBe(false);

    const cancelled = {
      ...decision,
      status: "cancelled",
      cancelledAt: "2026-08-16T00:01:00.000Z",
      cancellationEventSeq: 2,
      cancellationReason: "operator_cancelled",
    };
    expect(isOperatorDecisions([cancelled])).toBe(true);
    expect(
      isOperatorDecisions([
        { ...cancelled, cancellationReason: "unsupported" },
      ]),
    ).toBe(false);
  });
});
