import type {
  ExperimentDecisionRule,
  HarnessAnalysisProtocol,
  HarnessExperiment,
  HarnessExperimentCase,
  HarnessExperimentEvaluation,
  HarnessExperimentMetric,
  HarnessExperimentProfile,
  HarnessExperimentTrial,
  ModelRouteLock,
  HarnessCorpusBinding,
} from "@napier/contracts/harness-experiments";

import {
  canonicalJson,
  sha256,
  validateModelHarnessExperimentProfile,
} from "@napier/runtime/harness-eval-support";

import {
  analysisProtocol,
  clusteredMetricDecision,
  legacyMetricDecision,
  metricUnits,
} from "./harness-experiment-analysis.js";
import { familySummaries } from "./harness-experiment-family-summary.js";
import { validateHarnessCorpusBinding } from "./harness-corpus.js";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9_.-]{2,79}$/u;
const METRICS = new Set(Object.keys(metricUnits));

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
  corpus?: HarnessCorpusBinding;
  analysis?: Partial<Omit<HarnessAnalysisProtocol, "metrics">> & {
    metrics?: HarnessAnalysisProtocol["metrics"];
  };
}): HarnessExperiment {
  return buildExperiment(input, false);
}

function buildExperiment(
  input: Parameters<typeof createHarnessExperiment>[0],
  historical: boolean,
): HarnessExperiment {
  const cases = normalizeCases(input.cases, historical);
  const corpus = input.corpus ? validateHarnessCorpusBinding(input.corpus, cases) : undefined;
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
    ...(corpus ? { corpus } : {}),
    ...(!historical
      ? {
          analysis: analysisProtocol(
            { primaryMetrics, guardrailMetrics, decisionRule },
            input.analysis,
          ),
        }
      : {}),
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
  const rebuilt = buildExperiment(
    {
      id: String(input["id"] ?? ""),
      baselineProfile: input["baselineProfile"] as HarnessExperimentProfile,
      candidateProfile: input["candidateProfile"] as HarnessExperimentProfile,
      cases: array(input["cases"]) as HarnessExperimentCase[],
      modelRouteLock: input["modelRouteLock"] as ModelRouteLock,
      seeds: array(input["seeds"]).map(Number),
      primaryMetrics: array(
        input["primaryMetrics"],
      ) as HarnessExperimentMetric[],
      guardrailMetrics: array(
        input["guardrailMetrics"],
      ) as HarnessExperimentMetric[],
      decisionRule: input["decisionRule"] as ExperimentDecisionRule,
      analysis: input["analysis"] as HarnessAnalysisProtocol,
      ...(input["corpus"] ? { corpus: input["corpus"] as HarnessCorpusBinding } : {}),
    },
    input["analysis"] === undefined,
  );
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
  let evidenceKindMismatchPairCount = 0;
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
    if (
      experiment.analysis &&
      [baseline, candidate].some(
        (trial) =>
          (trial.evidenceKind ?? "contract_fixture") !==
          experiment.analysis!.evidenceKind,
      )
    ) {
      evidenceKindMismatchPairCount++;
      continue;
    }
    comparable.push({ baseline, candidate });
  }
  const primary = experiment.primaryMetrics.map((metric) =>
    experiment.analysis
      ? clusteredMetricDecision(experiment, metric, comparable)
      : legacyMetricDecision(
          metric,
          comparable,
          experiment.decisionRule.primaryNonInferiorityMargin,
        ),
  );
  const guardrails = experiment.guardrailMetrics.map((metric) =>
    experiment.analysis
      ? clusteredMetricDecision(experiment, metric, comparable)
      : legacyMetricDecision(
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
    (metric) =>
      metric.status === "improved" ||
      (metric.status === "passed" &&
        (metric.direction === "higher"
          ? metric.delta! > 0
          : metric.delta! < 0)),
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
    ...(experiment.analysis
      ? {
          evidenceKind: experiment.analysis.evidenceKind,
          evidenceKindMismatchPairCount,
          families: familySummaries(experiment, [...byKey.values()]),
        }
      : {}),
    verdict: insufficient
      ? ("insufficient_evidence" as const)
      : regressed
        ? ("regressed" as const)
        : [...primary, ...guardrails].some(
              (metric) => metric.status === "inconclusive",
            )
          ? ("inconclusive" as const)
          : improved
            ? ("improved" as const)
            : experiment.analysis ||
                [...primary, ...guardrails].some((metric) => metric.delta !== 0)
              ? ("non_inferior" as const)
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
        !METRICS.has(metric) ||
        !finite(value) ||
        value < 0 ||
        (metricUnits[metric as HarnessExperimentMetric] === "fraction" &&
          value > 1),
    )
  ) {
    throw new Error("Harness experiment trial is invalid");
  }
}

function normalizeCases(
  cases: HarnessExperimentCase[],
  historical: boolean,
): HarnessExperimentCase[] {
  if (!Array.isArray(cases))
    throw new Error("Harness experiment cases are invalid");
  const normalized = cases.map((item) => ({
    id: item.id,
    inputSha256: item.inputSha256,
    tags: [...new Set(item.tags)].sort(),
    ...(!historical
      ? {
          taskFamily: item.taskFamily ?? [...item.tags].sort()[0] ?? item.id,
          partition: item.partition ?? ("regression" as const),
        }
      : {}),
  }));
  if (
    normalized.some(
      (item) =>
        !ID.test(item.id) ||
        !HASH.test(item.inputSha256) ||
        (!historical &&
          (!ID.test(item.taskFamily!) ||
            !["tuning", "regression", "holdout"].includes(item.partition!))) ||
        item.tags.some((tag) => !ID.test(tag)),
    ) ||
    new Set(normalized.map((item) => item.id)).size !== normalized.length
  ) {
    throw new Error("Harness experiment case set is invalid");
  }
  const partitions = new Map<string, string>();
  for (const item of normalized) {
    if (!item.taskFamily) continue;
    const previous = partitions.get(item.taskFamily);
    if (previous && previous !== item.partition)
      throw new Error(
        "A task family cannot span tuning, regression and holdout partitions",
      );
    partitions.set(item.taskFamily, item.partition!);
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
  try {
    validateModelHarnessExperimentProfile(profile);
    return true;
  } catch {
    return false;
  }
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
