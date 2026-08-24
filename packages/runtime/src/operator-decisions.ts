import type { OperatorDecision, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  parseAnsweredPayload,
  parseCancelledPayload,
  parseContinuedPayload,
  parseRequestedPayload,
  validAnswer,
} from "./operator-decision-payloads.js";
export { formatOperatorDecisionContinuation } from "./operator-decision-continuation.js";
export {
  createOperatorDecisionAnsweredPayload,
  createOperatorDecisionCancelledPayload,
  createOperatorDecisionContinuedPayload,
  createOperatorDecisionRequestedPayload,
  type OperatorDecisionAnsweredPayload,
  type OperatorDecisionCancelledPayload,
  type OperatorDecisionContinuedPayload,
  type OperatorDecisionRequestedPayload,
} from "./operator-decision-payloads.js";

export const OPERATOR_DECISION_REQUESTED_EVENT = "operator.decision.requested";
export const OPERATOR_DECISION_ANSWERED_EVENT = "operator.decision.answered";
export const OPERATOR_DECISION_CONTINUED_EVENT = "operator.decision.continued";
export const OPERATOR_DECISION_CANCELLED_EVENT = "operator.decision.cancelled";

export const MAX_OPERATOR_DECISIONS_PER_THREAD = 64;
export const MAX_OPERATOR_DECISION_QUESTION_BYTES = 4 * 1024;
export const MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES = 4 * 1024;

export function projectOperatorDecisions(
  events: RunEvent[],
  runId?: string,
): OperatorDecision[] {
  const ordered = events.slice().sort((left, right) => left.seq - right.seq);
  let decisions = new Map<string, OperatorDecision>();
  for (const event of ordered) {
    decisions = applyOperatorDecisionEvent(decisions, event, runId);
  }
  return operatorDecisionProjectionView(decisions);
}

export function operatorDecisionProjectionView(
  decisions: ReadonlyMap<string, OperatorDecision>,
): OperatorDecision[] {
  return [...decisions.values()].sort(
    (left, right) =>
      left.requestedEventSeq - right.requestedEventSeq ||
      left.id.localeCompare(right.id),
  );
}

export function applyOperatorDecisionEvent(
  source: ReadonlyMap<string, OperatorDecision>,
  event: RunEvent,
  runId?: string,
): Map<string, OperatorDecision> {
  const decisions = new Map(source);
  if (event.type === OPERATOR_DECISION_REQUESTED_EVENT) {
    if (runId && event.runId !== runId) return decisions;
    const payload = parseRequestedPayload(event.payload);
    if (!payload || decisions.has(payload.decisionId)) return decisions;
    const content = {
      kind: "napier.operator-decision" as const,
      schemaVersion: 1 as const,
      id: payload.decisionId,
      threadId: event.threadId,
      runId: event.runId,
      status: "pending" as const,
      header: payload.header,
      question: payload.question,
      options: payload.options,
      multiSelect: payload.multiSelect,
      questionSha256: payload.questionSha256,
      requestedAt: event.createdAt,
      requestedEventSeq: event.seq,
    };
    decisions.set(payload.decisionId, withContentSha256(content));
    return decisions;
  }

  if (event.type === OPERATOR_DECISION_ANSWERED_EVENT) {
    const payload = parseAnsweredPayload(event.payload);
    const current = payload ? decisions.get(payload.decisionId) : undefined;
    if (
      !payload ||
      !current ||
      current.status !== "pending" ||
      event.threadId !== current.threadId ||
      event.runId !== current.runId ||
      payload.requestedEventSeq !== current.requestedEventSeq ||
      !validAnswer(payload, current)
    ) {
      return decisions;
    }
    const content = {
      ...withoutContentSha256(current),
      status: "answered" as const,
      answeredAt: event.createdAt,
      answeredEventSeq: event.seq,
      selectedOptionIds: payload.selectedOptionIds,
      ...(payload.customText ? { customText: payload.customText } : {}),
      answerSha256: payload.answerSha256,
    };
    decisions.set(current.id, withContentSha256(content));
    return decisions;
  }

  if (event.type === OPERATOR_DECISION_CONTINUED_EVENT) {
    const payload = parseContinuedPayload(event.payload);
    const current = payload ? decisions.get(payload.decisionId) : undefined;
    if (
      !payload ||
      !current ||
      current.status !== "answered" ||
      current.answeredEventSeq === undefined ||
      event.threadId !== current.threadId ||
      event.runId !== current.runId ||
      payload.requestedEventSeq !== current.requestedEventSeq ||
      payload.answeredEventSeq !== current.answeredEventSeq
    ) {
      return decisions;
    }
    const content = {
      ...withoutContentSha256(current),
      status: "continued" as const,
      continuedAt: event.createdAt,
      continuedEventSeq: event.seq,
      continuationRunId: payload.continuationRunId,
    };
    decisions.set(current.id, withContentSha256(content));
    return decisions;
  }

  if (event.type === OPERATOR_DECISION_CANCELLED_EVENT) {
    const payload = parseCancelledPayload(event.payload);
    const current = payload ? decisions.get(payload.decisionId) : undefined;
    if (
      !payload ||
      !current ||
      (current.status !== "pending" && current.status !== "answered") ||
      event.threadId !== current.threadId ||
      event.runId !== current.runId ||
      payload.requestedEventSeq !== current.requestedEventSeq ||
      payload.answeredEventSeq !== (current.answeredEventSeq ?? 0)
    ) {
      return decisions;
    }
    const content = {
      ...withoutContentSha256(current),
      status: "cancelled" as const,
      cancelledAt: event.createdAt,
      cancellationEventSeq: event.seq,
      cancellationReason: payload.reason,
    };
    decisions.set(current.id, withContentSha256(content));
  }
  return decisions;
}

function withContentSha256<T extends Omit<OperatorDecision, "contentSha256">>(
  content: T,
): T & Pick<OperatorDecision, "contentSha256"> {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function withoutContentSha256(
  decision: OperatorDecision,
): Omit<OperatorDecision, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = decision;
  return content;
}
