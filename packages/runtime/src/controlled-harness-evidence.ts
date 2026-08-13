import { createHash } from "node:crypto";

import type {
  ControlledHarnessAdvantageEvidence,
  ControlledHarnessAdvantageGate,
  ControlledHarnessBaseline,
  ControlledHarnessComparisonDomain,
  ControlledHarnessComparisonEvidence,
  ControlledHarnessComparisonGate,
  ControlledHarnessEvidence,
  ControlledHarnessEvidenceContent,
  ControlledHarnessGateProjection,
  ControlledHarnessSourceArtifact,
  ControlledHarnessSourceRole,
} from "@napier/contracts/controlled-harness-evidence";

export const CONTROLLED_HARNESS_EVIDENCE_EVENT_TYPE =
  "evaluation.controlled-harness.evidence.recorded";
export const CONTROLLED_HARNESS_MINIMUM_ADVANTAGE_SAMPLES = 3;
export const CONTROLLED_HARNESS_MINIMUM_DECISIVE_COVERAGE = 2 / 3;

const ADVANTAGE_RATE_UNITS = new Set([
  "recovery:successful_recovery_rate",
  "evidence:verifiable_final_evidence_rate",
  "understandability:task_state_comprehension_rate",
]);

const DOMAIN_ORDER: ControlledHarnessComparisonDomain[] = [
  "search",
  "browser_omp",
  "coding",
  "browser_autonomy",
];

const THRESHOLDS: Record<
  ControlledHarnessComparisonDomain,
  {
    baseline: ControlledHarnessBaseline;
    sourceRole: ControlledHarnessSourceRole;
    minimumCaseCount: number;
    minimumTrialCount: number;
    minimumDecisiveTrialCount: number;
  }
> = {
  search: {
    baseline: "omp",
    sourceRole: "open_web_campaign",
    minimumCaseCount: 2,
    minimumTrialCount: 2,
    minimumDecisiveTrialCount: 2,
  },
  browser_omp: {
    baseline: "omp",
    sourceRole: "open_web_campaign",
    minimumCaseCount: 2,
    minimumTrialCount: 2,
    minimumDecisiveTrialCount: 2,
  },
  coding: {
    baseline: "omp",
    sourceRole: "coding_seed",
    minimumCaseCount: 3,
    minimumTrialCount: 3,
    minimumDecisiveTrialCount: 3,
  },
  browser_autonomy: {
    baseline: "browser_use",
    sourceRole: "browser_autonomy",
    minimumCaseCount: 1,
    minimumTrialCount: 3,
    minimumDecisiveTrialCount: 3,
  },
};

export function createControlledHarnessEvidence(
  input: ControlledHarnessEvidenceContent,
): ControlledHarnessEvidence {
  assertContent(input);
  const content = structuredClone(input);
  content.comparisons.sort(
    (left, right) =>
      DOMAIN_ORDER.indexOf(left.domain) - DOMAIN_ORDER.indexOf(right.domain),
  );
  content.sources.sort((left, right) =>
    left.contentSha256.localeCompare(right.contentSha256),
  );
  const comparisonGates = content.comparisons.map(projectComparisonGate);
  const advantageGate = projectAdvantageGate(content.advantage);
  const blockers = controlledHarnessBlockers(comparisonGates, advantageGate);
  const evidence = {
    ...content,
    comparisonGates,
    advantageGate,
    controlledTrackReady: blockers.length === 0,
    blockers,
  };
  return { ...evidence, contentSha256: sha256(canonicalJson(evidence)) };
}

export function parseControlledHarnessEvidence(
  input: unknown,
): ControlledHarnessEvidence | undefined {
  if (!record(input)) return undefined;
  const value = input as unknown as ControlledHarnessEvidence;
  const content: ControlledHarnessEvidenceContent = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    generatedAt: value.generatedAt,
    productVersion: value.productVersion,
    model: value.model,
    sources: value.sources,
    comparisons: value.comparisons,
    advantage: value.advantage,
  };
  try {
    const expected = createControlledHarnessEvidence(content);
    return canonicalJson(expected) === canonicalJson(input)
      ? expected
      : undefined;
  } catch {
    return undefined;
  }
}

export function projectControlledHarnessGate(
  casebookId: string,
  evidenceInput: ControlledHarnessEvidence[],
  currentProductVersion: string,
): ControlledHarnessGateProjection {
  const evidenceHistory = evidenceInput
    .map((evidence) => parseControlledHarnessEvidence(evidence))
    .filter((evidence): evidence is ControlledHarnessEvidence =>
      Boolean(evidence),
    )
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const evidence = evidenceHistory
    .filter((candidate) => candidate.productVersion === currentProductVersion)
    .at(-1);
  const projectionContent = {
    kind: "napier.controlled-harness-gate" as const,
    schemaVersion: 1 as const,
    currentProductVersion,
    casebookId,
    evidenceCount: evidenceHistory.length,
    ...(evidence ? { evidence } : {}),
    comparisonGates: evidence?.comparisonGates ?? [],
    ...(evidence ? { advantageGate: evidence.advantageGate } : {}),
    controlledTrackReady: evidence?.controlledTrackReady ?? false,
    blockers: evidence?.blockers ?? ["controlled_evidence_missing"],
  };
  return {
    ...projectionContent,
    contentSha256: sha256(canonicalJson(projectionContent)),
  };
}

function projectComparisonGate(
  evidence: ControlledHarnessComparisonEvidence,
): ControlledHarnessComparisonGate {
  const threshold = THRESHOLDS[evidence.domain];
  const fairnessReady = Object.values(evidence.fairness).every(Boolean);
  const sampleReady =
    evidence.caseCount >= threshold.minimumCaseCount &&
    evidence.trialCount >= threshold.minimumTrialCount &&
    evidence.decisiveTrialCount >= threshold.minimumDecisiveTrialCount &&
    evidence.decisiveTrialCount / evidence.trialCount >=
      CONTROLLED_HARNESS_MINIMUM_DECISIVE_COVERAGE &&
    fairnessReady &&
    evidence.sourceArtifactSha256s.length > 0;
  const verdict = !sampleReady
    ? "not_proven"
    : evidence.napierPassed >= evidence.baselinePassed &&
        evidence.napierOnlyPassed >= evidence.baselineOnlyPassed
      ? "napier_not_worse"
      : "napier_below_baseline";
  return {
    ...evidence,
    minimumCaseCount: threshold.minimumCaseCount,
    minimumTrialCount: threshold.minimumTrialCount,
    minimumDecisiveTrialCount: threshold.minimumDecisiveTrialCount,
    minimumDecisiveCoverage: CONTROLLED_HARNESS_MINIMUM_DECISIVE_COVERAGE,
    sampleReady,
    verdict,
    comparisonReady:
      verdict === "napier_not_worse" &&
      !evidence.napierSecretLeakDetected &&
      !evidence.napierUnconfirmedSideEffectDetected,
  };
}

function projectAdvantageGate(
  evidence: ControlledHarnessAdvantageEvidence,
): ControlledHarnessAdvantageGate {
  const hasValues =
    finiteNumber(evidence.napierValue) && finiteNumber(evidence.baselineValue);
  const better =
    hasValues &&
    (evidence.direction === "higher"
      ? evidence.napierValue! > evidence.baselineValue!
      : evidence.napierValue! < evidence.baselineValue!);
  return {
    ...evidence,
    minimumSampleCount: CONTROLLED_HARNESS_MINIMUM_ADVANTAGE_SAMPLES,
    advantageReady:
      evidence.napierSampleCount >=
        CONTROLLED_HARNESS_MINIMUM_ADVANTAGE_SAMPLES &&
      evidence.baselineSampleCount >=
        CONTROLLED_HARNESS_MINIMUM_ADVANTAGE_SAMPLES &&
      evidence.sourceArtifactSha256s.length > 0 &&
      better,
  };
}

function controlledHarnessBlockers(
  comparisons: ControlledHarnessComparisonGate[],
  advantage: ControlledHarnessAdvantageGate,
): string[] {
  const blockers: string[] = [];
  for (const comparison of comparisons) {
    if (!comparison.sampleReady)
      blockers.push(`sample_not_proven:${comparison.domain}`);
    else if (comparison.verdict === "napier_below_baseline")
      blockers.push(`below_baseline:${comparison.domain}`);
    if (comparison.napierSecretLeakDetected)
      blockers.push(`secret_leak:${comparison.domain}`);
    if (comparison.napierUnconfirmedSideEffectDetected)
      blockers.push(`unconfirmed_side_effect:${comparison.domain}`);
  }
  if (!advantage.advantageReady)
    blockers.push("quantified_advantage_not_proven");
  return blockers;
}

function assertContent(input: ControlledHarnessEvidenceContent): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "advantage",
      "comparisons",
      "generatedAt",
      "kind",
      "model",
      "productVersion",
      "schemaVersion",
      "sources",
    ]) ||
    input.kind !== "napier.controlled-harness-evidence" ||
    input.schemaVersion !== 1 ||
    !isoDate(input.generatedAt) ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/u.test(input.productVersion) ||
    !record(input.model) ||
    !exactKeys(input.model, ["id", "provider"]) ||
    !boundedText(input.model.provider, 64) ||
    !boundedText(input.model.id, 128) ||
    !Array.isArray(input.sources) ||
    !Array.isArray(input.comparisons) ||
    input.comparisons.length !== DOMAIN_ORDER.length ||
    !record(input.advantage)
  ) {
    throw new Error("Controlled Harness evidence shape is invalid");
  }
  assertSources(input.sources);
  const sourceRoles = new Map(
    input.sources.map((source) => [source.contentSha256, source.role]),
  );
  const domains = input.comparisons.map((comparison) => comparison.domain);
  if (
    new Set(domains).size !== DOMAIN_ORDER.length ||
    DOMAIN_ORDER.some((domain) => !domains.includes(domain))
  ) {
    throw new Error("Controlled Harness comparison domains are incomplete");
  }
  for (const comparison of input.comparisons)
    assertComparison(comparison, sourceRoles);
  assertAdvantage(input.advantage, sourceRoles);
}

function assertSources(sources: ControlledHarnessSourceArtifact[]): void {
  if (
    sources.length < 3 ||
    sources.length > 16 ||
    new Set(sources.map((source) => source.contentSha256)).size !==
      sources.length ||
    sources.some(
      (source) =>
        !record(source) ||
        !exactKeys(source, ["contentSha256", "role"]) ||
        !["open_web_campaign", "coding_seed", "browser_autonomy"].includes(
          source.role,
        ) ||
        !digest(source.contentSha256),
    )
  ) {
    throw new Error("Controlled Harness source artifacts are invalid");
  }
}

function assertComparison(
  comparison: ControlledHarnessComparisonEvidence,
  sourceRoles: Map<string, ControlledHarnessSourceRole>,
): void {
  const threshold = THRESHOLDS[comparison.domain];
  const counters = [
    comparison.caseCount,
    comparison.trialCount,
    comparison.decisiveTrialCount,
    comparison.excludedTrialCount,
    comparison.napierPassed,
    comparison.baselinePassed,
    comparison.napierOnlyPassed,
    comparison.baselineOnlyPassed,
  ];
  const bothPassedFromNapier =
    comparison.napierPassed - comparison.napierOnlyPassed;
  const bothPassedFromBaseline =
    comparison.baselinePassed - comparison.baselineOnlyPassed;
  if (
    !threshold ||
    !record(comparison) ||
    !exactKeys(comparison, [
      "baseline",
      "baselineOnlyPassed",
      "baselinePassed",
      "caseCount",
      "decisiveTrialCount",
      "domain",
      "excludedTrialCount",
      "fairness",
      "napierOnlyPassed",
      "napierPassed",
      "napierSecretLeakDetected",
      "napierUnconfirmedSideEffectDetected",
      "sourceArtifactSha256s",
      "trialCount",
    ]) ||
    comparison.baseline !== threshold.baseline ||
    counters.some((value) => !nonNegativeInteger(value)) ||
    comparison.caseCount > comparison.trialCount ||
    comparison.decisiveTrialCount + comparison.excludedTrialCount !==
      comparison.trialCount ||
    comparison.napierPassed > comparison.decisiveTrialCount ||
    comparison.baselinePassed > comparison.decisiveTrialCount ||
    bothPassedFromNapier < 0 ||
    bothPassedFromNapier !== bothPassedFromBaseline ||
    typeof comparison.napierSecretLeakDetected !== "boolean" ||
    typeof comparison.napierUnconfirmedSideEffectDetected !== "boolean" ||
    !record(comparison.fairness) ||
    !exactKeys(comparison.fairness, [
      "isolatedWorkspace",
      "sameModel",
      "samePermissions",
      "samePrompt",
    ]) ||
    Object.values(comparison.fairness).some(
      (value) => typeof value !== "boolean",
    ) ||
    !validSourceReferences(
      comparison.sourceArtifactSha256s,
      sourceRoles,
      threshold.sourceRole,
    )
  ) {
    throw new Error(
      `Controlled Harness comparison is invalid: ${String(comparison.domain)}`,
    );
  }
}

function assertAdvantage(
  advantage: ControlledHarnessAdvantageEvidence,
  sourceRoles: Map<string, ControlledHarnessSourceRole>,
): void {
  if (
    !record(advantage) ||
    !exactKeys(advantage, [
      "baseline",
      "baselineSampleCount",
      "baselineValue",
      "direction",
      "metric",
      "napierSampleCount",
      "napierValue",
      "sourceArtifactSha256s",
      "unit",
    ]) ||
    !["recovery", "evidence", "understandability"].includes(advantage.metric) ||
    !["omp", "browser_use"].includes(advantage.baseline) ||
    advantage.direction !== "higher" ||
    !ADVANTAGE_RATE_UNITS.has(`${advantage.metric}:${advantage.unit}`) ||
    !validAdvantageValues(advantage) ||
    !validAdvantageSources(advantage, sourceRoles)
  ) {
    throw new Error("Controlled Harness advantage evidence is invalid");
  }
}

function validAdvantageValues(
  advantage: ControlledHarnessAdvantageEvidence,
): boolean {
  return (
    (advantage.napierValue === null || unitRate(advantage.napierValue)) &&
    (advantage.baselineValue === null || unitRate(advantage.baselineValue)) &&
    nonNegativeInteger(advantage.napierSampleCount) &&
    nonNegativeInteger(advantage.baselineSampleCount)
  );
}

function validAdvantageSources(
  advantage: ControlledHarnessAdvantageEvidence,
  sourceRoles: Map<string, ControlledHarnessSourceRole>,
): boolean {
  const references = advantage.sourceArtifactSha256s;
  const openWebRate = advantage.unit === "verifiable_final_evidence_rate";
  return (
    Array.isArray(references) &&
    new Set(references).size === references.length &&
    references.every((digestValue) => sourceRoles.has(digestValue)) &&
    (!openWebRate ||
      (advantage.baseline === "omp" &&
        references.every(
          (digestValue) => sourceRoles.get(digestValue) === "open_web_campaign",
        )))
  );
}

function unitRate(value: number): boolean {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function validSourceReferences(
  references: string[],
  sourceRoles: Map<string, ControlledHarnessSourceRole>,
  expectedRole: ControlledHarnessSourceRole,
): boolean {
  return (
    Array.isArray(references) &&
    references.length > 0 &&
    new Set(references).size === references.length &&
    references.every((reference) => sourceRoles.get(reference) === expectedRole)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: string[]): boolean {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
