import type {
  JsonValue,
  OperatorDecision,
  OperatorDecisionCancellationReason,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  CANCELLATION_REASONS,
  DECISION_ID,
  MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES,
  MAX_OPERATOR_DECISION_QUESTION_BYTES,
  OPTION_ID,
  RUN_ID,
  SHA256,
  boundedOptionalText,
  boundedText,
  hasDistinctOptionLabels,
  normalizeSelectedOptionIds,
  type OperatorDecisionAnsweredPayload,
  type OperatorDecisionCancelledPayload,
  type OperatorDecisionContinuedPayload,
  type OperatorDecisionPayloadOption,
  type OperatorDecisionRequestedPayload,
} from "./operator-decision-payload-primitives.js";

export function parseRequestedPayload(
  input: JsonValue,
): OperatorDecisionRequestedPayload | undefined {
  if (!record(input)) return undefined;
  const decisionId = input["decisionId"];
  const header = input["header"];
  const question = input["question"];
  const options = input["options"];
  const multiSelect = input["multiSelect"];
  const questionSha256 = input["questionSha256"];
  const requestSha256 = input["requestSha256"];
  if (
    input["kind"] !== "napier.operator-decision-requested" ||
    input["schemaVersion"] !== 1 ||
    typeof decisionId !== "string" ||
    !DECISION_ID.test(decisionId) ||
    typeof header !== "string" ||
    typeof question !== "string" ||
    typeof multiSelect !== "boolean" ||
    typeof questionSha256 !== "string" ||
    !SHA256.test(questionSha256) ||
    typeof requestSha256 !== "string" ||
    !SHA256.test(requestSha256) ||
    !Array.isArray(options)
  ) {
    return undefined;
  }
  let normalizedOptions: OperatorDecisionPayloadOption[];
  try {
    boundedText(header, "header", 128, 12);
    boundedText(question, "question", MAX_OPERATOR_DECISION_QUESTION_BYTES);
    normalizedOptions = options.map((option, index) =>
      parseOption(option, index),
    );
  } catch {
    return undefined;
  }
  if (
    normalizedOptions.length < 2 ||
    normalizedOptions.length > 4 ||
    new Set(normalizedOptions.map((option) => option.id)).size !==
      normalizedOptions.length ||
    !hasDistinctOptionLabels(normalizedOptions)
  ) {
    return undefined;
  }
  const content = {
    kind: "napier.operator-decision-requested" as const,
    schemaVersion: 1 as const,
    decisionId,
    header,
    question,
    options: normalizedOptions,
    multiSelect,
    questionSha256,
  };
  return sha256(question) === questionSha256 &&
    sha256(canonicalJson(content)) === requestSha256
    ? { ...content, requestSha256 }
    : undefined;
}

export function parseAnsweredPayload(
  input: JsonValue,
): OperatorDecisionAnsweredPayload | undefined {
  if (!record(input)) return undefined;
  const decisionId = input["decisionId"];
  const requestedEventSeq = input["requestedEventSeq"];
  const selectedOptionIds = input["selectedOptionIds"];
  const customText = input["customText"];
  const answerSha256 = input["answerSha256"];
  const contentSha256 = input["contentSha256"];
  if (
    input["kind"] !== "napier.operator-decision-answered" ||
    input["schemaVersion"] !== 1 ||
    typeof decisionId !== "string" ||
    !DECISION_ID.test(decisionId) ||
    !positiveInteger(requestedEventSeq) ||
    !Array.isArray(selectedOptionIds) ||
    selectedOptionIds.some(
      (optionId) => typeof optionId !== "string" || !OPTION_ID.test(optionId),
    ) ||
    typeof customText !== "string" ||
    typeof answerSha256 !== "string" ||
    !SHA256.test(answerSha256) ||
    typeof contentSha256 !== "string" ||
    !SHA256.test(contentSha256)
  ) {
    return undefined;
  }
  try {
    boundedOptionalText(
      customText,
      "custom answer",
      MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES,
    );
  } catch {
    return undefined;
  }
  const normalized = {
    kind: "napier.operator-decision-answered" as const,
    schemaVersion: 1 as const,
    decisionId,
    requestedEventSeq: Number(requestedEventSeq),
    selectedOptionIds: selectedOptionIds as string[],
    customText,
    answerSha256,
    contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  return sha256(
    canonicalJson({
      selectedOptionIds: normalized.selectedOptionIds,
      customText,
    }),
  ) === answerSha256 && sha256(canonicalJson(content)) === contentSha256
    ? normalized
    : undefined;
}

export function parseContinuedPayload(
  input: JsonValue,
): OperatorDecisionContinuedPayload | undefined {
  if (!record(input)) return undefined;
  const decisionId = input["decisionId"];
  const requestedEventSeq = input["requestedEventSeq"];
  const answeredEventSeq = input["answeredEventSeq"];
  const continuationRunId = input["continuationRunId"];
  return input["kind"] === "napier.operator-decision-continued" &&
    input["schemaVersion"] === 1 &&
    typeof decisionId === "string" &&
    DECISION_ID.test(decisionId) &&
    positiveInteger(requestedEventSeq) &&
    positiveInteger(answeredEventSeq) &&
    typeof continuationRunId === "string" &&
    RUN_ID.test(continuationRunId)
    ? {
        kind: "napier.operator-decision-continued",
        schemaVersion: 1,
        decisionId,
        requestedEventSeq: Number(requestedEventSeq),
        answeredEventSeq: Number(answeredEventSeq),
        continuationRunId,
      }
    : undefined;
}

export function parseCancelledPayload(
  input: JsonValue,
): OperatorDecisionCancelledPayload | undefined {
  if (!record(input)) return undefined;
  const decisionId = input["decisionId"];
  const requestedEventSeq = input["requestedEventSeq"];
  const answeredEventSeq = input["answeredEventSeq"];
  const reason = input["reason"];
  const contentSha256 = input["contentSha256"];
  if (
    input["kind"] !== "napier.operator-decision-cancelled" ||
    input["schemaVersion"] !== 1 ||
    typeof decisionId !== "string" ||
    !DECISION_ID.test(decisionId) ||
    !positiveInteger(requestedEventSeq) ||
    !nonNegativeInteger(answeredEventSeq) ||
    typeof reason !== "string" ||
    !CANCELLATION_REASONS.has(reason as OperatorDecisionCancellationReason) ||
    typeof contentSha256 !== "string" ||
    !SHA256.test(contentSha256)
  ) {
    return undefined;
  }
  const normalized = {
    kind: "napier.operator-decision-cancelled" as const,
    schemaVersion: 1 as const,
    decisionId,
    requestedEventSeq: Number(requestedEventSeq),
    answeredEventSeq: Number(answeredEventSeq),
    reason: reason as OperatorDecisionCancellationReason,
    contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  return sha256(canonicalJson(content)) === contentSha256
    ? normalized
    : undefined;
}

export function parseOption(
  input: JsonValue,
  index: number,
): OperatorDecisionPayloadOption {
  if (!record(input)) throw new Error("Operator decision option is invalid");
  const id = input["id"];
  const label = input["label"];
  const description = input["description"];
  if (
    Object.keys(input).some(
      (key) => key !== "id" && key !== "label" && key !== "description",
    ) ||
    typeof id !== "string" ||
    id !== `option_${index + 1}` ||
    typeof label !== "string" ||
    typeof description !== "string"
  ) {
    throw new Error("Operator decision option is invalid");
  }
  return {
    id,
    label: boundedText(label, "option label", 256, 80),
    description: boundedText(description, "option description", 1024, 400),
  };
}

export function validAnswer(
  payload: OperatorDecisionAnsweredPayload,
  decision: OperatorDecision,
): boolean {
  try {
    const selectedOptionIds = normalizeSelectedOptionIds(
      payload.selectedOptionIds,
      decision,
    );
    return (
      selectedOptionIds.length > 0 ||
      Boolean(
        boundedOptionalText(
          payload.customText,
          "custom answer",
          MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES,
        ),
      )
    );
  } catch {
    return false;
  }
}

export function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function record(
  value: JsonValue,
): value is { [key: string]: JsonValue } {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
