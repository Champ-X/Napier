import type {
  AnswerOperatorDecisionRequest,
  JsonValue,
  OperatorDecision,
  OperatorDecisionCancellationReason,
  RequestOperatorDecisionInput,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
export { formatOperatorDecisionContinuation } from "./operator-decision-continuation.js";

export const OPERATOR_DECISION_REQUESTED_EVENT = "operator.decision.requested";
export const OPERATOR_DECISION_ANSWERED_EVENT = "operator.decision.answered";
export const OPERATOR_DECISION_CONTINUED_EVENT = "operator.decision.continued";
export const OPERATOR_DECISION_CANCELLED_EVENT = "operator.decision.cancelled";

export const MAX_OPERATOR_DECISIONS_PER_THREAD = 64;
export const MAX_OPERATOR_DECISION_QUESTION_BYTES = 4 * 1024;
export const MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES = 4 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const DECISION_ID = /^decision_[a-z0-9]{8,80}$/;
const RUN_ID = /^run_[a-z0-9]{8,80}$/;
const OPTION_ID = /^option_[1-4]$/;
const CANCELLATION_REASONS = new Set<OperatorDecisionCancellationReason>([
  "operator_cancelled",
  "workflow_timed_out",
  "run_completed_without_wait",
  "run_failed",
  "run_cancelled",
]);

interface OperatorDecisionPayloadOption extends Record<string, JsonValue> {
  id: string;
  label: string;
  description: string;
}

export interface OperatorDecisionRequestedPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.operator-decision-requested";
  schemaVersion: 1;
  decisionId: string;
  header: string;
  question: string;
  options: OperatorDecisionPayloadOption[];
  multiSelect: boolean;
  questionSha256: string;
  requestSha256: string;
}

export interface OperatorDecisionAnsweredPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.operator-decision-answered";
  schemaVersion: 1;
  decisionId: string;
  requestedEventSeq: number;
  selectedOptionIds: string[];
  customText: string;
  answerSha256: string;
  contentSha256: string;
}

export interface OperatorDecisionContinuedPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.operator-decision-continued";
  schemaVersion: 1;
  decisionId: string;
  requestedEventSeq: number;
  answeredEventSeq: number;
  continuationRunId: string;
}

export interface OperatorDecisionCancelledPayload extends Record<
  string,
  JsonValue
> {
  kind: "napier.operator-decision-cancelled";
  schemaVersion: 1;
  decisionId: string;
  requestedEventSeq: number;
  answeredEventSeq: number;
  reason: OperatorDecisionCancellationReason;
  contentSha256: string;
}

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

function parseRequestedPayload(
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

function parseAnsweredPayload(
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

function parseContinuedPayload(
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

function parseCancelledPayload(
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

function parseOption(
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

function validAnswer(
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

function normalizeSelectedOptionIds(
  values: string[],
  decision: Pick<OperatorDecision, "options" | "multiSelect">,
): string[] {
  if (!Array.isArray(values) || values.length > decision.options.length) {
    throw new Error("Operator decision selections are invalid");
  }
  const selected = [...new Set(values)];
  const validIds = new Set(decision.options.map((option) => option.id));
  if (
    selected.length !== values.length ||
    selected.some((optionId) => !validIds.has(optionId)) ||
    (!decision.multiSelect && selected.length > 1)
  ) {
    throw new Error("Operator decision selections are invalid");
  }
  return selected.sort((left, right) => left.localeCompare(right));
}

function hasDistinctOptionLabels(
  options: ReadonlyArray<Pick<OperatorDecisionPayloadOption, "label">>,
): boolean {
  const labels = options.map((option) => option.label.toLowerCase());
  return new Set(labels).size === labels.length;
}

function boundedText(
  value: string,
  label: string,
  maxBytes: number,
  maxCharacters?: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`Operator decision ${label} must be text`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.includes("\u0000") ||
    Buffer.byteLength(normalized, "utf8") > maxBytes ||
    (maxCharacters !== undefined && [...normalized].length > maxCharacters)
  ) {
    throw new Error(`Operator decision ${label} is invalid`);
  }
  return normalized;
}

function boundedOptionalText(
  value: string,
  label: string,
  maxBytes: number,
): string {
  const normalized = value.trim();
  if (
    normalized.includes("\u0000") ||
    Buffer.byteLength(normalized, "utf8") > maxBytes
  ) {
    throw new Error(`Operator decision ${label} is invalid`);
  }
  return normalized;
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

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function record(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
