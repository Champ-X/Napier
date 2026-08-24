import {
  type EvaluationQualificationBaseline,
  type RunEvent,
} from "@napier/contracts";
import { validateEvaluationAdjudication } from "./evaluation-calibration.js";
import { validateEvaluationCasebookQualificationExecution } from "./evaluation-casebook-qualification.js";
import { migrateLegacyEvaluationCasebook } from "./evaluation-casebooks.js";
import {
  validateEvaluationConsensusResolution,
  validateEvaluationReviewerBallot,
} from "./evaluation-consensus.js";
import { validatePersistedRunEvaluation } from "./evaluation-record-validation.js";
import {
  assertEvaluationSuiteRuns,
  normalizePersistedEvaluationSuite,
  validateEvaluationSuiteExecution,
} from "./evaluation-suite-validation.js";
import {
  MAX_QUALIFICATION_BASELINES_PER_CASEBOOK,
  validateEvaluationQualificationBaseline,
} from "./receipt-trust-envelopes.js";
import type { PersistedStoreState } from "./store-state.js";
export function validatePersistedEvaluationState(
  state: PersistedStoreState,
  sourceBindingEvents?: readonly RunEvent[],
): void {
  validateEvaluationRecords(state, sourceBindingEvents);
  validateAdjudications(state);
  validateReviewerBallots(state);
  validateConsensusResolutions(state);
  validateConsensusProvenance(state);
  validateCasebooks(state);
  validateQualificationExecutions(state);
  validateQualificationBaselines(state);
  validateSuites(state);
  validateSuiteExecutions(state);
}

function validateEvaluationRecords(
  state: PersistedStoreState,
  sourceBindingEvents?: readonly RunEvent[],
): void {
  const evaluationIds = new Set<string>();
  for (const evaluation of state.evaluations) {
    if (evaluationIds.has(evaluation.id)) {
      throw new Error(`Duplicate persisted Run evaluation: ${evaluation.id}`);
    }
    evaluationIds.add(evaluation.id);
    validatePersistedRunEvaluation(
      evaluation,
      state.threads,
      state.runs,
      state.subagents,
      sourceBindingEvents,
    );
  }
}

function validateAdjudications(state: PersistedStoreState): void {
  const adjudicationIds = new Set<string>();
  const adjudicatedEvaluationIds = new Set<string>();
  for (const adjudication of state.evaluationAdjudications) {
    if (adjudicationIds.has(adjudication.id)) {
      throw new Error(
        `Duplicate persisted evaluation adjudication: ${adjudication.id}`,
      );
    }
    if (adjudicatedEvaluationIds.has(adjudication.evaluationId)) {
      throw new Error(
        `Duplicate persisted adjudicated evaluation: ${adjudication.evaluationId}`,
      );
    }
    const evaluation = state.evaluations.find(
      (candidate) => candidate.id === adjudication.evaluationId,
    );
    if (!evaluation || evaluation.threadId !== adjudication.threadId) {
      throw new Error(
        `Persisted evaluation adjudication reference is invalid: ${adjudication.id}`,
      );
    }
    validateEvaluationAdjudication(adjudication, evaluation);
    adjudicationIds.add(adjudication.id);
    adjudicatedEvaluationIds.add(adjudication.evaluationId);
  }
}

function validateReviewerBallots(state: PersistedStoreState): void {
  const reviewerBallotIds = new Set<string>();
  const reviewerLaneKeys = new Set<string>();
  for (const ballot of state.evaluationReviewerBallots) {
    const evaluation = state.evaluations.find(
      (candidate) => candidate.id === ballot.evaluationId,
    );
    const laneKey = `${ballot.evaluationId}:${ballot.reviewerId}`;
    if (
      reviewerBallotIds.has(ballot.id) ||
      reviewerLaneKeys.has(laneKey) ||
      !evaluation ||
      evaluation.threadId !== ballot.threadId
    ) {
      throw new Error(
        `Persisted evaluation reviewer ballot is invalid: ${ballot.id}`,
      );
    }
    validateEvaluationReviewerBallot(ballot, evaluation);
    reviewerBallotIds.add(ballot.id);
    reviewerLaneKeys.add(laneKey);
  }
}

function validateConsensusResolutions(state: PersistedStoreState): void {
  const consensusResolutionIds = new Set<string>();
  const consensusReportHashes = new Set<string>();
  for (const resolution of state.evaluationConsensusResolutions) {
    const evaluation = state.evaluations.find(
      (candidate) => candidate.id === resolution.evaluationId,
    );
    const adjudication = state.evaluationAdjudications.find(
      (candidate) => candidate.id === resolution.adjudicationId,
    );
    const reportKey = `${resolution.evaluationId}:${resolution.report.contentSha256}`;
    if (
      consensusResolutionIds.has(resolution.id) ||
      consensusReportHashes.has(reportKey) ||
      !evaluation ||
      !adjudication ||
      evaluation.threadId !== resolution.threadId
    ) {
      throw new Error(
        `Persisted evaluation consensus resolution is invalid: ${resolution.id}`,
      );
    }
    validateEvaluationConsensusResolution(
      resolution,
      evaluation,
      state.evaluationReviewerBallots.filter(
        (ballot) => ballot.evaluationId === evaluation.id,
      ),
      adjudication,
    );
    consensusResolutionIds.add(resolution.id);
    consensusReportHashes.add(reportKey);
  }
}

function validateConsensusProvenance(state: PersistedStoreState): void {
  for (const adjudication of state.evaluationAdjudications) {
    for (const revision of adjudication.revisions) {
      if (
        revision.source === "reviewer_consensus" &&
        !state.evaluationConsensusResolutions.some(
          (resolution) =>
            resolution.adjudicationId === adjudication.id &&
            resolution.adjudicationRevision.revision === revision.revision &&
            resolution.report.contentSha256 === revision.sourceSha256,
        )
      ) {
        throw new Error(
          `Persisted consensus adjudication provenance is missing: ${adjudication.id}@${revision.revision}`,
        );
      }
    }
  }
}

function validateCasebooks(state: PersistedStoreState): void {
  const casebookIds = new Set<string>();
  for (const input of state.evaluationCasebooks) {
    const casebook = migrateLegacyEvaluationCasebook(input);
    if (casebookIds.has(casebook.id)) {
      throw new Error(
        `Duplicate persisted Evaluation Casebook: ${casebook.id}`,
      );
    }
    casebookIds.add(casebook.id);
    Object.assign(input, casebook);
  }
}

function validateQualificationExecutions(state: PersistedStoreState): void {
  const casebookQualificationExecutionIds = new Set<string>();
  for (const execution of state.evaluationCasebookQualificationExecutions) {
    if (casebookQualificationExecutionIds.has(execution.id)) {
      throw new Error(
        `Duplicate persisted Evaluation Casebook qualification execution: ${execution.id}`,
      );
    }
    const casebook = state.evaluationCasebooks.find(
      (candidate) => candidate.id === execution.casebookId,
    );
    if (
      !casebook ||
      !state.threads.some((thread) => thread.id === execution.auditThreadId)
    ) {
      throw new Error(
        `Persisted Evaluation Casebook qualification reference is invalid: ${execution.id}`,
      );
    }
    validateEvaluationCasebookQualificationExecution(execution, casebook);
    casebookQualificationExecutionIds.add(execution.id);
  }
}

function validateQualificationBaselines(state: PersistedStoreState): void {
  const qualificationBaselineIds = new Set<string>();
  const qualificationBaselineKeys = new Set<string>();
  const latestBaselineByCasebook = new Map<
    string,
    EvaluationQualificationBaseline
  >();
  const baselineCountByCasebook = new Map<string, number>();
  for (const baseline of state.evaluationQualificationBaselines) {
    validateEvaluationQualificationBaseline(
      baseline,
      state.receiptTrustAnchors,
    );
    const previous = latestBaselineByCasebook.get(baseline.casebookId);
    const baselineKey = `${baseline.casebookId}:${baseline.casebookRevision}:${baseline.envelope.receipt.contentSha256}:${baseline.envelope.signature.keyId}`;
    const count = (baselineCountByCasebook.get(baseline.casebookId) ?? 0) + 1;
    if (
      qualificationBaselineIds.has(baseline.id) ||
      qualificationBaselineKeys.has(baselineKey) ||
      count > MAX_QUALIFICATION_BASELINES_PER_CASEBOOK ||
      !state.evaluationCasebooks.some(
        (casebook) => casebook.id === baseline.casebookId,
      ) ||
      !state.threads.some(
        (thread) => thread.id === baseline.promotedByThreadId,
      ) ||
      !state.evaluationCasebookQualificationExecutions.some(
        (execution) =>
          execution.id === baseline.qualificationExecutionId &&
          execution.casebookId === baseline.casebookId &&
          execution.contentSha256 === baseline.qualificationExecutionSha256,
      ) ||
      baseline.supersedesBaselineId !== previous?.id
    ) {
      throw new Error(
        `Persisted Evaluation qualification baseline is invalid: ${baseline.id}`,
      );
    }
    qualificationBaselineIds.add(baseline.id);
    qualificationBaselineKeys.add(baselineKey);
    latestBaselineByCasebook.set(baseline.casebookId, baseline);
    baselineCountByCasebook.set(baseline.casebookId, count);
  }
}

function validateSuites(state: PersistedStoreState): void {
  const suiteIds = new Set<string>();
  for (const suite of state.evaluationSuites) {
    normalizePersistedEvaluationSuite(suite);
    if (suiteIds.has(suite.id)) {
      throw new Error(`Duplicate persisted evaluation suite: ${suite.id}`);
    }
    suiteIds.add(suite.id);
    if (!state.threads.some((thread) => thread.id === suite.threadId)) {
      throw new Error(
        `Persisted evaluation suite thread is missing: ${suite.id}`,
      );
    }
    assertEvaluationSuiteRuns(state.runs, suite);
  }
}

function validateSuiteExecutions(state: PersistedStoreState): void {
  const executionIds = new Set<string>();
  for (const execution of state.evaluationSuiteExecutions) {
    if (executionIds.has(execution.id)) {
      throw new Error(
        `Duplicate persisted evaluation suite execution: ${execution.id}`,
      );
    }
    executionIds.add(execution.id);
    validateEvaluationSuiteExecution(
      execution,
      state.evaluationSuites,
      state.evaluations,
      state.runs,
    );
  }
}
