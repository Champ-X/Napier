export type ControlledHarnessComparisonDomain =
  | "search"
  | "browser_omp"
  | "coding"
  | "browser_autonomy";

export type ControlledHarnessBaseline = "omp" | "browser_use";

export type ControlledHarnessComparisonVerdict =
  | "napier_not_worse"
  | "napier_below_baseline"
  | "not_proven";

export type ControlledHarnessSourceRole =
  | "open_web_campaign"
  | "coding_seed"
  | "browser_autonomy";

export interface ControlledHarnessSourceArtifact {
  role: ControlledHarnessSourceRole;
  contentSha256: string;
}

export interface ControlledHarnessFairness {
  sameModel: boolean;
  samePrompt: boolean;
  isolatedWorkspace: boolean;
  samePermissions: boolean;
}

export interface ControlledHarnessComparisonEvidence {
  domain: ControlledHarnessComparisonDomain;
  baseline: ControlledHarnessBaseline;
  caseCount: number;
  trialCount: number;
  decisiveTrialCount: number;
  excludedTrialCount: number;
  napierPassed: number;
  baselinePassed: number;
  napierOnlyPassed: number;
  baselineOnlyPassed: number;
  napierSecretLeakDetected: boolean;
  napierUnconfirmedSideEffectDetected: boolean;
  fairness: ControlledHarnessFairness;
  sourceArtifactSha256s: string[];
}

export type ControlledHarnessAdvantageMetric =
  | "recovery"
  | "evidence"
  | "understandability";

export type ControlledHarnessAdvantageDirection = "higher" | "lower";

export interface ControlledHarnessAdvantageEvidence {
  metric: ControlledHarnessAdvantageMetric;
  baseline: ControlledHarnessBaseline;
  direction: ControlledHarnessAdvantageDirection;
  unit: string;
  napierValue: number | null;
  baselineValue: number | null;
  napierSampleCount: number;
  baselineSampleCount: number;
  sourceArtifactSha256s: string[];
}

export interface ControlledHarnessComparisonGate extends ControlledHarnessComparisonEvidence {
  minimumCaseCount: number;
  minimumTrialCount: number;
  minimumDecisiveTrialCount: number;
  minimumDecisiveCoverage: number;
  sampleReady: boolean;
  verdict: ControlledHarnessComparisonVerdict;
  comparisonReady: boolean;
}

export interface ControlledHarnessAdvantageGate extends ControlledHarnessAdvantageEvidence {
  minimumSampleCount: number;
  advantageReady: boolean;
}

export interface ControlledHarnessEvidenceContent {
  kind: "napier.controlled-harness-evidence";
  schemaVersion: 1;
  generatedAt: string;
  productVersion: string;
  model: { provider: string; id: string };
  sources: ControlledHarnessSourceArtifact[];
  comparisons: ControlledHarnessComparisonEvidence[];
  advantage: ControlledHarnessAdvantageEvidence;
}

export interface ControlledHarnessEvidence extends ControlledHarnessEvidenceContent {
  comparisonGates: ControlledHarnessComparisonGate[];
  advantageGate: ControlledHarnessAdvantageGate;
  controlledTrackReady: boolean;
  blockers: string[];
  contentSha256: string;
}

export interface ControlledHarnessGateProjection {
  kind: "napier.controlled-harness-gate";
  schemaVersion: 1;
  currentProductVersion: string;
  casebookId: string;
  evidenceCount: number;
  evidence?: ControlledHarnessEvidence;
  comparisonGates: ControlledHarnessComparisonGate[];
  advantageGate?: ControlledHarnessAdvantageGate;
  controlledTrackReady: boolean;
  blockers: string[];
  contentSha256: string;
}
