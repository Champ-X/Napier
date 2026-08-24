import type {
  EventCategory,
  EventVisibility,
  JsonValue,
  ModelRef,
  SubagentSupervisorStatus,
} from "./index.js";

export type HarnessRouteFailureClass =
  | "rate_limited"
  | "provider_server"
  | "network";

export interface HarnessLedgerEventEvidence {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  type: string;
  category: EventCategory;
  visibility: EventVisibility;
  createdAt: string;
  payload: JsonValue;
  payloadSha256: string;
  eventSha256: string;
}

export interface HarnessLedgerRunEvidence {
  threadId: string;
  runId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  events: HarnessLedgerEventEvidence[];
  eventStreamSha256: string;
  contentSha256: string;
}

export interface HarnessRouteAcceptanceCase {
  id: string;
  failureClass: HarnessRouteFailureClass;
  scenario: "recoverable" | "visible_output" | "unknown_side_effect";
  runEvidenceSha256: string;
}

export interface HarnessCapabilityReachabilityCase {
  id: string;
  targetToolId: string;
  runEvidenceSha256: string;
}

export interface HarnessLoopAcceptancePair {
  id: string;
  baselineRunEvidenceSha256: string;
  candidateRunEvidenceSha256: string;
}

export interface HarnessCodeBridgeAcceptanceCall {
  id: string;
  callId: string;
  runEvidenceSha256: string;
}

export interface HarnessCodeBridgePrivilegeProbe {
  id: string;
  probeClass: "workspace_escape" | "inactive_capability" | "unknown_effect";
  callId: string;
  runEvidenceSha256: string;
}

export type HarnessSubagentTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "orphaned";

export interface HarnessSubagentRestartSnapshot {
  taskId: string;
  status: HarnessSubagentTerminalStatus;
  supervisorStatus: SubagentSupervisorStatus;
  stopReason: string;
  revision: number;
  finishedAt: string;
  contentSha256: string;
}

export interface HarnessSubagentAcceptanceTask {
  taskId: string;
  terminalEventId: string;
  runEvidenceSha256: string;
  restartSnapshot: HarnessSubagentRestartSnapshot;
}

export interface HarnessSteeringBoundaryCheck {
  taskId: string;
  messageId: string;
  runEvidenceSha256: string;
}

export interface HarnessCancellationBoundaryCheck {
  taskId: string;
  requestEventId: string;
  terminalEventId: string;
  runEvidenceSha256: string;
}

export interface HarnessTokenCalibrationObservation {
  provider: string;
  model: string;
  contentClass: "text" | "structured" | "multimodal";
  calibrationEventId: string;
  runEvidenceSha256: string;
}

export interface HarnessConservativeTokenFallbackProbe {
  eventId: string;
  runEvidenceSha256: string;
}

export interface AgentHarnessAcceptanceEvidenceContent {
  kind: "napier.agent-harness-acceptance-evidence";
  schemaVersion: 1;
  generatedAt: string;
  productVersion: string;
  sourceManifestSha256: string;
  harnessExperimentEvidenceSha256: string;
  primaryModels: ModelRef[];
  ledgerRuns: HarnessLedgerRunEvidence[];
  routeCases: HarnessRouteAcceptanceCase[];
  capabilityReachabilityCases: HarnessCapabilityReachabilityCase[];
  loopPairs: HarnessLoopAcceptancePair[];
  codeBridgeCalls: HarnessCodeBridgeAcceptanceCall[];
  codeBridgePrivilegeProbes: HarnessCodeBridgePrivilegeProbe[];
  subagentTasks: HarnessSubagentAcceptanceTask[];
  steeringBoundaryChecks: HarnessSteeringBoundaryCheck[];
  cancellationBoundaryChecks: HarnessCancellationBoundaryCheck[];
  tokenCalibrationObservations: HarnessTokenCalibrationObservation[];
  conservativeTokenFallbackProbe: HarnessConservativeTokenFallbackProbe;
}

export interface AgentHarnessAcceptanceSummary {
  routeRecoverySampleCount: number;
  routeRecoveryRate: number;
  visibleOutputCrossModelContinuationCount: number;
  unknownSideEffectReplayCount: number;
  routeAttributionRate: number;
  capabilityUnreachableRate: number;
  repeatedCallReduction: number;
  noNewInformationReduction: number;
  codeBridgeGovernanceCoverage: number;
  privilegeExpansionCount: number;
  subagentDurableTerminalRate: number;
  steeringBoundarySuccessRate: number;
  cancellationBoundarySuccessRate: number;
  tokenModelP95: Array<
    ModelRef & {
      sampleCount: number;
      p95UnderestimateRatio: number;
    }
  >;
  conservativeTokenFallbackVerified: boolean;
}

export interface AgentHarnessAcceptanceEvidence extends AgentHarnessAcceptanceEvidenceContent {
  summary: AgentHarnessAcceptanceSummary;
  acceptanceReady: boolean;
  blockers: string[];
  contentSha256: string;
}
