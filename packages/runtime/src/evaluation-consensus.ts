import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type EvaluationAdjudication,
  type EvaluationConsensusGate,
  type EvaluationConsensusReport,
  type EvaluationConsensusResolution,
  type EvaluationConsensusStatus,
  type EvaluationConsensusVote,
  type EvaluationReviewerBallot,
  type EvaluationReviewerBallotRevision,
  type ReviewRunEvaluationRequest,
  type RunEvaluationRecord,
  type RunEvaluationVerdict,
  type SubmitEvaluationReviewerBallotRequest,
} from "@napier/contracts";

import {
  hashEvaluationAdjudicationRevision,
  validateEvaluationAdjudication,
} from "./evaluation-calibration.js";
import { hashRunEvaluation } from "./evaluation-suites.js";
import { createId, nowIso } from "./ids.js";

export const MAX_EVALUATION_REVIEWERS = 9;
export const MAX_EVALUATION_REVIEWER_REVISIONS = 50;
export const MAX_EVALUATION_CONSENSUS_RESOLUTIONS = 50;

export const DEFAULT_EVALUATION_CONSENSUS_GATE: EvaluationConsensusGate = {
  minimumReviewers: 2,
  minimumAgreementRate: 2 / 3,
  allowInconclusive: false,
};

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

export function normalizeEvaluationConsensusGate(
  input: Partial<EvaluationConsensusGate> | undefined,
): EvaluationConsensusGate {
  const gate = {
    ...DEFAULT_EVALUATION_CONSENSUS_GATE,
    ...input,
  };
  if (
    !Number.isInteger(gate.minimumReviewers) ||
    gate.minimumReviewers < 2 ||
    gate.minimumReviewers > MAX_EVALUATION_REVIEWERS
  ) {
    throw new Error(
      `Evaluation consensus requires 2-${MAX_EVALUATION_REVIEWERS} reviewers`,
    );
  }
  if (
    !Number.isFinite(gate.minimumAgreementRate) ||
    gate.minimumAgreementRate < 0.5 ||
    gate.minimumAgreementRate > 1
  ) {
    throw new Error(
      "Evaluation consensus agreement rate must be between 0.5 and 1",
    );
  }
  if (typeof gate.allowInconclusive !== "boolean") {
    throw new Error("Evaluation consensus inconclusive policy is invalid");
  }
  return gate;
}

export function createEvaluationConsensusReport(
  evaluation: RunEvaluationRecord,
  ballotInputs: EvaluationReviewerBallot[],
  gateInput?: Partial<EvaluationConsensusGate>,
  generatedAt = new Date(),
): EvaluationConsensusReport {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Evaluation consensus generation time is invalid");
  }
  const gate = normalizeEvaluationConsensusGate(gateInput);
  const ballots = ballotInputs
    .map((ballot) => validateEvaluationReviewerBallot(ballot, evaluation))
    .sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  assertUniqueReviewerLanes(ballots);
  if (ballots.length > MAX_EVALUATION_REVIEWERS) {
    throw new Error(
      `Evaluation consensus exceeds ${MAX_EVALUATION_REVIEWERS} reviewers`,
    );
  }
  const votes = ballots.map((ballot): EvaluationConsensusVote => {
    const revision = ballot.revisions.at(-1)!;
    return {
      ballotId: ballot.id,
      ballotRevision: revision.revision,
      reviewerId: ballot.reviewerId,
      reviewerName: revision.reviewerName,
      expectedVerdict: revision.expectedVerdict,
      ballotSha256: revision.contentSha256,
    };
  });
  return buildEvaluationConsensusReport(evaluation, votes, gate, generatedAt);
}

export function hashEvaluationConsensusReport(
  input: Omit<EvaluationConsensusReport, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateEvaluationConsensusReport(
  input: EvaluationConsensusReport,
  evaluation: RunEvaluationRecord,
  ballotInputs: EvaluationReviewerBallot[],
  options: { requireCurrent?: boolean } = {},
): EvaluationConsensusReport {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.kind !== "napier.evaluation-consensus" ||
    input.schemaVersion !== 1 ||
    input.apiVersion !== NAPIER_API_VERSION ||
    input.threadId !== evaluation.threadId ||
    input.evaluationId !== evaluation.id ||
    input.evaluationSha256 !== hashRunEvaluation(evaluation) ||
    !Array.isArray(input.votes) ||
    input.votes.length > MAX_EVALUATION_REVIEWERS ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256)
  ) {
    throw new Error("Evaluation consensus report is invalid");
  }
  const gate = normalizeEvaluationConsensusGate(input.gate);
  if (JSON.stringify(input.gate) !== JSON.stringify(gate)) {
    throw new Error("Evaluation consensus report gate is invalid");
  }
  const ballots = ballotInputs.map((ballot) =>
    validateEvaluationReviewerBallot(ballot, evaluation),
  );
  assertUniqueReviewerLanes(ballots);
  const ballotById = new Map(ballots.map((ballot) => [ballot.id, ballot]));
  const reviewerIds = new Set<string>();
  for (const vote of input.votes) {
    const ballot = ballotById.get(vote.ballotId);
    const revision = ballot?.revisions.find(
      (candidate) => candidate.revision === vote.ballotRevision,
    );
    if (
      !ballot ||
      !revision ||
      reviewerIds.has(vote.reviewerId) ||
      vote.reviewerId !== ballot.reviewerId ||
      vote.reviewerName !== revision.reviewerName ||
      vote.expectedVerdict !== revision.expectedVerdict ||
      vote.ballotSha256 !== revision.contentSha256 ||
      (options.requireCurrent !== false &&
        vote.ballotRevision !== ballot.currentRevision)
    ) {
      throw new Error("Evaluation consensus vote is invalid");
    }
    reviewerIds.add(vote.reviewerId);
  }
  const sortedVotes = input.votes
    .slice()
    .sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  if (JSON.stringify(input.votes) !== JSON.stringify(sortedVotes)) {
    throw new Error("Evaluation consensus votes are not canonical");
  }
  const expected = summarizeVotes(input.votes, gate);
  if (
    JSON.stringify(input.verdictCounts) !==
      JSON.stringify(expected.verdictCounts) ||
    input.reviewerCount !== expected.reviewerCount ||
    input.consensusVerdict !== expected.consensusVerdict ||
    input.consensusCount !== expected.consensusCount ||
    input.agreementRate !== expected.agreementRate ||
    input.status !== expected.status
  ) {
    throw new Error("Evaluation consensus aggregate is invalid");
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = input;
  if (hashEvaluationConsensusReport(content) !== input.contentSha256) {
    throw new Error("Evaluation consensus report hash mismatch");
  }
  return structuredClone(input);
}

export function consensusAdjudicationRequest(
  report: EvaluationConsensusReport,
): ReviewRunEvaluationRequest {
  if (report.status !== "ready" || !report.consensusVerdict) {
    throw new Error("Evaluation consensus is not ready for resolution");
  }
  return {
    expectedVerdict: report.consensusVerdict,
    note: `Resolved from ${report.reviewerCount}-reviewer consensus at ${Math.round(
      report.agreementRate * 100,
    )}% agreement.`,
    source: "reviewer_consensus",
    sourceSha256: report.contentSha256,
  };
}

export function createEvaluationConsensusResolution(
  evaluation: RunEvaluationRecord,
  report: EvaluationConsensusReport,
  adjudicationInput: EvaluationAdjudication,
): EvaluationConsensusResolution {
  const adjudication = validateEvaluationAdjudication(
    adjudicationInput,
    evaluation,
  );
  const revision = adjudication.revisions.at(-1)!;
  if (
    report.status !== "ready" ||
    !report.consensusVerdict ||
    revision.expectedVerdict !== report.consensusVerdict ||
    revision.source !== "reviewer_consensus" ||
    revision.sourceSha256 !== report.contentSha256
  ) {
    throw new Error("Evaluation consensus adjudication provenance is invalid");
  }
  const id = createId("consensus");
  const content = {
    threadId: evaluation.threadId,
    evaluationId: evaluation.id,
    evaluationSha256: hashRunEvaluation(evaluation),
    report: structuredClone(report),
    adjudicationId: adjudication.id,
    adjudicationRevision: structuredClone(revision),
    createdAt: nowIso(),
  };
  return {
    id,
    ...content,
    contentSha256: hashEvaluationConsensusResolution(id, content),
  };
}

export function hashEvaluationConsensusResolution(
  resolutionId: string,
  input: Omit<EvaluationConsensusResolution, "id" | "contentSha256">,
): string {
  return sha256(canonicalJson({ resolutionId, ...input }));
}

export function validateEvaluationConsensusResolution(
  input: EvaluationConsensusResolution,
  evaluation: RunEvaluationRecord,
  ballots: EvaluationReviewerBallot[],
  adjudicationInput: EvaluationAdjudication,
): EvaluationConsensusResolution {
  const adjudication = validateEvaluationAdjudication(
    adjudicationInput,
    evaluation,
  );
  const revision = adjudication.revisions.find(
    (candidate) => candidate.revision === input.adjudicationRevision.revision,
  );
  if (!revision) {
    throw new Error("Evaluation consensus resolution adjudication is invalid");
  }
  return validateEvaluationConsensusResolutionEvidence(
    input,
    evaluation,
    ballots,
    adjudication.id,
    revision,
  );
}

export function validateEvaluationConsensusResolutionEvidence(
  input: EvaluationConsensusResolution,
  evaluation: RunEvaluationRecord,
  ballots: EvaluationReviewerBallot[],
  adjudicationId: string,
  adjudicationRevision: EvaluationAdjudication["revisions"][number],
): EvaluationConsensusResolution {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !/^consensus_[a-z0-9]{8,80}$/.test(input.id) ||
    input.threadId !== evaluation.threadId ||
    input.evaluationId !== evaluation.id ||
    input.evaluationSha256 !== hashRunEvaluation(evaluation) ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256)
  ) {
    throw new Error("Evaluation consensus resolution is invalid");
  }
  const report = validateEvaluationConsensusReport(
    input.report,
    evaluation,
    ballots,
    { requireCurrent: false },
  );
  const { contentSha256: adjudicationSha256, ...adjudicationContent } =
    adjudicationRevision;
  if (
    report.status !== "ready" ||
    !report.consensusVerdict ||
    input.adjudicationId !== adjudicationId ||
    JSON.stringify(input.adjudicationRevision) !==
      JSON.stringify(adjudicationRevision) ||
    adjudicationRevision.expectedVerdict !== report.consensusVerdict ||
    adjudicationRevision.source !== "reviewer_consensus" ||
    adjudicationRevision.sourceSha256 !== report.contentSha256 ||
    hashEvaluationAdjudicationRevision(
      adjudicationId,
      evaluation.threadId,
      evaluation.id,
      adjudicationContent,
    ) !== adjudicationSha256 ||
    Date.parse(input.createdAt) < Date.parse(adjudicationRevision.createdAt)
  ) {
    throw new Error("Evaluation consensus resolution adjudication is invalid");
  }
  const { id: _id, contentSha256: _contentSha256, ...content } = input;
  if (
    hashEvaluationConsensusResolution(input.id, content) !== input.contentSha256
  ) {
    throw new Error("Evaluation consensus resolution hash mismatch");
  }
  return structuredClone(input);
}

function buildEvaluationConsensusReport(
  evaluation: RunEvaluationRecord,
  votes: EvaluationConsensusVote[],
  gate: EvaluationConsensusGate,
  generatedAt: Date,
): EvaluationConsensusReport {
  const summary = summarizeVotes(votes, gate);
  const content = {
    kind: "napier.evaluation-consensus" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    threadId: evaluation.threadId,
    evaluationId: evaluation.id,
    evaluationSha256: hashRunEvaluation(evaluation),
    gate,
    votes: structuredClone(votes),
    ...summary,
  };
  return {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: hashEvaluationConsensusReport(content),
  };
}

function summarizeVotes(
  votes: EvaluationConsensusVote[],
  gate: EvaluationConsensusGate,
): {
  verdictCounts: Record<RunEvaluationVerdict, number>;
  reviewerCount: number;
  consensusVerdict?: RunEvaluationVerdict;
  consensusCount: number;
  agreementRate: number;
  status: EvaluationConsensusStatus;
} {
  const verdictCounts = Object.fromEntries(
    VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<RunEvaluationVerdict, number>;
  for (const vote of votes) {
    normalizeVerdict(vote.expectedVerdict);
    verdictCounts[vote.expectedVerdict] += 1;
  }
  const reviewerCount = votes.length;
  const consensusCount = Math.max(0, ...Object.values(verdictCounts));
  const leaders = VERDICTS.filter(
    (verdict) =>
      consensusCount > 0 && verdictCounts[verdict] === consensusCount,
  );
  const consensusVerdict = leaders.length === 1 ? leaders[0] : undefined;
  const agreementRate =
    reviewerCount > 0 ? Number((consensusCount / reviewerCount).toFixed(4)) : 0;
  let status: EvaluationConsensusStatus;
  if (reviewerCount < gate.minimumReviewers) {
    status = "insufficient_reviewers";
  } else if (!consensusVerdict || agreementRate < gate.minimumAgreementRate) {
    status = "no_consensus";
  } else if (consensusVerdict === "inconclusive" && !gate.allowInconclusive) {
    status = "inconclusive";
  } else {
    status = "ready";
  }
  return {
    verdictCounts,
    reviewerCount,
    ...(consensusVerdict ? { consensusVerdict } : {}),
    consensusCount,
    agreementRate,
    status,
  };
}

function assertUniqueReviewerLanes(ballots: EvaluationReviewerBallot[]): void {
  const ids = new Set<string>();
  const reviewerIds = new Set<string>();
  for (const ballot of ballots) {
    if (ids.has(ballot.id) || reviewerIds.has(ballot.reviewerId)) {
      throw new Error("Evaluation reviewer lanes must be unique");
    }
    ids.add(ballot.id);
    reviewerIds.add(ballot.reviewerId);
  }
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
