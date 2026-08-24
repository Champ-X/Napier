import type { ModelRef } from "./execution-core.js";
import type { ModelRole } from "./model-route.js";

export type HarnessExperimentMetric =
  | "task_success"
  | "input_tokens"
  | "output_tokens"
  | "tool_schema_tokens"
  | "duration_ms"
  | "tool_call_count"
  | "repeated_call_rate"
  | "no_new_information_rate"
  | "intervention_count"
  | "overflow_failed_count"
  | "evidence_completeness";

export interface HarnessExperimentCase {
  id: string;
  inputSha256: string;
  tags: string[];
}

export interface HarnessExperimentProfile {
  kind: "napier.model-harness-experiment-profile";
  schemaVersion: 1;
  id: string;
  maxActiveTools: number;
  contentSha256: string;
}

export interface ModelRouteLock {
  role: ModelRole;
  servingModel: ModelRef;
  fallbackSamples: "separate_stratum";
}

export interface ExperimentDecisionRule {
  minimumCases: number;
  minimumSeedsPerCase: number;
  primaryNonInferiorityMargin: number;
  guardrailRegressionTolerance: number;
}

export interface HarnessExperiment {
  kind: "napier.harness-experiment";
  schemaVersion: 1;
  id: string;
  baselineProfile: HarnessExperimentProfile;
  candidateProfile: HarnessExperimentProfile;
  cases: HarnessExperimentCase[];
  caseSetDigest: string;
  modelRouteLock: ModelRouteLock;
  seeds: number[];
  primaryMetrics: HarnessExperimentMetric[];
  guardrailMetrics: HarnessExperimentMetric[];
  decisionRule: ExperimentDecisionRule;
  contentSha256: string;
}

export type HarnessExperimentArm = "baseline" | "candidate";

export interface HarnessExperimentTrial {
  caseId: string;
  seed: number;
  arm: HarnessExperimentArm;
  runId: string;
  servingModel: ModelRef;
  fallbackUsed: boolean;
  profileSha256: string;
  harnessReceiptSha256: string;
  metrics: Partial<Record<HarnessExperimentMetric, number>>;
}

export interface HarnessExperimentMetricDecision {
  metric: HarnessExperimentMetric;
  direction: "higher" | "lower";
  pairCount: number;
  baselineMean?: number;
  candidateMean?: number;
  delta?: number;
  status: "passed" | "regressed" | "insufficient";
}

export interface HarnessExperimentEvaluation {
  kind: "napier.harness-experiment-evaluation";
  schemaVersion: 1;
  experimentId: string;
  experimentSha256: string;
  expectedPairCount: number;
  comparablePairCount: number;
  fallbackPairCount: number;
  servingModelMismatchPairCount: number;
  profileMismatchPairCount: number;
  missingPairCount: number;
  primary: HarnessExperimentMetricDecision[];
  guardrails: HarnessExperimentMetricDecision[];
  verdict: "improved" | "no_difference" | "regressed" | "insufficient_evidence";
  contentSha256: string;
}

export interface HarnessExperimentExecution {
  kind: "napier.harness-experiment-execution";
  schemaVersion: 1;
  experimentId: string;
  experimentSha256: string;
  startedAt: string;
  finishedAt: string;
  trials: HarnessExperimentTrial[];
  evaluation: HarnessExperimentEvaluation;
  contentSha256: string;
}

export interface HarnessExperimentReleaseBinding {
  executionSha256: string;
  sourceManifestSha256: string;
  configurationSha256: string;
  credentialClass: string;
}

export interface HarnessExperimentTrendPoint {
  executionSha256: string;
  finishedAt: string;
  verdict: HarnessExperimentEvaluation["verdict"];
  comparablePairCount: number;
  fallbackPairCount: number;
  servingModelMismatchPairCount: number;
  profileMismatchPairCount: number;
  metricDeltas: Partial<Record<HarnessExperimentMetric, number>>;
}

export type HarnessExperimentRegressionFactor =
  | "candidate_profile"
  | "source_manifest"
  | "configuration"
  | "credential_class";

export interface HarnessExperimentRegressionAttribution {
  status:
    | "not_regressed"
    | "controlled_candidate_regression"
    | "confounded"
    | "insufficient_evidence";
  latestExecutionSha256: string;
  previousExecutionSha256?: string;
  factors: HarnessExperimentRegressionFactor[];
}

export interface HarnessExperimentReleaseEvidence {
  kind: "napier.harness-experiment-release-evidence";
  schemaVersion: 1;
  generatedAt: string;
  productVersion: string;
  experiment: HarnessExperiment;
  executions: HarnessExperimentExecution[];
  bindings: HarnessExperimentReleaseBinding[];
  trend: HarnessExperimentTrendPoint[];
  regressionAttribution: HarnessExperimentRegressionAttribution;
  promotionReady: boolean;
  blockers: string[];
  contentSha256: string;
}
