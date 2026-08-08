import type { OperatorDecision, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationApprovalEventId,
  conversationApprovals,
} from "../src/conversation-approval-view-model";

describe("Conversation approvals", () => {
  it("projects selected option labels while hiding custom answer text", () => {
    const approvals = conversationApprovals([
      decision({
        status: "answered",
        answeredAt: timestamp(2),
        answeredEventSeq: 2,
        selectedOptionIds: ["option_current"],
        customText: "PRIVATE_CUSTOM_ANSWER",
        answerSha256: "c".repeat(64),
      }),
    ]);

    expect(approvals).toEqual([
      expect.objectContaining({
        id: "decision_fixture0001",
        seq: 2,
        createdAt: timestamp(2),
        selectedLabels: ["Current scope"],
        customAnswerRecorded: true,
        decision: expect.objectContaining({ status: "answered" }),
      }),
    ]);
    const safeProjection = {
      ...approvals[0],
      decision: {
        id: approvals[0]!.decision.id,
        status: approvals[0]!.decision.status,
      },
    };
    expect(JSON.stringify(safeProjection)).not.toContain("PRIVATE_CUSTOM_ANSWER");
  });

  it("uses the latest authoritative continued or cancelled lifecycle", () => {
    const continued = conversationApprovals([
      decision({
        status: "continued",
        answeredAt: timestamp(2),
        answeredEventSeq: 2,
        selectedOptionIds: ["option_current"],
        answerSha256: "c".repeat(64),
        continuedAt: timestamp(3),
        continuedEventSeq: 3,
        continuationRunId: "run_continue0001",
      }),
    ])[0]!;
    const cancelled = conversationApprovals([
      decision({
        status: "cancelled",
        cancelledAt: timestamp(4),
        cancellationEventSeq: 4,
        cancellationReason: "operator_cancelled",
      }),
    ])[0]!;

    expect(continued.seq).toBe(3);
    expect(continued.createdAt).toBe(timestamp(3));
    expect(cancelled.seq).toBe(4);
    expect(cancelled.decision.cancellationReason).toBe("operator_cancelled");
  });

  it("recognizes only user-visible bound operator decision events", () => {
    expect(
      conversationApprovalEventId(
        event("operator.decision.requested", "decision_fixture0001"),
      ),
    ).toBe("decision_fixture0001");
    expect(
      conversationApprovalEventId(
        event("operator.decision.future", "decision_fixture0001"),
      ),
    ).toBeUndefined();
    expect(
      conversationApprovalEventId(
        event(
          "operator.decision.requested",
          "decision_fixture0001",
          "hidden",
        ),
      ),
    ).toBeUndefined();
    expect(
      conversationApprovalEventId(
        event("operator.decision.requested", "PRIVATE_DECISION"),
      ),
    ).toBeUndefined();
  });
});

function decision(
  overrides: Partial<OperatorDecision> = {},
): OperatorDecision {
  return {
    kind: "napier.operator-decision",
    schemaVersion: 1,
    id: "decision_fixture0001",
    threadId: "thread_1",
    runId: "run_1",
    status: "pending",
    header: "Choose scope",
    question: "Which scope should continue?",
    options: [
      {
        id: "option_current",
        label: "Current scope",
        description: "Keep the current read-only scope.",
      },
      {
        id: "option_stop",
        label: "Stop",
        description: "Cancel without continuing.",
      },
    ],
    multiSelect: false,
    questionSha256: "a".repeat(64),
    requestedAt: timestamp(1),
    requestedEventSeq: 1,
    contentSha256: "b".repeat(64),
    ...overrides,
  };
}

function event(
  type: string,
  decisionId: string,
  visibility: RunEvent["visibility"] = "user",
): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type,
    category: "system",
    visibility,
    createdAt: timestamp(1),
    payload: { decisionId },
  };
}

function timestamp(second: number): string {
  return `2026-08-08T00:00:0${String(second)}.000Z`;
}
