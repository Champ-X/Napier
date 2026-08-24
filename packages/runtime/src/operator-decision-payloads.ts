import type {
  AnswerOperatorDecisionRequest,
  OperatorDecision,
  OperatorDecisionCancellationReason,
  RequestOperatorDecisionInput,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  CANCELLATION_REASONS,
  DECISION_ID,
  MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES,
  MAX_OPERATOR_DECISION_QUESTION_BYTES,
  RUN_ID,
  boundedOptionalText,
  boundedText,
  hasDistinctOptionLabels,
  normalizeSelectedOptionIds,
  type OperatorDecisionAnsweredPayload,
  type OperatorDecisionCancelledPayload,
  type OperatorDecisionContinuedPayload,
  type OperatorDecisionRequestedPayload,
} from "./operator-decision-payload-primitives.js";

export type {
  OperatorDecisionAnsweredPayload,
  OperatorDecisionCancelledPayload,
  OperatorDecisionContinuedPayload,
  OperatorDecisionRequestedPayload,
} from "./operator-decision-payload-primitives.js";

export {
  parseAnsweredPayload,
  parseCancelledPayload,
  parseContinuedPayload,
  parseRequestedPayload,
  validAnswer,
} from "./operator-decision-payload-parsing.js";

export function createOperatorDecisionRequestedPayload(input: {
  decisionId: string;
  request: RequestOperatorDecisionInput;
}): OperatorDecisionRequestedPayload {
  if (!DECISION_ID.test(input.decisionId)) {
    throw new Error("Operator decision ID is invalid");
  }
  const header = boundedText(input.request.header, "header", 128, 12);
  const question = boundedText(
    input.request.question,
    "question",
    MAX_OPERATOR_DECISION_QUESTION_BYTES,
  );
  if (
    !Array.isArray(input.request.options) ||
    input.request.options.length < 2 ||
    input.request.options.length > 4
  ) {
    throw new Error("Operator decision requires 2-4 options");
  }
  const options = input.request.options.map((option, index) => ({
    id: `option_${index + 1}`,
    label: boundedText(option.label, `option ${index + 1} label`, 256, 80),
    description: boundedText(
      option.description,
      `option ${index + 1} description`,
      1024,
      400,
    ),
  }));
  if (!hasDistinctOptionLabels(options)) {
    throw new Error("Operator decision option labels must be distinct");
  }
  const content = {
    kind: "napier.operator-decision-requested" as const,
    schemaVersion: 1 as const,
    decisionId: input.decisionId,
    header,
    question,
    options,
    multiSelect: input.request.multiSelect,
    questionSha256: sha256(question),
  };
  return {
    ...content,
    requestSha256: sha256(canonicalJson(content)),
  };
}

export function createOperatorDecisionAnsweredPayload(input: {
  decision: OperatorDecision;
  answer: AnswerOperatorDecisionRequest;
}): OperatorDecisionAnsweredPayload {
  if (input.decision.status !== "pending") {
    throw new Error("Only a pending operator decision can be answered");
  }
  const selectedOptionIds = normalizeSelectedOptionIds(
    input.answer.selectedOptionIds,
    input.decision,
  );
  const customText =
    input.answer.customText === undefined
      ? ""
      : boundedOptionalText(
          input.answer.customText,
          "custom answer",
          MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES,
        );
  if (selectedOptionIds.length === 0 && !customText) {
    throw new Error("Operator decision answer is empty");
  }
  const answerContent = {
    selectedOptionIds,
    customText,
  };
  const content = {
    kind: "napier.operator-decision-answered" as const,
    schemaVersion: 1 as const,
    decisionId: input.decision.id,
    requestedEventSeq: input.decision.requestedEventSeq,
    selectedOptionIds,
    customText,
    answerSha256: sha256(canonicalJson(answerContent)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createOperatorDecisionContinuedPayload(input: {
  decision: OperatorDecision;
  continuationRunId: string;
}): OperatorDecisionContinuedPayload {
  if (
    input.decision.status !== "answered" ||
    input.decision.answeredEventSeq === undefined
  ) {
    throw new Error("Only an answered operator decision can continue");
  }
  if (!RUN_ID.test(input.continuationRunId)) {
    throw new Error("Operator decision continuation Run ID is invalid");
  }
  return {
    kind: "napier.operator-decision-continued",
    schemaVersion: 1,
    decisionId: input.decision.id,
    requestedEventSeq: input.decision.requestedEventSeq,
    answeredEventSeq: input.decision.answeredEventSeq,
    continuationRunId: input.continuationRunId,
  };
}

export function createOperatorDecisionCancelledPayload(input: {
  decision: OperatorDecision;
  reason: OperatorDecisionCancellationReason;
}): OperatorDecisionCancelledPayload {
  if (
    input.decision.status !== "pending" &&
    input.decision.status !== "answered"
  ) {
    throw new Error(
      "Only a pending or answered operator decision can be cancelled",
    );
  }
  if (!CANCELLATION_REASONS.has(input.reason)) {
    throw new Error("Operator decision cancellation reason is invalid");
  }
  const content = {
    kind: "napier.operator-decision-cancelled" as const,
    schemaVersion: 1 as const,
    decisionId: input.decision.id,
    requestedEventSeq: input.decision.requestedEventSeq,
    answeredEventSeq: input.decision.answeredEventSeq ?? 0,
    reason: input.reason,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}
