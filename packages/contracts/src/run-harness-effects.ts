export type RunHarnessEvidenceStatus = "available" | "unavailable";

export interface RunHarnessFirstAction {
  status: RunHarnessEvidenceStatus;
  elapsedMs?: number;
  eventSeq?: number;
}

export interface RunHarnessToolEfficiencyMetrics {
  startedCount: number;
  classifiedActionCount: number;
  hashedCallCount: number;
  repeatedCallCount: number;
  repeatedCallRate: number | null;
  noNewInformationEligibleCount: number;
  noNewInformationCount: number;
  noNewInformationRate: number | null;
}

export interface RunHarnessContextTokenMetrics {
  status: RunHarnessEvidenceStatus;
  observationCount: number;
  systemPromptEstimatedTokens?: number;
  toolDefinitionEstimatedTokens?: number;
  activeMessageEstimatedTokens?: number;
  activeEstimatedTotalTokens?: number;
  systemPromptTokenShare?: number;
  toolDefinitionTokenShare?: number;
  calibrationObservationCount?: number;
  calibratedObservationCount?: number;
  calibrationUnavailableCount?: number;
  p95InputUnderestimateRatio?: number;
}

export interface RunHarnessOverflowMetrics {
  attemptCount: number;
  recoveredCount: number;
  failedCount: number;
  unavailableCount: number;
}

export type RunHarnessInterventionReason =
  | "operator_decision"
  | "browser_confirmation"
  | "workflow_approval"
  | "approval_block"
  | "capability_block"
  | "capability_use_required"
  | "capability_discovery_required"
  | "capability_recovery"
  | "safety_block"
  | "budget_pause"
  | "manual_recovery";

export interface RunHarnessInterventionMetrics {
  count: number;
  reasonCounts: Partial<Record<RunHarnessInterventionReason, number>>;
  reasonSetSha256: string;
}

export interface RunHarnessTaskOutcome {
  status: "passed" | "failed" | "unavailable";
  evidenceType?: string;
  eventSeq?: number;
}

export interface RunHarnessResolutionMetrics {
  status: RunHarnessEvidenceStatus;
  observationCount: number;
  validReceiptCount: number;
  distinctReceiptCount: number;
  firstReceiptSha256?: string;
  lastReceiptSha256?: string;
  resolutionSequenceSha256?: string;
}

export interface RunHarnessEffectMetrics {
  kind: "napier.run-harness-effect-metrics";
  schemaVersion: 1;
  algorithmVersion: string;
  runId: string;
  eventStreamSha256: string;
  taskInputSha256?: string;
  firstAction: {
    read: RunHarnessFirstAction;
    write: RunHarnessFirstAction;
    verify: RunHarnessFirstAction;
  };
  toolEfficiency: RunHarnessToolEfficiencyMetrics;
  contextTokens: RunHarnessContextTokenMetrics;
  overflow: RunHarnessOverflowMetrics;
  interventions: RunHarnessInterventionMetrics;
  harnessResolution: RunHarnessResolutionMetrics;
  taskOutcome: RunHarnessTaskOutcome;
  contentSha256: string;
}

export interface RunHarnessEffectDelta {
  firstReadElapsedMs: number | null;
  firstWriteElapsedMs: number | null;
  firstVerifyElapsedMs: number | null;
  repeatedCallCount: number;
  repeatedCallRate: number | null;
  noNewInformationCount: number;
  noNewInformationRate: number | null;
  systemPromptTokenShare: number | null;
  toolDefinitionTokenShare: number | null;
  overflowAttemptCount: number;
  overflowRecoveredCount: number;
  overflowFailedCount: number;
  interventionCount: number;
  taskOutcomeChanged: boolean;
}

export type HarnessComparisonDimensionStatus =
  | "matched"
  | "mismatched"
  | "unavailable";

export interface HarnessComparisonDimension {
  status: HarnessComparisonDimensionStatus;
  leftSha256?: string;
  rightSha256?: string;
}

export interface HarnessComparisonFairness {
  kind: "napier.harness-comparison-fairness";
  schemaVersion: 1;
  status: "comparable" | "not_comparable" | "insufficient_evidence";
  provider: HarnessComparisonDimension;
  model: HarnessComparisonDimension;
  task: HarnessComparisonDimension;
  environment: HarnessComparisonDimension;
  budget: HarnessComparisonDimension & { maxRelativeDelta?: number };
  diagnostics: string[];
  leftMetricsSha256: string;
  rightMetricsSha256: string;
  contentSha256: string;
}

export interface RunHarnessComparison {
  left: RunHarnessEffectMetrics;
  right: RunHarnessEffectMetrics;
  delta: RunHarnessEffectDelta;
  fairness: HarnessComparisonFairness;
  harnessResolution: HarnessComparisonDimension;
  contentSha256: string;
}
