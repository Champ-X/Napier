import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
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
