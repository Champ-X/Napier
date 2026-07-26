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
  ExecutionPlanBlueprintRecordSelection,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
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
  selectionSetSha256: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedPreviewSha256?: string;
  selectedBaselineSha256?: string;
  selectedScoreBps?: number;
  selectedCompletionRateBps?: number;
  selectedReplayCount?: number;
  diagnostics: string[];
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
    ...(selected
      ? {
          selectedCompletionRateBps: selected.completionRateBps,
          selectedReplayCount: selected.replayCount,
        }
      : {}),
    diagnostics,
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
