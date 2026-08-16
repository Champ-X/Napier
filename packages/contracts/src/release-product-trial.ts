export type ReleaseProductTrialStatus = "passed" | "failed" | "inconclusive";

export type ReleaseProductTrialRunStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ReleaseProductTrialFailureReason =
  | "task_result"
  | "tool_failure"
  | "configuration"
  | "manual_intervention"
  | "recovery_failure"
  | "ux_blocker";

export interface CreateReleaseProductTrialRequest {
  casebookId: string;
  templateCaseId: string;
  runId: string;
  productVersion: string;
  status: ReleaseProductTrialStatus;
  failureReason?: ReleaseProductTrialFailureReason;
  configurationInterventions: number;
  humanInterventions: number;
  recoveryEvents: number;
  uxScore: number;
}

export interface ReleaseProductTrial {
  id: string;
  threadId: string;
  casebookId: string;
  templateId: string;
  templateVersion: number;
  templateCaseId: string;
  runId: string;
  runStatus: ReleaseProductTrialRunStatus;
  runStartedAt: string;
  runFinishedAt: string;
  productVersion: string;
  releaseIdentitySha256?: string;
  status: ReleaseProductTrialStatus;
  failureReason?: ReleaseProductTrialFailureReason;
  configurationInterventions: number;
  humanInterventions: number;
  recoveryEvents: number;
  uxScore: number;
  recordedAt: string;
  contentSha256: string;
}

export interface ReleaseProductTrialAdoption {
  id: string;
  casebookId: string;
  sourceCasebookId: string;
  sourceGate: ReleaseProductGateProjection;
  sourceTrialIds: string[];
  adoptedAt: string;
  contentSha256: string;
}

export type ReleaseProductVersionGateStatus =
  | "passed"
  | "failed"
  | "incomplete";

export interface ReleaseProductVersionGate {
  productVersion: string;
  caseCount: number;
  coveredCaseCount: number;
  trialCount: number;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  successRate: number;
  minimumSuccessRate: number;
  meanUxScore: number;
  configurationInterventions: number;
  humanInterventions: number;
  recoveryEvents: number;
  criticalCaseIds: string[];
  failedCriticalCaseIds: string[];
  releaseIdentitySha256?: string;
  status: ReleaseProductVersionGateStatus;
  firstRecordedAt?: string;
  lastRecordedAt?: string;
}

export interface ReleaseProductGateProjection {
  kind: "napier.release-product-gate";
  schemaVersion: 1;
  currentProductVersion: string;
  currentReleaseIdentitySha256?: string;
  casebookId: string;
  templateId: string;
  templateVersion: number;
  minimumSuccessRate: number;
  requiredConsecutiveVersions: number;
  versions: ReleaseProductVersionGate[];
  consecutivePassingVersions: string[];
  defaultTrackReady: boolean;
  trials: ReleaseProductTrial[];
  adoptions?: ReleaseProductTrialAdoption[];
  contentSha256: string;
}
