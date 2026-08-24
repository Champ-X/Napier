import type {
  ExperimentDecisionRule,
  HarnessExperiment,
  HarnessExperimentCase,
  HarnessExperimentEvaluation,
  HarnessExperimentMetric,
  HarnessExperimentMetricDecision,
  HarnessExperimentProfile,
  HarnessExperimentTrial,
  ModelRouteLock,
} from "@napier/contracts/harness-experiments";

import { canonicalJson, sha256 } from "./ed25519.js";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9_.-]{2,79}$/u;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const METRICS = new Set<HarnessExperimentMetric>([
  "task_success",
  "input_tokens",
  "output_tokens",
  "tool_schema_tokens",
  "duration_ms",
  "tool_call_count",
  "repeated_call_rate",
  "no_new_information_rate",
  "intervention_count",
  "overflow_failed_count",
  "evidence_completeness",
]);
const HIGHER_IS_BETTER = new Set<HarnessExperimentMetric>([
  "task_success",
  "evidence_completeness",
]);

export function createHarnessExperiment(input: {
  id: string;
  baselineProfile: HarnessExperimentProfile;
  candidateProfile: HarnessExperimentProfile;
  cases: HarnessExperimentCase[];
  modelRouteLock: ModelRouteLock;
  seeds: number[];
  primaryMetrics: HarnessExperimentMetric[];
  guardrailMetrics: HarnessExperimentMetric[];
  decisionRule?: Partial<ExperimentDecisionRule>;
}): HarnessExperiment {
  const cases = normalizeCases(input.cases);
  const seeds = uniqueSeeds(input.seeds);
  const decisionRule: ExperimentDecisionRule = {
    minimumCases: input.decisionRule?.minimumCases ?? 30,
    minimumSeedsPerCase: input.decisionRule?.minimumSeedsPerCase ?? 3,
    primaryNonInferiorityMargin:
      input.decisionRule?.primaryNonInferiorityMargin ?? 0,
    guardrailRegressionTolerance:
      input.decisionRule?.guardrailRegressionTolerance ?? 0,
  };
  validateIdentity(input.id, input.baselineProfile, input.candidateProfile);
  validateRouteLock(input.modelRouteLock);
  validateDecisionRule(decisionRule);
  if (cases.length < decisionRule.minimumCases || cases.length > 100) {
    throw new Error(
      `Harness experiment requires ${String(decisionRule.minimumCases)}-100 cases`,
    );
  }
  if (seeds.length < decisionRule.minimumSeedsPerCase) {
    throw new Error(
      `Harness experiment requires at least ${String(decisionRule.minimumSeedsPerCase)} seeds`,
    );
  }
  const primaryMetrics = metricSet(input.primaryMetrics, "primary");
  const guardrailMetrics = metricSet(input.guardrailMetrics, "guardrail");
  if (primaryMetrics.some((metric) => guardrailMetrics.includes(metric))) {
    throw new Error("Harness experiment metrics must not overlap");
  }
  const caseSetDigest = sha256(canonicalJson(cases));
  const content = {
    kind: "napier.harness-experiment" as const,
    schemaVersion: 1 as const,
    id: input.id,
    baselineProfile: input.baselineProfile,
    candidateProfile: input.candidateProfile,
    cases,
    caseSetDigest,
    modelRouteLock: structuredClone(input.modelRouteLock),
    seeds,
    primaryMetrics,
    guardrailMetrics,
    decisionRule,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateHarnessExperiment(input: unknown): HarnessExperiment {
  if (
    !record(input) ||
    input["kind"] !== "napier.harness-experiment" ||
    input["schemaVersion"] !== 1
  ) {
    throw new Error("Harness experiment is invalid");
  }
  const rebuilt = createHarnessExperiment({
    id: String(input["id"] ?? ""),
    baselineProfile: input["baselineProfile"] as HarnessExperimentProfile,
    candidateProfile: input["candidateProfile"] as HarnessExperimentProfile,
    cases: array(input["cases"]) as HarnessExperimentCase[],
    modelRouteLock: input["modelRouteLock"] as ModelRouteLock,
    seeds: array(input["seeds"]).map(Number),
    primaryMetrics: array(input["primaryMetrics"]) as HarnessExperimentMetric[],
    guardrailMetrics: array(
      input["guardrailMetrics"],
    ) as HarnessExperimentMetric[],
    decisionRule: input["decisionRule"] as ExperimentDecisionRule,
  });
  if (
    input["caseSetDigest"] !== rebuilt.caseSetDigest ||
    input["contentSha256"] !== rebuilt.contentSha256
  ) {
    throw new Error("Harness experiment hash binding is invalid");
  }
  return rebuilt;
}

export function evaluateHarnessExperiment(
  experimentInput: HarnessExperiment,
  trials: readonly HarnessExperimentTrial[],
): HarnessExperimentEvaluation {
  const experiment = validateHarnessExperiment(experimentInput);
  const expected = expectedPairs(experiment);
  const byKey = new Map<string, HarnessExperimentTrial>();
  const runIds = new Set<string>();
  for (const trial of trials) {
    validateHarnessExperimentTrial(experiment, trial);
    const key = trialKey(trial.caseId, trial.seed, trial.arm);
    if (byKey.has(key))
      throw new Error(`Duplicate Harness experiment trial: ${key}`);
    if (runIds.has(trial.runId))
      throw new Error(`Duplicate Harness experiment Run: ${trial.runId}`);
    runIds.add(trial.runId);
    byKey.set(key, structuredClone(trial));
  }
  const comparable: Array<{
    baseline: HarnessExperimentTrial;
    candidate: HarnessExperimentTrial;
  }> = [];
  let fallbackPairCount = 0;
  let servingModelMismatchPairCount = 0;
  let profileMismatchPairCount = 0;
  let missingPairCount = 0;
  for (const pair of expected) {
    const baseline = byKey.get(trialKey(pair.caseId, pair.seed, "baseline"));
    const candidate = byKey.get(trialKey(pair.caseId, pair.seed, "candidate"));
    if (!baseline || !candidate) {
      missingPairCount += 1;
      continue;
    }
    if (baseline.fallbackUsed || candidate.fallbackUsed) {
      fallbackPairCount += 1;
      continue;
    }
    if (
      !lockedModel(experiment.modelRouteLock, baseline) ||
      !lockedModel(experiment.modelRouteLock, candidate)
    ) {
      servingModelMismatchPairCount += 1;
      continue;
    }
    if (
      baseline.profileSha256 !== experiment.baselineProfile.contentSha256 ||
      candidate.profileSha256 !== experiment.candidateProfile.contentSha256
    ) {
      profileMismatchPairCount += 1;
      continue;
    }
    comparable.push({ baseline, candidate });
  }
  const primary = experiment.primaryMetrics.map((metric) =>
    metricDecision(
      metric,
      comparable,
      experiment.decisionRule.primaryNonInferiorityMargin,
    ),
  );
  const guardrails = experiment.guardrailMetrics.map((metric) =>
    metricDecision(
      metric,
      comparable,
      experiment.decisionRule.guardrailRegressionTolerance,
    ),
  );
  const insufficient =
    comparable.length !== expected.length ||
    [...primary, ...guardrails].some(
      (metric) => metric.status === "insufficient",
    );
  const regressed = [...primary, ...guardrails].some(
    (metric) => metric.status === "regressed",
  );
  const improved = primary.some(
    (metric) => metric.status === "passed" && metric.delta !== 0,
  );
  const content = {
    kind: "napier.harness-experiment-evaluation" as const,
    schemaVersion: 1 as const,
    experimentId: experiment.id,
    experimentSha256: experiment.contentSha256,
    expectedPairCount: expected.length,
    comparablePairCount: comparable.length,
    fallbackPairCount,
    servingModelMismatchPairCount,
    profileMismatchPairCount,
    missingPairCount,
    primary,
    guardrails,
    verdict: insufficient
      ? ("insufficient_evidence" as const)
      : regressed
        ? ("regressed" as const)
        : improved
          ? ("improved" as const)
          : ("no_difference" as const),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateHarnessExperimentTrial(
  experiment: HarnessExperiment,
  trial: HarnessExperimentTrial,
): void {
  if (
    !experiment.cases.some((item) => item.id === trial.caseId) ||
    !experiment.seeds.includes(trial.seed) ||
    (trial.arm !== "baseline" && trial.arm !== "candidate") ||
    typeof trial.runId !== "string" ||
    !trial.runId ||
    !HASH.test(trial.profileSha256) ||
    !HASH.test(trial.harnessReceiptSha256) ||
    !record(trial.metrics) ||
    Object.entries(trial.metrics).some(
      ([metric, value]) =>
        !METRICS.has(metric as HarnessExperimentMetric) || !finite(value),
    )
  ) {
    throw new Error("Harness experiment trial is invalid");
  }
}

function metricDecision(
  metric: HarnessExperimentMetric,
  pairs: readonly {
    baseline: HarnessExperimentTrial;
    candidate: HarnessExperimentTrial;
  }[],
  tolerance: number,
): HarnessExperimentMetricDecision {
  const observations = pairs.flatMap((pair) => {
    const baseline = pair.baseline.metrics[metric];
    const candidate = pair.candidate.metrics[metric];
    return finite(baseline) && finite(candidate)
      ? [{ baseline, candidate }]
      : [];
  });
  const direction = HIGHER_IS_BETTER.has(metric) ? "higher" : "lower";
  if (observations.length !== pairs.length || observations.length === 0) {
    return {
      metric,
      direction,
      pairCount: observations.length,
      status: "insufficient",
    };
  }
  const baselineMean = mean(observations.map((item) => item.baseline));
  const candidateMean = mean(observations.map((item) => item.candidate));
  const delta = candidateMean - baselineMean;
  const passed =
    direction === "higher" ? delta >= -tolerance : delta <= tolerance;
  return {
    metric,
    direction,
    pairCount: observations.length,
    baselineMean,
    candidateMean,
    delta,
    status: passed ? "passed" : "regressed",
  };
}

function normalizeCases(
  cases: HarnessExperimentCase[],
): HarnessExperimentCase[] {
  if (!Array.isArray(cases))
    throw new Error("Harness experiment cases are invalid");
  const normalized = cases.map((item) => ({
    id: item.id,
    inputSha256: item.inputSha256,
    tags: [...new Set(item.tags)].sort(),
  }));
  if (
    normalized.some(
      (item) =>
        !ID.test(item.id) ||
        !HASH.test(item.inputSha256) ||
        item.tags.some((tag) => !ID.test(tag)),
    ) ||
    new Set(normalized.map((item) => item.id)).size !== normalized.length
  ) {
    throw new Error("Harness experiment case set is invalid");
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSeeds(seeds: number[]): number[] {
  if (
    !Array.isArray(seeds) ||
    seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
  ) {
    throw new Error("Harness experiment seeds are invalid");
  }
  const normalized = [...new Set(seeds)].sort((left, right) => left - right);
  if (normalized.length !== seeds.length)
    throw new Error("Harness experiment seeds must be unique");
  return normalized;
}

function metricSet(
  metrics: HarnessExperimentMetric[],
  label: string,
): HarnessExperimentMetric[] {
  if (
    !Array.isArray(metrics) ||
    metrics.length < 1 ||
    metrics.some((metric) => !METRICS.has(metric))
  ) {
    throw new Error(`Harness experiment ${label} metrics are invalid`);
  }
  const unique = [...new Set(metrics)];
  if (unique.length !== metrics.length)
    throw new Error(`Harness experiment ${label} metrics must be unique`);
  return unique;
}

function validateIdentity(
  id: string,
  baseline: HarnessExperimentProfile,
  candidate: HarnessExperimentProfile,
): void {
  if (
    !ID.test(id) ||
    !validProfile(baseline) ||
    !validProfile(candidate) ||
    baseline.id === candidate.id ||
    baseline.contentSha256 === candidate.contentSha256
  ) {
    throw new Error("Harness experiment identity is invalid");
  }
}

function validateRouteLock(lock: ModelRouteLock): void {
  if (
    !record(lock) ||
    !["default", "fast", "reasoning", "vision", "subagent"].includes(
      lock.role,
    ) ||
    lock.fallbackSamples !== "separate_stratum" ||
    !record(lock.servingModel) ||
    typeof lock.servingModel.provider !== "string" ||
    typeof lock.servingModel.id !== "string" ||
    !lock.servingModel.provider ||
    !lock.servingModel.id
  ) {
    throw new Error("Harness experiment Model Route lock is invalid");
  }
}

function validateDecisionRule(rule: ExperimentDecisionRule): void {
  if (
    !record(rule) ||
    !Number.isSafeInteger(rule.minimumCases) ||
    rule.minimumCases < 10 ||
    rule.minimumCases > 100 ||
    !Number.isSafeInteger(rule.minimumSeedsPerCase) ||
    rule.minimumSeedsPerCase < 3 ||
    !finite(rule.primaryNonInferiorityMargin) ||
    rule.primaryNonInferiorityMargin < 0 ||
    !finite(rule.guardrailRegressionTolerance) ||
    rule.guardrailRegressionTolerance < 0
  ) {
    throw new Error("Harness experiment decision rule is invalid");
  }
}

function validProfile(profile: unknown): profile is HarnessExperimentProfile {
  if (!record(profile)) return false;
  const { contentSha256, ...content } = profile;
  return (
    Object.keys(profile).length === 5 &&
    profile["kind"] === "napier.model-harness-experiment-profile" &&
    profile["schemaVersion"] === 1 &&
    typeof profile["id"] === "string" &&
    PROFILE.test(profile["id"]) &&
    Number.isSafeInteger(profile["maxActiveTools"]) &&
    Number(profile["maxActiveTools"]) > 0 &&
    typeof contentSha256 === "string" &&
    sha256(canonicalJson(content)) === contentSha256
  );
}

function expectedPairs(
  experiment: HarnessExperiment,
): Array<{ caseId: string; seed: number }> {
  return experiment.cases.flatMap((item) =>
    experiment.seeds.map((seed) => ({ caseId: item.id, seed })),
  );
}

function lockedModel(
  lock: ModelRouteLock,
  trial: HarnessExperimentTrial,
): boolean {
  return (
    trial.servingModel.provider === lock.servingModel.provider &&
    trial.servingModel.id === lock.servingModel.id
  );
}

function trialKey(
  caseId: string,
  seed: number,
  arm: "baseline" | "candidate",
): string {
  return `${caseId}:${String(seed)}:${arm}`;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Harness experiment array is invalid");
  return value;
}
