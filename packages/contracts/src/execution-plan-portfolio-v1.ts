import type { ExecutionPlanBlueprintRecordOutcomeQualificationStatus, ExecutionPlanBlueprintRecordPreviewStatus, ExecutionPlanBlueprintRecordQualificationStatus, ExecutionPlanBlueprintRecordReplay, ExecutionPlanBlueprintRecordStatus } from "./execution-plan-blueprint-v1.js";

export type ExecutionPlanBlueprintRecommendationPolicyTemplateId = "balanced" | "delivery_first" | "portfolio_first";

export interface ExecutionPlanBlueprintRecommendationPolicyWeights {
  outcomeCompletionBps: number;
  familyCompletionBps: number;
  reviewedBaselineBps: number;
  replayEvidenceBps: number;
}

export interface ExecutionPlanBlueprintRecommendationPolicy {
  templateId: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  weights: ExecutionPlanBlueprintRecommendationPolicyWeights;
}

export type ExecutionPlanBlueprintRecommendationPolicySource = "default" | "request" | "family_override";

export interface SelectExecutionPlanBlueprintRecordRequest {
  objective?: string;
  policyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
}

export type ExecutionPlanBlueprintRecordSelectionCandidateStatus = "selected" | "qualified" | "rejected";

export interface ExecutionPlanBlueprintRecordSelectionCandidate {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecordStatus;
  recordUpdatedAt: string;
  selectionStatus: ExecutionPlanBlueprintRecordSelectionCandidateStatus;
  diagnostics: string[];
  blueprintSha256: string;
  familySha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  familyRecordCount: number;
  familyOutcomeQualifiedCount: number;
  familyReviewedBaselineCount: number;
  familyCompletionRateBps: number;
  recommendationScoreBps: number;
  recommendationPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  recommendationPolicySha256: string;
  recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource;
  familyPolicyOverrideSha256?: string;
  previewStatus?: ExecutionPlanBlueprintRecordPreviewStatus;
  previewSha256?: string;
  baselineId?: string;
  baselineSha256?: string;
  baselineOutcomesSha256?: string;
  baselinePromotedAt?: string;
  currentOutcomesSha256: string;
  currentReplayHistorySha256: string;
  currentOutcomeSetSha256: string;
  scoreBps: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  stepCount: number;
  artifactCount: number;
}

export interface ExecutionPlanBlueprintRecordSelection {
  kind: "napier.execution-plan-blueprint-selection";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  objectiveSha256?: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedPreviewSha256?: string;
  selectedBaselineId?: string;
  selectedBaselineSha256?: string;
  selectedScoreBps?: number;
  selectedFamilySha256?: string;
  selectedFamilyCompletionRateBps?: number;
  selectedRecommendationScoreBps?: number;
  selectedRecommendationPolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  selectedRecommendationPolicySha256?: string;
  selectedRecommendationPolicySource?: ExecutionPlanBlueprintRecommendationPolicySource;
  selectedFamilyPolicyOverrideSha256?: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  familyPolicyOverrideCount: number;
  familyPolicyOverrideSetSha256: string;
  portfolioSetSha256: string;
  selectionSetSha256: string;
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[];
  contentSha256: string;
}

export interface ExecutionPlanBlueprintPortfolioCalibrationFamily {
  familySha256: string;
  recordCount: number;
  activeCount: number;
  archivedCount: number;
  sourceQualifiedCount: number;
  outcomeQualifiedCount: number;
  reviewedBaselineCount: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  topRecordId?: string;
  topRecordScoreBps?: number;
  latestBaselineSha256?: string;
}

export interface ExecutionPlanBlueprintPortfolioCalibration {
  kind: "napier.execution-plan-blueprint-portfolio-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordCount: number;
  activeCount: number;
  archivedCount: number;
  familyCount: number;
  sourceQualifiedCount: number;
  outcomeQualifiedCount: number;
  reviewedBaselineCount: number;
  missingBaselineCount: number;
  policyFailedCount: number;
  portfolioSetSha256: string;
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyBacktestCandidateStatus = "selected" | "qualified" | "rejected";

export interface ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecordStatus;
  recordUpdatedAt: string;
  selectionStatus: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidateStatus;
  diagnostics: string[];
  familySha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  familyRecordCount: number;
  familyCompletionRateBps: number;
  familyReviewedBaselineCount: number;
  reviewedBaselineCoverageBps: number;
  replayEvidenceBps: number;
  recommendationScoreBps: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  currentOutcomesSha256: string;
  currentOutcomeSetSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyBacktestResult {
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedFamilySha256?: string;
  selectedRecommendationScoreBps?: number;
  averageRecommendationScoreBps: number;
  candidates: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate[];
}

export interface ExecutionPlanBlueprintRecommendationPolicyBacktest {
  kind: "napier.execution-plan-blueprint-recommendation-policy-backtest";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordCount: number;
  activeCount: number;
  policyCount: number;
  divergentSelectionCount: number;
  portfolioSetSha256: string;
  policySetSha256: string;
  results: ExecutionPlanBlueprintRecommendationPolicyBacktestResult[];
  contentSha256: string;
}

export interface SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest {
  familySha256: string;
  policyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  expectedPortfolioSetSha256?: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverride {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override";
  schemaVersion: 1;
  apiVersion: string;
  familySha256: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  portfolioSetSha256: string;
  familyRecordCount: number;
  familyOutcomeQualifiedCount: number;
  familyCompletionRateBps: number;
  updatedAt: string;
  contentSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideList {
  kind: "napier.execution-plan-blueprint-recommendation-policy-overrides";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  overrideCount: number;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftStatus = "aligned" | "retire_recommended" | "family_missing";

export type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftRecommendation = "keep" | "retire";

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  familySha256: string;
  overrideSha256: string;
  status: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftStatus;
  recommendation: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftRecommendation;
  diagnostics: string[];
  overridePolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  overridePolicySha256: string;
  overrideSelectedRecordId?: string;
  overrideSelectedRecommendationScoreBps?: number;
  bestPolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  bestPolicySha256?: string;
  bestSelectedRecordId?: string;
  bestSelectedRecommendationScoreBps?: number;
  familyRecordCount?: number;
  familyOutcomeQualifiedCount?: number;
  familyCompletionRateBps?: number;
  reviewSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  overrideCount: number;
  alignedCount: number;
  retireRecommendedCount: number;
  missingFamilyCount: number;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  reviewSetSha256: string;
  reviews: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem[];
  contentSha256: string;
}

export interface RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest {
  familySha256: string;
  expectedOverrideSha256: string;
  expectedOverrideSetSha256: string;
  expectedDriftReviewSetSha256: string;
  expectedPortfolioSetSha256: string;
}

export interface RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement";
  schemaVersion: 1;
  apiVersion: string;
  familySha256: string;
  retiredOverrideSha256: string;
  retiredRecommendationPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  retiredRecommendationPolicySha256: string;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  driftReviewSetSha256: string;
  remainingOverrideSetSha256: string;
  retiredAt: string;
  contentSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  retirementCount: number;
  portfolioSetSha256: string;
  currentOverrideSetSha256: string;
  retirementSetSha256: string;
  latestRetiredAt?: string;
  retirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[];
  contentSha256: string;
}

export interface VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest {
  history: unknown;
}

export type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationStatus;
  diagnostics: string[];
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  observedContentSha256: string;
  declaredPortfolioSetSha256?: string;
  observedPortfolioSetSha256: string;
  declaredCurrentOverrideSetSha256?: string;
  observedCurrentOverrideSetSha256: string;
  declaredRetirementSetSha256?: string;
  recomputedRetirementSetSha256?: string;
  observedRetirementSetSha256: string;
  retirementCount?: number;
  observedRetirementCount: number;
  latestRetiredAt?: string;
  observedLatestRetiredAt?: string;
  contentSha256: string;
}

export interface VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest {
  histories: unknown[];
}

export interface SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest {
  histories: unknown[];
  trustAnchorId: string;
  threadId: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleStatus = "aligned" | "divergent" | "invalid";

export type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItemStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem {
  index: number;
  status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItemStatus;
  diagnostics: string[];
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  declaredPortfolioSetSha256?: string;
  declaredCurrentOverrideSetSha256?: string;
  declaredRetirementSetSha256?: string;
  recomputedRetirementSetSha256?: string;
  retirementCount?: number;
  recomputedRetirementCount?: number;
  latestRetiredAt?: string;
  recomputedLatestRetiredAt?: string;
  itemSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleStatus;
  diagnostics: string[];
  historyCount: number;
  validHistoryCount: number;
  invalidHistoryCount: number;
  distinctHistoryCount: number;
  distinctPortfolioSetCount: number;
  distinctCurrentOverrideSetCount: number;
  distinctRetirementSetCount: number;
  historySetSha256: string;
  portfolioSetBundleSha256: string;
  currentOverrideSetBundleSha256: string;
  retirementSetBundleSha256: string;
  histories: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecordReplayEventVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintRecordReplayEventVerification {
  schemaVersion: 1;
  status: ExecutionPlanBlueprintRecordReplayEventVerificationStatus;
  diagnostics: string[];
  expectedRecordId: string;
  threadId: string;
  eventId: string;
  seq: number;
  declaredEventSha256: string;
  observedEventSha256?: string;
  observedReplay?: ExecutionPlanBlueprintRecordReplay;
  contentSha256: string;
}

export interface CreateExecutionPlanFromBlueprintRecordRequest {
  recordId: string;
  objective?: string;
  expectedPreviewSha256?: string;
}
