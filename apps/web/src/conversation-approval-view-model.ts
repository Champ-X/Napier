import type { OperatorDecision, RunEvent } from "@napier/contracts";

export interface ConversationApproval {
  id: string;
  seq: number;
  createdAt: string;
  decision: OperatorDecision;
  selectedLabels: string[];
  customAnswerRecorded: boolean;
}

const DECISION_EVENT =
  /^operator\.decision\.(requested|answered|continued|cancelled)$/u;
const DECISION_ID = /^decision_[a-z0-9]{8,80}$/u;

export function conversationApprovals(
  decisions: OperatorDecision[],
  limit = 6,
): ConversationApproval[] {
  return decisions
    .map((decision) => ({
      id: decision.id,
      seq: decisionSeq(decision),
      createdAt: decisionTimestamp(decision),
      decision,
      selectedLabels: selectedOptionLabels(decision),
      customAnswerRecorded: Boolean(decision.customText),
    }))
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationApprovalEventId(
  event: RunEvent,
): string | undefined {
  if (
    event.visibility !== "user" ||
    !DECISION_EVENT.test(event.type) ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const decisionId = event.payload["decisionId"];
  return typeof decisionId === "string" && DECISION_ID.test(decisionId)
    ? decisionId
    : undefined;
}

function selectedOptionLabels(decision: OperatorDecision): string[] {
  const selected = new Set(decision.selectedOptionIds ?? []);
  return decision.options
    .filter((option) => selected.has(option.id))
    .map((option) => option.label);
}

function decisionSeq(decision: OperatorDecision): number {
  return (
    decision.continuedEventSeq ??
    decision.cancellationEventSeq ??
    decision.answeredEventSeq ??
    decision.requestedEventSeq
  );
}

function decisionTimestamp(decision: OperatorDecision): string {
  return (
    decision.continuedAt ??
    decision.cancelledAt ??
    decision.answeredAt ??
    decision.requestedAt
  );
}
