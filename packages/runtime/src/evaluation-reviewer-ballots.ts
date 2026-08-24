import {
  type EvaluationReviewerBallot,
  type EvaluationReviewerBallotRevision,
  type RunEvaluationRecord,
  type RunEvaluationVerdict,
  type SubmitEvaluationReviewerBallotRequest,
} from "@napier/contracts";
import { createHash } from "node:crypto";
import { hashRunEvaluation } from "./evaluation-suites.js";
import { createId, nowIso } from "./ids.js";

export const MAX_EVALUATION_REVIEWER_REVISIONS = 50;

const VERDICTS: readonly RunEvaluationVerdict[] = [
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
];

export function submitEvaluationReviewerBallot(
  current: EvaluationReviewerBallot | undefined,
  evaluation: RunEvaluationRecord,
  request: SubmitEvaluationReviewerBallotRequest,
): EvaluationReviewerBallot {
  const reviewerId = normalizeReviewerId(request.reviewerId);
  const reviewerName = normalizeReviewerName(request.reviewerName);
  const expectedVerdict = normalizeVerdict(request.expectedVerdict);
  const note = normalizeNote(request.note);
  const evaluationSha256 = hashRunEvaluation(evaluation);
  if (current) {
    validateEvaluationReviewerBallot(current, evaluation);
    if (current.reviewerId !== reviewerId) {
      throw new Error("Evaluation reviewer lane cannot change reviewer ID");
    }
    const previous = current.revisions.at(-1)!;
    if (
      previous.reviewerName === reviewerName &&
      previous.expectedVerdict === expectedVerdict &&
      previous.note === note
    ) {
      return structuredClone(current);
    }
    if (current.revisions.length >= MAX_EVALUATION_REVIEWER_REVISIONS) {
      throw new Error(
        `Evaluation reviewer lane exceeds ${MAX_EVALUATION_REVIEWER_REVISIONS} revisions`,
      );
    }
  }
  const timestamp = nowIso();
  const id = current?.id ?? createId("reviewballot");
  const revisionNumber = (current?.currentRevision ?? 0) + 1;
  const content = {
    revision: revisionNumber,
    reviewerName,
    expectedVerdict,
    note,
    evaluationSha256,
    createdAt: timestamp,
  };
  const revision: EvaluationReviewerBallotRevision = {
    ...content,
    contentSha256: hashEvaluationReviewerBallotRevision(
      id,
      evaluation.threadId,
      evaluation.id,
      reviewerId,
      content,
    ),
  };
  const ballot: EvaluationReviewerBallot = current
    ? {
        ...structuredClone(current),
        revisions: [...current.revisions, revision],
        currentRevision: revisionNumber,
        updatedAt: timestamp,
      }
    : {
        id,
        threadId: evaluation.threadId,
        evaluationId: evaluation.id,
        reviewerId,
        revisions: [revision],
        currentRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  return validateEvaluationReviewerBallot(ballot, evaluation);
}

export function hashEvaluationReviewerBallotRevision(
  ballotId: string,
  threadId: string,
  evaluationId: string,
  reviewerId: string,
  revision: Omit<EvaluationReviewerBallotRevision, "contentSha256">,
): string {
  return sha256(
    canonicalJson({
      ballotId,
      threadId,
      evaluationId,
      reviewerId,
      ...revision,
    }),
  );
}

export function validateEvaluationReviewerBallot(
  input: EvaluationReviewerBallot,
  evaluation: RunEvaluationRecord,
): EvaluationReviewerBallot {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !/^reviewballot_[a-z0-9]{8,80}$/.test(input.id) ||
    input.threadId !== evaluation.threadId ||
    input.evaluationId !== evaluation.id ||
    input.reviewerId !== normalizeReviewerId(input.reviewerId) ||
    !Array.isArray(input.revisions) ||
    input.revisions.length < 1 ||
    input.revisions.length > MAX_EVALUATION_REVIEWER_REVISIONS ||
    input.currentRevision !== input.revisions.length ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    !Number.isFinite(Date.parse(input.updatedAt)) ||
    Date.parse(input.updatedAt) < Date.parse(input.createdAt)
  ) {
    throw new Error("Evaluation reviewer ballot is invalid");
  }
  const evaluationSha256 = hashRunEvaluation(evaluation);
  for (const [index, revision] of input.revisions.entries()) {
    normalizeVerdict(revision.expectedVerdict);
    if (
      revision.revision !== index + 1 ||
      revision.reviewerName !== normalizeReviewerName(revision.reviewerName) ||
      revision.note !== normalizeNote(revision.note) ||
      revision.evaluationSha256 !== evaluationSha256 ||
      !Number.isFinite(Date.parse(revision.createdAt)) ||
      !/^[a-f0-9]{64}$/.test(revision.contentSha256)
    ) {
      throw new Error("Evaluation reviewer ballot revision is invalid");
    }
    const { contentSha256: _contentSha256, ...content } = revision;
    if (
      hashEvaluationReviewerBallotRevision(
        input.id,
        input.threadId,
        input.evaluationId,
        input.reviewerId,
        content,
      ) !== revision.contentSha256
    ) {
      throw new Error("Evaluation reviewer ballot revision hash mismatch");
    }
  }
  if (
    input.createdAt !== input.revisions[0]!.createdAt ||
    input.updatedAt !== input.revisions.at(-1)!.createdAt
  ) {
    throw new Error("Evaluation reviewer ballot timestamps are invalid");
  }
  return structuredClone(input);
}

function normalizeReviewerId(value: string): string {
  const reviewerId = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(reviewerId)) {
    throw new Error("Evaluation reviewer ID is invalid");
  }
  return reviewerId;
}

function normalizeReviewerName(value: string): string {
  const reviewerName = value.replace(/\s+/g, " ").trim();
  if (!reviewerName || reviewerName.length > 80) {
    throw new Error("Evaluation reviewer name is invalid");
  }
  return reviewerName;
}

function normalizeVerdict(value: RunEvaluationVerdict): RunEvaluationVerdict {
  if (!VERDICTS.includes(value)) {
    throw new Error(`Evaluation reviewer verdict is invalid: ${value}`);
  }
  return value;
}

function normalizeNote(value: string | undefined): string {
  const note = (value ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 1_000) {
    throw new Error("Evaluation reviewer note exceeds 1000 characters");
  }
  return note;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
