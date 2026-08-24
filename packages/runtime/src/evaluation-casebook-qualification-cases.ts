import {
  type EvaluationCasebookCase,
  type EvaluationCasebookQualificationCaseResult,
  type EvaluationCasebookQualificationGate,
  type EvaluationCasebookQualificationStatus,
  type RunEvaluationVerdict,
} from "@napier/contracts";
import { type RunEvaluationJudgment } from "./evaluation.js";

const VERDICTS = new Set<RunEvaluationVerdict>([
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
]);
const EVIDENCE_STATES = new Set(["verified", "drifted", "missing"]);

export function qualificationCaseResult(
  item: EvaluationCasebookCase,
  judgment: RunEvaluationJudgment,
  observed: {
    observedLeftSnapshotSha256: string;
    observedRightSnapshotSha256: string;
  },
): EvaluationCasebookQualificationCaseResult {
  const agreement =
    judgment.verdict === item.adjudicationRevision.expectedVerdict;
  return {
    ...caseResultEvidence(item),
    actualVerdict: judgment.verdict,
    agreement,
    evidenceState: "verified",
    reason: judgment.reason,
    evidence: judgment.evidence,
    scores: structuredClone(judgment.scores),
    ...observed,
    status:
      judgment.verdict === "inconclusive"
        ? "inconclusive"
        : agreement
          ? "agreed"
          : "disagreed",
  };
}

export function failedCaseResult(
  item: EvaluationCasebookCase,
  evidenceState: "drifted" | "missing",
  reason: string,
  observed?: {
    observedLeftSnapshotSha256: string;
    observedRightSnapshotSha256: string;
  },
): EvaluationCasebookQualificationCaseResult {
  return {
    ...caseResultEvidence(item),
    actualVerdict: "inconclusive",
    agreement: false,
    evidenceState,
    reason,
    evidence: "",
    scores: [],
    ...(observed ?? {}),
    status: "inconclusive",
  };
}

export function caseResultEvidence(item: EvaluationCasebookCase) {
  return {
    caseId: item.id,
    sourceThreadId: item.sourceThreadId,
    sourceEvaluationId: item.sourceEvaluationId,
    caseSha256: item.contentSha256,
    evaluationSha256: item.adjudicationRevision.evaluationSha256,
    rubricSha256: item.rubricSha256,
    expectedVerdict: item.adjudicationRevision.expectedVerdict,
    expectedLeftSnapshotSha256: item.evaluation.leftSnapshotSha256,
    expectedRightSnapshotSha256: item.evaluation.rightSnapshotSha256,
  };
}

export function validateQualificationCaseResult(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(
      `Evaluation Casebook qualification judgment is invalid: ${item.id}`,
    );
  }
  const evidence = caseResultEvidence(item);
  for (const [key, expected] of Object.entries(evidence)) {
    if (
      result[key as keyof EvaluationCasebookQualificationCaseResult] !==
      expected
    ) {
      throw new Error(
        `Evaluation Casebook qualification case evidence is invalid: ${item.id}`,
      );
    }
  }
  assertQualificationCaseResultShape(result, item);
  assertQualificationObservedEvidence(result, item);
  assertQualificationEvidenceState(result, item);
  validateQualificationScores(result, item);
  if (result.status !== qualificationCaseStatus(result)) {
    throw new Error(
      `Evaluation Casebook qualification case status is invalid: ${item.id}`,
    );
  }
}

function assertQualificationCaseResultShape(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  const expectedAgreement =
    result.evidenceState === "verified" &&
    result.actualVerdict === result.expectedVerdict;
  if (
    !VERDICTS.has(result.actualVerdict) ||
    !EVIDENCE_STATES.has(result.evidenceState) ||
    result.agreement !== expectedAgreement ||
    !Array.isArray(result.scores) ||
    typeof result.reason !== "string" ||
    !result.reason.trim() ||
    result.reason.length > 2_000 ||
    typeof result.evidence !== "string" ||
    result.evidence.length > 2_000
  ) {
    throw new Error(
      `Evaluation Casebook qualification judgment is invalid: ${item.id}`,
    );
  }
}

function assertQualificationObservedEvidence(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  const observedLeft = result.observedLeftSnapshotSha256;
  const observedRight = result.observedRightSnapshotSha256;
  if (
    (observedLeft !== undefined && !/^[a-f0-9]{64}$/.test(observedLeft)) ||
    (observedRight !== undefined && !/^[a-f0-9]{64}$/.test(observedRight))
  ) {
    throw new Error(
      `Evaluation Casebook qualification observed evidence is invalid: ${item.id}`,
    );
  }
}

function assertQualificationEvidenceState(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  const observedLeft = result.observedLeftSnapshotSha256;
  const observedRight = result.observedRightSnapshotSha256;
  if (
    result.evidenceState === "verified" &&
    (observedLeft !== result.expectedLeftSnapshotSha256 ||
      observedRight !== result.expectedRightSnapshotSha256)
  ) {
    throw new Error(
      `Evaluation Casebook qualification verified evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState === "drifted" &&
    (!observedLeft ||
      !observedRight ||
      (observedLeft === result.expectedLeftSnapshotSha256 &&
        observedRight === result.expectedRightSnapshotSha256))
  ) {
    throw new Error(
      `Evaluation Casebook qualification drift evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState === "missing" &&
    (observedLeft !== undefined || observedRight !== undefined)
  ) {
    throw new Error(
      `Evaluation Casebook qualification missing evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState !== "verified" &&
    (result.actualVerdict !== "inconclusive" ||
      result.agreement ||
      result.scores.length > 0 ||
      result.evidence.length > 0)
  ) {
    throw new Error(
      `Evaluation Casebook qualification unverified judgment is invalid: ${item.id}`,
    );
  }
}

function qualificationCaseStatus(
  result: EvaluationCasebookQualificationCaseResult,
): EvaluationCasebookQualificationCaseResult["status"] {
  return result.evidenceState !== "verified" ||
    result.actualVerdict === "inconclusive"
    ? "inconclusive"
    : result.agreement
      ? "agreed"
      : "disagreed";
}

export function validateQualificationScores(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  if (
    result.evidenceState !== "verified" ||
    result.actualVerdict === "inconclusive"
  ) {
    if (result.scores.length !== 0) {
      throw new Error(
        `Evaluation Casebook qualification scores are invalid: ${item.id}`,
      );
    }
    return;
  }
  if (result.scores.length !== item.evaluation.rubric.criteria.length) {
    throw new Error(
      `Evaluation Casebook qualification scores are invalid: ${item.id}`,
    );
  }
  for (const [index, criterion] of item.evaluation.rubric.criteria.entries()) {
    const score = result.scores[index];
    if (
      !score ||
      score.criterionId !== criterion.id ||
      !Number.isInteger(score.leftScore) ||
      score.leftScore < 1 ||
      score.leftScore > 5 ||
      !Number.isInteger(score.rightScore) ||
      score.rightScore < 1 ||
      score.rightScore > 5 ||
      typeof score.reason !== "string" ||
      !score.reason.trim() ||
      score.reason.length > 500
    ) {
      throw new Error(
        `Evaluation Casebook qualification scores are invalid: ${item.id}`,
      );
    }
  }
}

export function qualificationStatus(
  gate: EvaluationCasebookQualificationGate,
  sampleCount: number,
  agreementRate: number,
  inconclusiveCount: number,
  unverifiedCount: number,
): EvaluationCasebookQualificationStatus {
  if (
    sampleCount === 0 ||
    unverifiedCount > 0 ||
    (!gate.allowInconclusive && inconclusiveCount > 0)
  ) {
    return "inconclusive";
  }
  return agreementRate >= gate.minimumAgreementRate ? "passed" : "failed";
}
