import type {
  JsonValue,
  OperatorDecision,
  OperatorDecisionCancellationReason,
} from "@napier/contracts";

export const MAX_OPERATOR_DECISION_QUESTION_BYTES = 4 * 1024;
export const MAX_OPERATOR_DECISION_CUSTOM_TEXT_BYTES = 4 * 1024;

export const SHA256 = /^[a-f0-9]{64}$/;

export const DECISION_ID = /^decision_[a-z0-9]{8,80}$/;

export const RUN_ID = /^run_[a-z0-9]{8,80}$/;

export const OPTION_ID = /^option_[1-4]$/;

export const CANCELLATION_REASONS = new Set<OperatorDecisionCancellationReason>(
  [
    "operator_cancelled",
    "workflow_timed_out",
    "run_completed_without_wait",
    "run_failed",
    "run_cancelled",
  ],
);

export interface OperatorDecisionPayloadOption extends Record<
  string,
  JsonValue
> {
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

export function normalizeSelectedOptionIds(
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

export function hasDistinctOptionLabels(
  options: ReadonlyArray<Pick<OperatorDecisionPayloadOption, "label">>,
): boolean {
  const labels = options.map((option) => option.label.toLowerCase());
  return new Set(labels).size === labels.length;
}

export function boundedText(
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

export function boundedOptionalText(
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
