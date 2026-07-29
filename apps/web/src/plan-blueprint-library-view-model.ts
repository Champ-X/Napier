import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintPortfolioCalibration,
  ExecutionPlanBlueprintRecommendationPolicyBacktest,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  TrustedReceiptEnvelope,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
} from "@napier/contracts";

export interface PlanBlueprintLibraryCreatedReceipt {
  action: "created";
  recordId: string;
  blueprintSha256: string;
  planId: string;
  stepCount: number;
  artifactCount: number;
  replayEventId?: string;
  replayEventSha256?: string;
  replayEventVerificationStatus: ExecutionPlanBlueprintRecordReplayEventVerification["status"];
  replayEventVerificationSha256?: string;
  replayEventDiagnostics: string[];
}

export interface PlanBlueprintLibraryReplayHistoryReceipt {
  action: "history";
  recordId: string;
  contentSha256: string;
  eventSetSha256: string;
  replayCount: number;
  threadCount: number;
  planCount: number;
  latestPlanId?: string;
  latestPreviewSha256?: string;
  stepCount: number;
  artifactCount: number;
}

export interface PlanBlueprintLibraryReplayHistoryVerificationReceipt {
  action: "historyVerified";
  recordId?: string;
  verificationStatus: ExecutionPlanBlueprintRecordReplayHistoryVerification["status"];
  diagnostics: string[];
  contentSha256: string;
  declaredContentSha256?: string;
  observedContentSha256?: string;
  declaredEventSetSha256?: string;
  observedEventSetSha256?: string;
  replayCount: number;
  threadCount: number;
  planCount: number;
}

export interface PlanBlueprintLibraryReplayOutcomesReceipt {
  action: "outcomes";
  recordId: string;
  contentSha256: string;
  replayHistorySha256: string;
  outcomeSetSha256: string;
  replayCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
  cancelledCount: number;
  invalidCount: number;
  completionRateBps: number;
  latestPlanId?: string;
  latestStatus?: ExecutionPlanBlueprintRecordReplayOutcomes["outcomes"][number]["status"];
}

export interface PlanBlueprintLibraryReplayOutcomesVerificationReceipt {
  action: "outcomesVerified";
  recordId?: string;
  verificationStatus: ExecutionPlanBlueprintRecordReplayOutcomesVerification["status"];
  diagnostics: string[];
  contentSha256: string;
  declaredContentSha256?: string;
  observedContentSha256?: string;
  declaredOutcomeSetSha256?: string;
  observedOutcomeSetSha256?: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
}

export function planBlueprintReplayHistoryFilename(
  history: Pick<
    ExecutionPlanBlueprintRecordReplayHistory,
    "contentSha256" | "recordId"
  >,
): string {
  const safeRecordId = safeFilenameSegment(history.recordId, "blueprint");
  return `napier-blueprint-replay-history-${safeRecordId}-${history.contentSha256.slice(0, 12)}.json`;
}

export function planBlueprintReplayOutcomesFilename(
  outcomes: Pick<
    ExecutionPlanBlueprintRecordReplayOutcomes,
    "contentSha256" | "recordId"
  >,
): string {
  const safeRecordId = safeFilenameSegment(outcomes.recordId, "blueprint");
  return `napier-blueprint-replay-outcomes-${safeRecordId}-${outcomes.contentSha256.slice(0, 12)}.json`;
}

export interface PlanBlueprintLibraryOutcomeBaselineReceipt {
  action: "outcomeBaseline";
  recordId: string;
  baselineId: string;
  baselineSha256: string;
  replayOutcomesSha256: string;
  created: boolean;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  minCompletionRateBps: number;
  reviewGateMinScore?: number;
  reviewGateMaxRisk?: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewGate"]
  >["maxRisk"];
  reviewSha256?: string;
  reviewVerdict?: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewVerdict"]
  >;
  reviewScore?: number;
  reviewRisk?: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]
  >;
  reviewModel?: string;
}

export interface PlanBlueprintLibraryOutcomeQualificationReceipt {
  action: "outcomeQualified";
  recordId: string;
  qualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualification["status"];
  diagnostics: string[];
  contentSha256: string;
  baselineId?: string;
  baselineSha256?: string;
  currentOutcomesSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  minCompletionRateBps?: number;
}

export interface PlanBlueprintLibraryOutcomeReviewReceipt {
  action: "outcomeReviewed";
  recordId: string;
  verdict: ExecutionPlanBlueprintRecordOutcomeReview["verdict"];
  risk: ExecutionPlanBlueprintRecordOutcomeReview["risk"];
  score: number;
  reviewSha256: string;
  reviewEnvelopeSha256?: string;
  inputSha256: string;
  responseSha256: string;
  replayOutcomesSha256: string;
  baselineSha256?: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  concerns: string[];
}

export interface PlanBlueprintLibrarySelectionReceipt {
  action: "selection";
  threadId: string;
  contentSha256: string;
  portfolioSetSha256: string;
  selectionSetSha256: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedPreviewSha256?: string;
  selectedBaselineSha256?: string;
  selectedScoreBps?: number;
  selectedFamilySha256?: string;
  selectedFamilyCompletionRateBps?: number;
  selectedRecommendationScoreBps?: number;
  recommendationPolicyTemplate: ExecutionPlanBlueprintRecordSelection["recommendationPolicy"]["templateId"];
  recommendationPolicySha256: string;
  selectedRecommendationPolicyTemplate?: ExecutionPlanBlueprintRecordSelection["selectedRecommendationPolicyTemplate"];
  selectedRecommendationPolicySha256?: string;
  selectedRecommendationPolicySource?: ExecutionPlanBlueprintRecordSelection["selectedRecommendationPolicySource"];
  selectedFamilyPolicyOverrideSha256?: string;
  familyPolicyOverrideCount: number;
  familyPolicyOverrideSetSha256: string;
  selectedCompletionRateBps?: number;
  selectedReplayCount?: number;
  diagnostics: string[];
}

export interface PlanBlueprintLibraryPortfolioCalibrationReceipt {
  action: "portfolioCalibrated";
  contentSha256: string;
  portfolioSetSha256: string;
  recordCount: number;
  activeCount: number;
  archivedCount: number;
  familyCount: number;
  sourceQualifiedCount: number;
  outcomeQualifiedCount: number;
  reviewedBaselineCount: number;
  missingBaselineCount: number;
  policyFailedCount: number;
  topFamilySha256?: string;
  topRecordId?: string;
  topRecordScoreBps?: number;
}

export interface PlanBlueprintLibraryRecommendationPolicyBacktestReceipt {
  action: "policyBacktested";
  contentSha256: string;
  portfolioSetSha256: string;
  policySetSha256: string;
  recordCount: number;
  activeCount: number;
  policyCount: number;
  divergentSelectionCount: number;
  topPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyBacktest["results"][number]["recommendationPolicy"]["templateId"];
  topPolicySha256: string;
  topSelectedRecordId?: string;
  topSelectedFamilySha256?: string;
  topSelectedRecommendationScoreBps?: number;
  averageRecommendationScoreBps: number;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideReceipt {
  action: "policyOverrideApplied";
  contentSha256: string;
  portfolioSetSha256: string;
  familySha256: string;
  recommendationPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyOverride["recommendationPolicy"]["templateId"];
  recommendationPolicySha256: string;
  familyRecordCount: number;
  familyOutcomeQualifiedCount: number;
  familyCompletionRateBps: number;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt {
  action: "policyOverrideDriftReviewed";
  contentSha256: string;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  reviewSetSha256: string;
  overrideCount: number;
  alignedCount: number;
  retireRecommendedCount: number;
  missingFamilyCount: number;
  reviewedFamilySha256?: string;
  reviewedOverrideSha256?: string;
  reviewedStatus?: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview["reviews"][number]["status"];
  reviewedRecommendation?: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview["reviews"][number]["recommendation"];
  reviewedDiagnostics: string[];
  overridePolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview["reviews"][number]["overridePolicyTemplate"];
  bestPolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview["reviews"][number]["bestPolicyTemplate"];
  overrideSelectedRecordId?: string;
  bestSelectedRecordId?: string;
  overrideSelectedRecommendationScoreBps?: number;
  bestSelectedRecommendationScoreBps?: number;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt {
  action: "policyOverrideRetired";
  contentSha256: string;
  portfolioSetSha256: string;
  familySha256: string;
  retiredOverrideSha256: string;
  retiredRecommendationPolicyTemplate: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult["retiredRecommendationPolicyTemplate"];
  retiredRecommendationPolicySha256: string;
  overrideSetSha256: string;
  driftReviewSetSha256: string;
  remainingOverrideSetSha256: string;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt {
  action: "policyOverrideRetirements";
  contentSha256: string;
  portfolioSetSha256: string;
  currentOverrideSetSha256: string;
  retirementSetSha256: string;
  retirementCount: number;
  latestRetiredAt?: string;
  latestFamilySha256?: string;
  latestRetiredOverrideSha256?: string;
  latestRetiredRecommendationPolicyTemplate?: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult["retiredRecommendationPolicyTemplate"];
  latestRemainingOverrideSetSha256?: string;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt {
  action: "policyOverrideRetirementsVerified";
  verificationStatus: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification["status"];
  diagnostics: string[];
  contentSha256: string;
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
  retirementCount: number;
  observedRetirementCount: number;
  latestRetiredAt?: string;
  observedLatestRetiredAt?: string;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt {
  action: "policyOverrideRetirementProofBundle";
  verificationStatus: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle["status"];
  diagnostics: string[];
  contentSha256: string;
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
  highlightedHistoryIndex?: number;
  highlightedHistoryStatus?: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle["histories"][number]["status"];
  highlightedHistoryDiagnostics: string[];
  highlightedHistoryContentSha256?: string;
  highlightedRetirementSetSha256?: string;
}

export interface PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt {
  action: "policyOverrideRetirementProofBundleSigned";
  verificationStatus: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle["status"];
  contentSha256: string;
  receiptContentSha256: string;
  receiptArtifactSha256: string;
  keyId: string;
  signedAt: string;
  historyCount: number;
  validHistoryCount: number;
  invalidHistoryCount: number;
  distinctHistoryCount: number;
  distinctRetirementSetCount: number;
}

export interface PlanBlueprintLibraryQualificationReceipt {
  action: "qualified";
  recordId: string;
  qualificationStatus: ExecutionPlanBlueprintRecordQualification["status"];
  diagnostics: string[];
  blueprintSha256?: string;
  expectedPlanArchiveSha256?: string;
  actualPlanArchiveSha256?: string;
  stepCount: number;
  artifactCount: number;
}

export interface PlanBlueprintLibraryPreviewReceipt {
  action: "previewed";
  recordId: string;
  previewStatus: ExecutionPlanBlueprintRecordPreview["status"];
  qualificationStatus: ExecutionPlanBlueprintRecordQualification["status"];
  diagnostics: string[];
  planId?: string;
  blueprintSha256?: string;
  stepCount: number;
  artifactCount: number;
}

export function planBlueprintCreatedReceipt(input: {
  record: Pick<ExecutionPlanBlueprintRecord, "id" | "blueprintSha256">;
  plan: {
    id: string;
    steps: readonly unknown[];
    artifacts: readonly unknown[];
  };
  replayEvent?: VerifyExecutionPlanBlueprintRecordReplayEventRequest;
  replayEventVerification?: ExecutionPlanBlueprintRecordReplayEventVerification;
  replayEventDiagnostics?: string[];
}): PlanBlueprintLibraryCreatedReceipt {
  const replayEventDiagnostics =
    input.replayEventVerification?.diagnostics ??
    input.replayEventDiagnostics ??
    (input.replayEvent
      ? ["replay_event_verification_missing"]
      : ["replay_event_anchor_missing"]);
  return {
    action: "created",
    recordId: input.record.id,
    blueprintSha256: input.record.blueprintSha256,
    planId: input.plan.id,
    stepCount: input.plan.steps.length,
    artifactCount: input.plan.artifacts.length,
    ...(input.replayEvent
      ? {
          replayEventId: input.replayEvent.eventId,
          replayEventSha256: input.replayEvent.eventSha256,
        }
      : {}),
    replayEventVerificationStatus:
      input.replayEventVerification?.status ?? "invalid",
    ...(input.replayEventVerification
      ? {
          replayEventVerificationSha256:
            input.replayEventVerification.contentSha256,
        }
      : {}),
    replayEventDiagnostics,
  };
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}

export function planBlueprintReplayHistoryReceipt(
  history: ExecutionPlanBlueprintRecordReplayHistory,
): PlanBlueprintLibraryReplayHistoryReceipt {
  const latest = history.replays.at(-1);
  return {
    action: "history",
    recordId: history.recordId,
    contentSha256: history.contentSha256,
    eventSetSha256: history.eventSetSha256,
    replayCount: history.replayCount,
    threadCount: history.threadCount,
    planCount: history.planCount,
    ...(latest ? { latestPlanId: latest.planId } : {}),
    ...(latest ? { latestPreviewSha256: latest.previewSha256 } : {}),
    stepCount: latest?.stepCount ?? 0,
    artifactCount: latest?.artifactCount ?? 0,
  };
}

export function planBlueprintReplayHistoryVerificationReceipt(
  verification: ExecutionPlanBlueprintRecordReplayHistoryVerification,
): PlanBlueprintLibraryReplayHistoryVerificationReceipt {
  return {
    action: "historyVerified",
    ...(verification.recordId ? { recordId: verification.recordId } : {}),
    verificationStatus: verification.status,
    diagnostics: verification.diagnostics,
    contentSha256: verification.contentSha256,
    ...(verification.declaredContentSha256
      ? { declaredContentSha256: verification.declaredContentSha256 }
      : {}),
    ...(verification.observedContentSha256
      ? { observedContentSha256: verification.observedContentSha256 }
      : {}),
    ...(verification.declaredEventSetSha256
      ? { declaredEventSetSha256: verification.declaredEventSetSha256 }
      : {}),
    ...(verification.observedEventSetSha256
      ? { observedEventSetSha256: verification.observedEventSetSha256 }
      : {}),
    replayCount:
      verification.observedReplayCount ?? verification.replayCount ?? 0,
    threadCount:
      verification.observedThreadCount ?? verification.threadCount ?? 0,
    planCount: verification.observedPlanCount ?? verification.planCount ?? 0,
  };
}

export function planBlueprintReplayOutcomesReceipt(
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
): PlanBlueprintLibraryReplayOutcomesReceipt {
  const latest = outcomes.outcomes.at(-1);
  return {
    action: "outcomes",
    recordId: outcomes.recordId,
    contentSha256: outcomes.contentSha256,
    replayHistorySha256: outcomes.replayHistorySha256,
    outcomeSetSha256: outcomes.outcomeSetSha256,
    replayCount: outcomes.replayCount,
    activeCount: outcomes.activeCount,
    completedCount: outcomes.completedCount,
    blockedCount: outcomes.blockedCount,
    cancelledCount: outcomes.cancelledCount,
    invalidCount: outcomes.invalidCount,
    completionRateBps: outcomes.completionRateBps,
    ...(latest ? { latestPlanId: latest.planId } : {}),
    ...(latest ? { latestStatus: latest.status } : {}),
  };
}

export function planBlueprintReplayOutcomesVerificationReceipt(
  verification: ExecutionPlanBlueprintRecordReplayOutcomesVerification,
): PlanBlueprintLibraryReplayOutcomesVerificationReceipt {
  return {
    action: "outcomesVerified",
    ...(verification.recordId ? { recordId: verification.recordId } : {}),
    verificationStatus: verification.status,
    diagnostics: verification.diagnostics,
    contentSha256: verification.contentSha256,
    ...(verification.declaredContentSha256
      ? { declaredContentSha256: verification.declaredContentSha256 }
      : {}),
    ...(verification.observedContentSha256
      ? { observedContentSha256: verification.observedContentSha256 }
      : {}),
    ...(verification.declaredOutcomeSetSha256
      ? { declaredOutcomeSetSha256: verification.declaredOutcomeSetSha256 }
      : {}),
    ...(verification.observedOutcomeSetSha256
      ? { observedOutcomeSetSha256: verification.observedOutcomeSetSha256 }
      : {}),
    replayCount:
      verification.observedReplayCount ?? verification.replayCount ?? 0,
    completedCount:
      verification.observedCompletedCount ?? verification.completedCount ?? 0,
    blockedCount:
      verification.observedBlockedCount ?? verification.blockedCount ?? 0,
    invalidCount:
      verification.observedInvalidCount ?? verification.invalidCount ?? 0,
  };
}

export function planBlueprintOutcomeBaselineReceipt(
  result: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
): PlanBlueprintLibraryOutcomeBaselineReceipt {
  return {
    action: "outcomeBaseline",
    recordId: result.baseline.recordId,
    baselineId: result.baseline.id,
    baselineSha256: result.baseline.contentSha256,
    replayOutcomesSha256: result.baseline.replayOutcomesSha256,
    created: result.created,
    replayCount: result.baseline.replayCount,
    completedCount: result.baseline.completedCount,
    blockedCount: result.baseline.blockedCount,
    invalidCount: result.baseline.invalidCount,
    completionRateBps: result.baseline.completionRateBps,
    minCompletionRateBps: result.baseline.policy.minCompletionRateBps,
    ...(result.baseline.reviewGate
      ? {
          reviewGateMinScore: result.baseline.reviewGate.minScore,
          reviewGateMaxRisk: result.baseline.reviewGate.maxRisk,
        }
      : {}),
    ...(result.baseline.reviewSha256
      ? { reviewSha256: result.baseline.reviewSha256 }
      : {}),
    ...(result.baseline.reviewVerdict
      ? { reviewVerdict: result.baseline.reviewVerdict }
      : {}),
    ...(result.baseline.reviewScore !== undefined
      ? { reviewScore: result.baseline.reviewScore }
      : {}),
    ...(result.baseline.reviewRisk
      ? { reviewRisk: result.baseline.reviewRisk }
      : {}),
    ...(result.baseline.reviewModel
      ? {
          reviewModel: `${result.baseline.reviewModel.provider}/${result.baseline.reviewModel.id}`,
        }
      : {}),
  };
}

export function planBlueprintOutcomeQualificationReceipt(
  qualification: ExecutionPlanBlueprintRecordOutcomeQualification,
): PlanBlueprintLibraryOutcomeQualificationReceipt {
  return {
    action: "outcomeQualified",
    recordId: qualification.recordId,
    qualificationStatus: qualification.status,
    diagnostics: qualification.diagnostics,
    contentSha256: qualification.contentSha256,
    ...(qualification.baselineId
      ? { baselineId: qualification.baselineId }
      : {}),
    ...(qualification.baselineSha256
      ? { baselineSha256: qualification.baselineSha256 }
      : {}),
    currentOutcomesSha256: qualification.currentOutcomesSha256,
    replayCount: qualification.replayCount,
    completedCount: qualification.completedCount,
    blockedCount: qualification.blockedCount,
    invalidCount: qualification.invalidCount,
    completionRateBps: qualification.completionRateBps,
    ...(qualification.policy
      ? { minCompletionRateBps: qualification.policy.minCompletionRateBps }
      : {}),
  };
}

export function planBlueprintOutcomeReviewReceipt(
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): PlanBlueprintLibraryOutcomeReviewReceipt {
  return {
    action: "outcomeReviewed",
    recordId: review.recordId,
    verdict: review.verdict,
    risk: review.risk,
    score: review.score,
    reviewSha256: review.reviewSha256,
    ...(review.modelContextEnvelope
      ? { reviewEnvelopeSha256: review.modelContextEnvelope.contentSha256 }
      : {}),
    inputSha256: review.inputSha256,
    responseSha256: review.responseSha256,
    replayOutcomesSha256: review.replayOutcomesSha256,
    ...(review.baselineSha256 ? { baselineSha256: review.baselineSha256 } : {}),
    replayCount: review.replayCount,
    completedCount: review.completedCount,
    blockedCount: review.blockedCount,
    invalidCount: review.invalidCount,
    completionRateBps: review.completionRateBps,
    concerns: review.concerns,
  };
}

export function planBlueprintSelectionReceipt(
  selection: ExecutionPlanBlueprintRecordSelection,
): PlanBlueprintLibrarySelectionReceipt {
  const selected = selection.candidates.find(
    (candidate) => candidate.selectionStatus === "selected",
  );
  const diagnostics =
    selected?.diagnostics ??
    selection.candidates
      .flatMap((candidate) => candidate.diagnostics)
      .slice(0, 4);
  return {
    action: "selection",
    threadId: selection.threadId,
    contentSha256: selection.contentSha256,
    portfolioSetSha256: selection.portfolioSetSha256,
    selectionSetSha256: selection.selectionSetSha256,
    candidateCount: selection.candidateCount,
    qualifiedCandidateCount: selection.qualifiedCandidateCount,
    rejectedCandidateCount: selection.rejectedCandidateCount,
    ...(selection.selectedRecordId
      ? { selectedRecordId: selection.selectedRecordId }
      : {}),
    ...(selection.selectedPreviewSha256
      ? { selectedPreviewSha256: selection.selectedPreviewSha256 }
      : {}),
    ...(selection.selectedBaselineSha256
      ? { selectedBaselineSha256: selection.selectedBaselineSha256 }
      : {}),
    ...(selection.selectedScoreBps !== undefined
      ? { selectedScoreBps: selection.selectedScoreBps }
      : {}),
    ...(selection.selectedFamilySha256
      ? { selectedFamilySha256: selection.selectedFamilySha256 }
      : {}),
    ...(selection.selectedFamilyCompletionRateBps !== undefined
      ? {
          selectedFamilyCompletionRateBps:
            selection.selectedFamilyCompletionRateBps,
        }
      : {}),
    ...(selection.selectedRecommendationScoreBps !== undefined
      ? {
          selectedRecommendationScoreBps:
            selection.selectedRecommendationScoreBps,
        }
      : {}),
    recommendationPolicyTemplate: selection.recommendationPolicy.templateId,
    recommendationPolicySha256: selection.recommendationPolicySha256,
    ...(selection.selectedRecommendationPolicyTemplate
      ? {
          selectedRecommendationPolicyTemplate:
            selection.selectedRecommendationPolicyTemplate,
        }
      : {}),
    ...(selection.selectedRecommendationPolicySha256
      ? {
          selectedRecommendationPolicySha256:
            selection.selectedRecommendationPolicySha256,
        }
      : {}),
    ...(selection.selectedRecommendationPolicySource
      ? {
          selectedRecommendationPolicySource:
            selection.selectedRecommendationPolicySource,
        }
      : {}),
    ...(selection.selectedFamilyPolicyOverrideSha256
      ? {
          selectedFamilyPolicyOverrideSha256:
            selection.selectedFamilyPolicyOverrideSha256,
        }
      : {}),
    familyPolicyOverrideCount: selection.familyPolicyOverrideCount,
    familyPolicyOverrideSetSha256: selection.familyPolicyOverrideSetSha256,
    ...(selected
      ? {
          selectedCompletionRateBps: selected.completionRateBps,
          selectedReplayCount: selected.replayCount,
        }
      : {}),
    diagnostics,
  };
}

export function planBlueprintPortfolioCalibrationReceipt(
  calibration: ExecutionPlanBlueprintPortfolioCalibration,
): PlanBlueprintLibraryPortfolioCalibrationReceipt {
  const topFamily = calibration.families[0];
  return {
    action: "portfolioCalibrated",
    contentSha256: calibration.contentSha256,
    portfolioSetSha256: calibration.portfolioSetSha256,
    recordCount: calibration.recordCount,
    activeCount: calibration.activeCount,
    archivedCount: calibration.archivedCount,
    familyCount: calibration.familyCount,
    sourceQualifiedCount: calibration.sourceQualifiedCount,
    outcomeQualifiedCount: calibration.outcomeQualifiedCount,
    reviewedBaselineCount: calibration.reviewedBaselineCount,
    missingBaselineCount: calibration.missingBaselineCount,
    policyFailedCount: calibration.policyFailedCount,
    ...(topFamily ? { topFamilySha256: topFamily.familySha256 } : {}),
    ...(topFamily?.topRecordId ? { topRecordId: topFamily.topRecordId } : {}),
    ...(topFamily?.topRecordScoreBps !== undefined
      ? { topRecordScoreBps: topFamily.topRecordScoreBps }
      : {}),
  };
}

export function planBlueprintRecommendationPolicyBacktestReceipt(
  backtest: ExecutionPlanBlueprintRecommendationPolicyBacktest,
): PlanBlueprintLibraryRecommendationPolicyBacktestReceipt {
  const top = [...backtest.results].sort(
    (left, right) =>
      (right.selectedRecommendationScoreBps ?? 0) -
        (left.selectedRecommendationScoreBps ?? 0) ||
      right.averageRecommendationScoreBps - left.averageRecommendationScoreBps,
  )[0];
  return {
    action: "policyBacktested",
    contentSha256: backtest.contentSha256,
    portfolioSetSha256: backtest.portfolioSetSha256,
    policySetSha256: backtest.policySetSha256,
    recordCount: backtest.recordCount,
    activeCount: backtest.activeCount,
    policyCount: backtest.policyCount,
    divergentSelectionCount: backtest.divergentSelectionCount,
    topPolicyTemplate: top?.recommendationPolicy.templateId ?? "balanced",
    topPolicySha256: top?.recommendationPolicySha256 ?? "",
    ...(top?.selectedRecordId
      ? { topSelectedRecordId: top.selectedRecordId }
      : {}),
    ...(top?.selectedFamilySha256
      ? { topSelectedFamilySha256: top.selectedFamilySha256 }
      : {}),
    ...(top?.selectedRecommendationScoreBps !== undefined
      ? {
          topSelectedRecommendationScoreBps: top.selectedRecommendationScoreBps,
        }
      : {}),
    averageRecommendationScoreBps: top?.averageRecommendationScoreBps ?? 0,
  };
}

export function planBlueprintRecommendationPolicyOverrideReceipt(
  override: ExecutionPlanBlueprintRecommendationPolicyOverride,
): PlanBlueprintLibraryRecommendationPolicyOverrideReceipt {
  return {
    action: "policyOverrideApplied",
    contentSha256: override.contentSha256,
    portfolioSetSha256: override.portfolioSetSha256,
    familySha256: override.familySha256,
    recommendationPolicyTemplate: override.recommendationPolicy.templateId,
    recommendationPolicySha256: override.recommendationPolicySha256,
    familyRecordCount: override.familyRecordCount,
    familyOutcomeQualifiedCount: override.familyOutcomeQualifiedCount,
    familyCompletionRateBps: override.familyCompletionRateBps,
  };
}

export function planBlueprintRecommendationPolicyOverrideDriftReviewReceipt(
  review: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
): PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt {
  const selectedReview =
    review.reviews.find((item) => item.recommendation === "retire") ??
    review.reviews[0];
  return {
    action: "policyOverrideDriftReviewed",
    contentSha256: review.contentSha256,
    portfolioSetSha256: review.portfolioSetSha256,
    overrideSetSha256: review.overrideSetSha256,
    reviewSetSha256: review.reviewSetSha256,
    overrideCount: review.overrideCount,
    alignedCount: review.alignedCount,
    retireRecommendedCount: review.retireRecommendedCount,
    missingFamilyCount: review.missingFamilyCount,
    ...(selectedReview
      ? {
          reviewedFamilySha256: selectedReview.familySha256,
          reviewedOverrideSha256: selectedReview.overrideSha256,
          reviewedStatus: selectedReview.status,
          reviewedRecommendation: selectedReview.recommendation,
          overridePolicyTemplate: selectedReview.overridePolicyTemplate,
        }
      : {}),
    reviewedDiagnostics: selectedReview?.diagnostics ?? [],
    ...(selectedReview?.bestPolicyTemplate
      ? { bestPolicyTemplate: selectedReview.bestPolicyTemplate }
      : {}),
    ...(selectedReview?.overrideSelectedRecordId
      ? { overrideSelectedRecordId: selectedReview.overrideSelectedRecordId }
      : {}),
    ...(selectedReview?.bestSelectedRecordId
      ? { bestSelectedRecordId: selectedReview.bestSelectedRecordId }
      : {}),
    ...(selectedReview?.overrideSelectedRecommendationScoreBps !== undefined
      ? {
          overrideSelectedRecommendationScoreBps:
            selectedReview.overrideSelectedRecommendationScoreBps,
        }
      : {}),
    ...(selectedReview?.bestSelectedRecommendationScoreBps !== undefined
      ? {
          bestSelectedRecommendationScoreBps:
            selectedReview.bestSelectedRecommendationScoreBps,
        }
      : {}),
  };
}

export function planBlueprintRecommendationPolicyOverrideRetirementReceipt(
  result: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
): PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt {
  return {
    action: "policyOverrideRetired",
    contentSha256: result.contentSha256,
    portfolioSetSha256: result.portfolioSetSha256,
    familySha256: result.familySha256,
    retiredOverrideSha256: result.retiredOverrideSha256,
    retiredRecommendationPolicyTemplate:
      result.retiredRecommendationPolicyTemplate,
    retiredRecommendationPolicySha256: result.retiredRecommendationPolicySha256,
    overrideSetSha256: result.overrideSetSha256,
    driftReviewSetSha256: result.driftReviewSetSha256,
    remainingOverrideSetSha256: result.remainingOverrideSetSha256,
  };
}

export function planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt(
  history: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
): PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt {
  const latest = history.retirements.at(-1);
  return {
    action: "policyOverrideRetirements",
    contentSha256: history.contentSha256,
    portfolioSetSha256: history.portfolioSetSha256,
    currentOverrideSetSha256: history.currentOverrideSetSha256,
    retirementSetSha256: history.retirementSetSha256,
    retirementCount: history.retirementCount,
    ...(history.latestRetiredAt
      ? { latestRetiredAt: history.latestRetiredAt }
      : {}),
    ...(latest
      ? {
          latestFamilySha256: latest.familySha256,
          latestRetiredOverrideSha256: latest.retiredOverrideSha256,
          latestRetiredRecommendationPolicyTemplate:
            latest.retiredRecommendationPolicyTemplate,
          latestRemainingOverrideSetSha256: latest.remainingOverrideSetSha256,
        }
      : {}),
  };
}

export function planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt(
  verification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
): PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt {
  return {
    action: "policyOverrideRetirementsVerified",
    verificationStatus: verification.status,
    diagnostics: verification.diagnostics,
    contentSha256: verification.contentSha256,
    ...(verification.declaredContentSha256
      ? { declaredContentSha256: verification.declaredContentSha256 }
      : {}),
    ...(verification.recomputedContentSha256
      ? { recomputedContentSha256: verification.recomputedContentSha256 }
      : {}),
    observedContentSha256: verification.observedContentSha256,
    ...(verification.declaredPortfolioSetSha256
      ? { declaredPortfolioSetSha256: verification.declaredPortfolioSetSha256 }
      : {}),
    observedPortfolioSetSha256: verification.observedPortfolioSetSha256,
    ...(verification.declaredCurrentOverrideSetSha256
      ? {
          declaredCurrentOverrideSetSha256:
            verification.declaredCurrentOverrideSetSha256,
        }
      : {}),
    observedCurrentOverrideSetSha256:
      verification.observedCurrentOverrideSetSha256,
    ...(verification.declaredRetirementSetSha256
      ? {
          declaredRetirementSetSha256: verification.declaredRetirementSetSha256,
        }
      : {}),
    ...(verification.recomputedRetirementSetSha256
      ? {
          recomputedRetirementSetSha256:
            verification.recomputedRetirementSetSha256,
        }
      : {}),
    observedRetirementSetSha256: verification.observedRetirementSetSha256,
    retirementCount:
      verification.retirementCount ?? verification.observedRetirementCount,
    observedRetirementCount: verification.observedRetirementCount,
    ...(verification.latestRetiredAt
      ? { latestRetiredAt: verification.latestRetiredAt }
      : {}),
    ...(verification.observedLatestRetiredAt
      ? { observedLatestRetiredAt: verification.observedLatestRetiredAt }
      : {}),
  };
}

export function planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt(
  proofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
): PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt {
  const highlighted =
    proofBundle.histories.find((history) => history.status === "invalid") ??
    proofBundle.histories.find(
      (history, _index, histories) =>
        history.declaredRetirementSetSha256 &&
        histories[0]?.declaredRetirementSetSha256 !==
          history.declaredRetirementSetSha256,
    ) ??
    proofBundle.histories[0];
  return {
    action: "policyOverrideRetirementProofBundle",
    verificationStatus: proofBundle.status,
    diagnostics: proofBundle.diagnostics,
    contentSha256: proofBundle.contentSha256,
    historyCount: proofBundle.historyCount,
    validHistoryCount: proofBundle.validHistoryCount,
    invalidHistoryCount: proofBundle.invalidHistoryCount,
    distinctHistoryCount: proofBundle.distinctHistoryCount,
    distinctPortfolioSetCount: proofBundle.distinctPortfolioSetCount,
    distinctCurrentOverrideSetCount:
      proofBundle.distinctCurrentOverrideSetCount,
    distinctRetirementSetCount: proofBundle.distinctRetirementSetCount,
    historySetSha256: proofBundle.historySetSha256,
    portfolioSetBundleSha256: proofBundle.portfolioSetBundleSha256,
    currentOverrideSetBundleSha256: proofBundle.currentOverrideSetBundleSha256,
    retirementSetBundleSha256: proofBundle.retirementSetBundleSha256,
    ...(highlighted
      ? {
          highlightedHistoryIndex: highlighted.index,
          highlightedHistoryStatus: highlighted.status,
          highlightedHistoryDiagnostics: highlighted.diagnostics,
          ...(highlighted.declaredContentSha256
            ? {
                highlightedHistoryContentSha256:
                  highlighted.declaredContentSha256,
              }
            : {}),
          ...(highlighted.declaredRetirementSetSha256
            ? {
                highlightedRetirementSetSha256:
                  highlighted.declaredRetirementSetSha256,
              }
            : {}),
        }
      : { highlightedHistoryDiagnostics: [] }),
  };
}

export function planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt(
  envelope: TrustedReceiptEnvelope<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle>,
): PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt {
  return {
    action: "policyOverrideRetirementProofBundleSigned",
    verificationStatus: envelope.receipt.status,
    contentSha256: envelope.contentSha256,
    receiptContentSha256: envelope.receipt.contentSha256,
    receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
    keyId: envelope.signature.keyId,
    signedAt: envelope.signature.signedAt,
    historyCount: envelope.receipt.historyCount,
    validHistoryCount: envelope.receipt.validHistoryCount,
    invalidHistoryCount: envelope.receipt.invalidHistoryCount,
    distinctHistoryCount: envelope.receipt.distinctHistoryCount,
    distinctRetirementSetCount: envelope.receipt.distinctRetirementSetCount,
  };
}

export function planBlueprintQualificationReceipt(
  qualification: ExecutionPlanBlueprintRecordQualification,
): PlanBlueprintLibraryQualificationReceipt {
  return {
    action: "qualified",
    recordId: qualification.recordId,
    qualificationStatus: qualification.status,
    diagnostics: qualification.diagnostics,
    ...(qualification.blueprintSha256
      ? { blueprintSha256: qualification.blueprintSha256 }
      : {}),
    ...(qualification.expectedPlanArchiveSha256
      ? { expectedPlanArchiveSha256: qualification.expectedPlanArchiveSha256 }
      : {}),
    ...(qualification.actualPlanArchiveSha256
      ? { actualPlanArchiveSha256: qualification.actualPlanArchiveSha256 }
      : {}),
    stepCount: qualification.stepCount,
    artifactCount: qualification.artifactCount,
  };
}

export function planBlueprintPreviewReceipt(
  preview: ExecutionPlanBlueprintRecordPreview,
): PlanBlueprintLibraryPreviewReceipt {
  return {
    action: "previewed",
    recordId: preview.recordId,
    previewStatus: preview.status,
    qualificationStatus: preview.qualification.status,
    diagnostics: preview.diagnostics,
    ...(preview.plan ? { planId: preview.plan.id } : {}),
    ...(preview.qualification.blueprintSha256
      ? { blueprintSha256: preview.qualification.blueprintSha256 }
      : {}),
    stepCount: preview.plan?.steps.length ?? preview.qualification.stepCount,
    artifactCount:
      preview.plan?.artifacts.length ?? preview.qualification.artifactCount,
  };
}
