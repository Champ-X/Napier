import type { ModelRef } from "./execution-core.js";
import type { RunEvaluationGovernanceBinding } from "./run-observability-v1.js";

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
}

export interface EvaluationRubricSnapshot {
  name: string;
  criteria: EvaluationCriterion[];
}

export interface EvaluationCriterionScore {
  criterionId: string;
  leftScore: number;
  rightScore: number;
  reason: string;
}

export type RunEvaluationVerdict = "left_better" | "right_better" | "tie" | "inconclusive";

export interface RunEvaluationRecord {
  id: string;
  threadId: string;
  leftRunId: string;
  rightRunId: string;
  leftSnapshotSha256: string;
  rightSnapshotSha256: string;
  rubric: EvaluationRubricSnapshot;
  scores: EvaluationCriterionScore[];
  verdict: RunEvaluationVerdict;
  reason: string;
  evidence: string;
  evaluatorModel: ModelRef;
  comparisonGovernance?: RunEvaluationGovernanceBinding;
  createdAt: string;
}

export interface CreateRunEvaluationRequest {
  leftRunId: string;
  rightRunId: string;
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
}

export interface EvaluationAdjudicationRevision {
  revision: number;
  expectedVerdict: RunEvaluationVerdict;
  note: string;
  evaluationSha256: string;
  source?: "reviewer_consensus";
  sourceSha256?: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationAdjudication {
  id: string;
  threadId: string;
  evaluationId: string;
  revisions: EvaluationAdjudicationRevision[];
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRunEvaluationRequest {
  expectedVerdict: RunEvaluationVerdict;
  note?: string;
  source?: "reviewer_consensus";
  sourceSha256?: string;
}

export interface EvaluationReviewerBallotRevision {
  revision: number;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  note: string;
  evaluationSha256: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationReviewerBallot {
  id: string;
  threadId: string;
  evaluationId: string;
  reviewerId: string;
  revisions: EvaluationReviewerBallotRevision[];
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitEvaluationReviewerBallotRequest {
  reviewerId: string;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  note?: string;
}

export interface EvaluationConsensusGate {
  minimumReviewers: number;
  minimumAgreementRate: number;
  allowInconclusive: boolean;
}

export interface EvaluationConsensusVote {
  ballotId: string;
  ballotRevision: number;
  reviewerId: string;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  ballotSha256: string;
}

export type EvaluationConsensusStatus = "ready" | "insufficient_reviewers" | "no_consensus" | "inconclusive";

export interface EvaluationConsensusReport {
  kind: "napier.evaluation-consensus";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  evaluationId: string;
  evaluationSha256: string;
  gate: EvaluationConsensusGate;
  votes: EvaluationConsensusVote[];
  verdictCounts: Record<RunEvaluationVerdict, number>;
  reviewerCount: number;
  consensusVerdict?: RunEvaluationVerdict;
  consensusCount: number;
  agreementRate: number;
  status: EvaluationConsensusStatus;
  contentSha256: string;
}

export interface EvaluationConsensusResolution {
  id: string;
  threadId: string;
  evaluationId: string;
  evaluationSha256: string;
  report: EvaluationConsensusReport;
  adjudicationId: string;
  adjudicationRevision: EvaluationAdjudicationRevision;
  createdAt: string;
  contentSha256: string;
}

export interface ResolveEvaluationConsensusRequest {
  gate?: Partial<EvaluationConsensusGate>;
}

export interface ResolveEvaluationConsensusResult {
  report: EvaluationConsensusReport;
  resolution: EvaluationConsensusResolution;
  adjudication: EvaluationAdjudication;
  created: boolean;
}

export interface EvaluationCalibrationSample {
  evaluationId: string;
  adjudicationId: string;
  adjudicationRevision: number;
  evaluatorModel: ModelRef;
  rubricName: string;
  rubricSha256: string;
  modelVerdict: RunEvaluationVerdict;
  expectedVerdict: RunEvaluationVerdict;
  agreement: boolean;
  evaluationSha256: string;
  adjudicationSha256: string;
}

export type EvaluationConfusionMatrix = Record<RunEvaluationVerdict, Record<RunEvaluationVerdict, number>>;

export interface EvaluationCalibrationGroup {
  evaluatorModel: ModelRef;
  rubricName: string;
  rubricSha256: string;
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  confusionMatrix: EvaluationConfusionMatrix;
}

export interface EvaluationCalibrationReport {
  kind: "napier.evaluator-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  samples: EvaluationCalibrationSample[];
  groups: EvaluationCalibrationGroup[];
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  contentSha256: string;
}

export interface EvaluationCasebookCase {
  id: string;
  casebookId: string;
  templateCaseId?: string;
  sourceThreadId: string;
  sourceEvaluationId: string;
  sourceAdjudicationId: string;
  evaluation: RunEvaluationRecord;
  adjudicationRevision: EvaluationAdjudicationRevision;
  reviewerBallots?: EvaluationReviewerBallot[];
  consensusResolution?: EvaluationConsensusResolution;
  rubricSha256: string;
  createdAt: string;
  contentSha256: string;
}

export type EvaluationCasebookRevisionSource = "created" | "metadata_updated" | "case_curated" | "case_refreshed" | "case_removed";

export interface EvaluationCasebookRevision {
  revision: number;
  templateId?: string;
  name: string;
  description: string;
  caseIds: string[];
  source: EvaluationCasebookRevisionSource;
  caseId?: string;
  sourceEvaluationId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationCasebook {
  id: string;
  templateId?: string;
  currentRevision: number;
  cases: EvaluationCasebookCase[];
  revisions: EvaluationCasebookRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvaluationCasebookRequest {
  threadId: string;
  name: string;
  description?: string;
  templateId?: string;
}

export interface UpdateEvaluationCasebookRequest {
  threadId: string;
  name?: string;
  description?: string;
}

export interface CurateEvaluationCaseRequest {
  threadId: string;
  evaluationId: string;
  templateCaseId?: string;
}

export interface RemoveEvaluationCaseRequest {
  threadId: string;
}

export interface EvaluationCasebookCalibrationReport {
  kind: "napier.evaluation-casebook-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebookId: string;
  casebookRevision: number;
  samples: EvaluationCalibrationSample[];
  groups: EvaluationCalibrationGroup[];
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  contentSha256: string;
}

export interface EvaluationCasebookArtifact {
  kind: "napier.evaluation-casebook";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebook: EvaluationCasebook;
  calibration: EvaluationCasebookCalibrationReport;
  contentSha256: string;
}

export interface EvaluationCasebookQualificationGate {
  minimumAgreementRate: number;
  allowInconclusive: boolean;
}

export type EvaluationCasebookEvidenceState = "verified" | "drifted" | "missing";

export type EvaluationCasebookQualificationCaseStatus = "agreed" | "disagreed" | "inconclusive";

export interface EvaluationCasebookQualificationCaseResult {
  caseId: string;
  sourceThreadId: string;
  sourceEvaluationId: string;
  caseSha256: string;
  evaluationSha256: string;
  rubricSha256: string;
  expectedVerdict: RunEvaluationVerdict;
  actualVerdict: RunEvaluationVerdict;
  agreement: boolean;
  evidenceState: EvaluationCasebookEvidenceState;
  reason: string;
  evidence: string;
  scores: EvaluationCriterionScore[];
  expectedLeftSnapshotSha256: string;
  expectedRightSnapshotSha256: string;
  observedLeftSnapshotSha256?: string;
  observedRightSnapshotSha256?: string;
  status: EvaluationCasebookQualificationCaseStatus;
}

export type EvaluationCasebookQualificationStatus = "passed" | "failed" | "inconclusive";

export interface EvaluationCasebookQualificationExecution {
  id: string;
  casebookId: string;
  casebookRevision: number;
  casebookRevisionSha256: string;
  auditThreadId: string;
  name: string;
  evaluatorModel: ModelRef;
  gate: EvaluationCasebookQualificationGate;
  caseIds: string[];
  results: EvaluationCasebookQualificationCaseResult[];
  sampleCount: number;
  agreementCount: number;
  inconclusiveCount: number;
  unverifiedCount: number;
  agreementRate: number;
  status: EvaluationCasebookQualificationStatus;
  contentSha256: string;
  startedAt: string;
  finishedAt: string;
}

export interface ExecuteEvaluationCasebookRequest {
  threadId: string;
  model: ModelRef;
  gate?: Partial<EvaluationCasebookQualificationGate>;
}

export type EvaluationCasebookQualificationState = EvaluationCasebookQualificationStatus | "not_run";

export interface EvaluationCasebookQualificationReceipt {
  kind: "napier.evaluation-casebook-qualification-receipt";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebook: EvaluationCasebook;
  state: EvaluationCasebookQualificationState;
  execution?: EvaluationCasebookQualificationExecution;
  contentSha256: string;
}

export interface EvaluationSuiteGate {
  minimumPassRate: number;
  minimumCandidateScore: number;
  allowInconclusive: boolean;
}

export interface EvaluationSuite {
  id: string;
  threadId: string;
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric: EvaluationRubricSnapshot;
  evaluatorModel: ModelRef;
  gate: EvaluationSuiteGate;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvaluationSuiteRequest {
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
  gate?: Partial<EvaluationSuiteGate>;
}

export interface UpdateEvaluationSuiteRequest {
  name?: string;
  baselineRunId?: string;
  candidateRunIds?: string[];
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
  gate?: Partial<EvaluationSuiteGate>;
}

export type EvaluationSuiteCaseStatus = "passed" | "failed" | "inconclusive";

export interface EvaluationSuiteCaseResult {
  candidateRunId: string;
  evaluationId: string;
  evaluationSha256: string;
  verdict: RunEvaluationVerdict;
  baselineSnapshotSha256: string;
  candidateSnapshotSha256: string;
  baselineAverageScore?: number;
  candidateAverageScore?: number;
  status: EvaluationSuiteCaseStatus;
}

export type EvaluationSuiteExecutionStatus = "passed" | "failed" | "inconclusive";

export interface EvaluationSuiteExecution {
  id: string;
  suiteId: string;
  suiteRevision: number;
  threadId: string;
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric: EvaluationRubricSnapshot;
  evaluatorModel: ModelRef;
  gate: EvaluationSuiteGate;
  results: EvaluationSuiteCaseResult[];
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  passRate: number;
  averageCandidateScore?: number;
  status: EvaluationSuiteExecutionStatus;
  contentSha256: string;
  startedAt: string;
  finishedAt: string;
}

export type EvaluationSuiteGateState = EvaluationSuiteExecutionStatus | "not_run";

export interface EvaluationSuiteGateReceipt {
  kind: "napier.evaluation-gate-receipt";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  suite: EvaluationSuite;
  state: EvaluationSuiteGateState;
  evaluations: RunEvaluationRecord[];
  execution?: EvaluationSuiteExecution;
  contentSha256: string;
}
