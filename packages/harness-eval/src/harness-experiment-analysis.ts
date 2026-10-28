import type {
  HarnessAnalysisProtocol,
  HarnessExperiment,
  HarnessExperimentMetric,
  HarnessExperimentMetricDecision,
  HarnessExperimentTrial,
  HarnessMetricRule,
} from "@napier/contracts/harness-experiments";

export const metricUnits: Record<
  HarnessExperimentMetric,
  HarnessMetricRule["unit"]
> = {
  task_success: "fraction",
  input_tokens: "tokens",
  output_tokens: "tokens",
  tool_schema_tokens: "tokens",
  duration_ms: "milliseconds",
  tool_call_count: "count",
  repeated_call_rate: "fraction",
  no_new_information_rate: "fraction",
  intervention_count: "count",
  overflow_failed_count: "count",
  evidence_completeness: "fraction",
  cost_usd: "usd",
  false_completion: "fraction",
};

export function metricDirection(
  metric: HarnessExperimentMetric,
): "higher" | "lower" {
  return metric === "task_success" || metric === "evidence_completeness"
    ? "higher"
    : "lower";
}

export function analysisProtocol(
  experiment: Pick<
    HarnessExperiment,
    "primaryMetrics" | "guardrailMetrics" | "decisionRule"
  >,
  input?: Partial<Omit<HarnessAnalysisProtocol, "metrics">> & {
    metrics?: HarnessAnalysisProtocol["metrics"];
  },
): HarnessAnalysisProtocol {
  const metrics = [
    ...experiment.primaryMetrics,
    ...experiment.guardrailMetrics,
  ];
  if (
    Object.keys(input?.metrics ?? {}).some(
      (key) => !metrics.includes(key as HarnessExperimentMetric),
    )
  )
    throw new Error("Analysis metric is not declared in the experiment");
  const result: HarnessAnalysisProtocol = {
    version: 1,
    evidenceKind: "contract_fixture",
    order: "balanced_ab_ba",
    clusterBy: "case",
    confidenceLevel: 0.95,
    bootstrapSamples: 2000,
    bootstrapSeed: 20261029,
    minimumClusters: 10,
    ...input,
    metrics: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
          unit: metricUnits[metric],
          direction: metricDirection(metric),
          nonInferiorityMargin: experiment.primaryMetrics.includes(metric)
            ? experiment.decisionRule.primaryNonInferiorityMargin
            : experiment.decisionRule.guardrailRegressionTolerance,
          minimumEffectiveDifference: 0,
          ...input?.metrics?.[metric],
        },
      ]),
    ),
  };
  validateSamplingProtocol(result);
  for (const metric of metrics) {
    const rule = result.metrics[metric]!;
    if (
      rule.unit !== metricUnits[metric] ||
      rule.direction !== metricDirection(metric) ||
      !Number.isFinite(rule.nonInferiorityMargin) ||
      rule.nonInferiorityMargin < 0 ||
      !Number.isFinite(rule.minimumEffectiveDifference) ||
      rule.minimumEffectiveDifference < 0
    )
      throw new Error(`Harness metric rule is invalid: ${metric}`);
  }
  return result;
}

function validateSamplingProtocol(protocol: HarnessAnalysisProtocol): void {
  if (
    protocol.version !== 1 ||
    protocol.order !== "balanced_ab_ba" ||
    ![
      "contract_fixture",
      "deterministic_integration",
      "live_model",
      "production_task",
    ].includes(protocol.evidenceKind) ||
    !["case", "task_family"].includes(protocol.clusterBy) ||
    !Number.isFinite(protocol.confidenceLevel) ||
    protocol.confidenceLevel < 0.9 ||
    protocol.confidenceLevel > 0.999 ||
    !Number.isSafeInteger(protocol.bootstrapSamples) ||
    protocol.bootstrapSamples < 1000 ||
    protocol.bootstrapSamples > 100_000 ||
    !Number.isSafeInteger(protocol.bootstrapSeed) ||
    protocol.bootstrapSeed < 0 ||
    protocol.bootstrapSeed > 0xffffffff ||
    !Number.isSafeInteger(protocol.minimumClusters) ||
    protocol.minimumClusters < 10 ||
    protocol.minimumClusters > 100
  )
    throw new Error("Harness analysis protocol is invalid");
}

export function clusteredMetricDecision(
  experiment: HarnessExperiment,
  metric: HarnessExperimentMetric,
  pairs: readonly {
    baseline: HarnessExperimentTrial;
    candidate: HarnessExperimentTrial;
  }[],
): HarnessExperimentMetricDecision {
  const protocol = experiment.analysis!;
  const rule = protocol.metrics[metric]!;
  const clusters = new Map<
    string,
    { baseline: number[]; candidate: number[] }
  >();
  let pairCount = 0;
  for (const { baseline, candidate } of pairs) {
    const left = baseline.metrics[metric];
    const right = candidate.metrics[metric];
    if (left === undefined || right === undefined) continue;
    pairCount++;
    const item = experiment.cases.find((item) => item.id === baseline.caseId)!;
    const key = protocol.clusterBy === "case" ? item.id : item.taskFamily!;
    const cluster = clusters.get(key) ?? { baseline: [], candidate: [] };
    cluster.baseline.push(left);
    cluster.candidate.push(right);
    clusters.set(key, cluster);
  }
  const base = { metric, ...rule, pairCount, clusterCount: clusters.size };
  if (
    !pairCount ||
    pairCount !== pairs.length ||
    clusters.size < protocol.minimumClusters
  )
    return { ...base, status: "insufficient" };
  // A case (or family) is one independent unit. Seeds never inflate its weight.
  const observations = [...clusters.values()].map((group) => ({
    baseline: mean(group.baseline),
    candidate: mean(group.candidate),
  }));
  const baselineMean = mean(observations.map((item) => item.baseline));
  const candidateMean = mean(observations.map((item) => item.candidate));
  const differences = observations.map(
    (item) => item.candidate - item.baseline,
  );
  const random = seededRandom(protocol.bootstrapSeed);
  const samples = Array.from({ length: protocol.bootstrapSamples }, () => {
    let sum = 0;
    for (let index = 0; index < differences.length; index++)
      sum += differences[Math.floor(random() * differences.length)]!;
    return sum / differences.length;
  }).sort((a, b) => a - b);
  // Simultaneous intervals protect the "any primary improves" decision.
  const tails =
    (1 - protocol.confidenceLevel) /
    (2 *
      (experiment.primaryMetrics.length + experiment.guardrailMetrics.length));
  const lower = quantile(samples, tails);
  const upper = quantile(samples, 1 - tails);
  const benefitLower = rule.direction === "higher" ? lower : -upper;
  const benefitUpper = rule.direction === "higher" ? upper : -lower;
  // Rounding at an inclusive boundary must not turn equality into regression.
  const slack =
    64 *
    Number.EPSILON *
    Math.max(1, Math.abs(baselineMean), Math.abs(candidateMean));
  const status =
    benefitLower > rule.minimumEffectiveDifference + slack
      ? "improved"
      : benefitUpper < -rule.nonInferiorityMargin - slack
        ? "regressed"
        : benefitLower >= -rule.nonInferiorityMargin - slack
          ? "non_inferior"
          : "inconclusive";
  return {
    ...base,
    baselineMean,
    candidateMean,
    delta: candidateMean - baselineMean,
    confidenceInterval: { lower, upper, level: protocol.confidenceLevel },
    status,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position);
  return (
    sorted[left]! +
    (sorted[Math.ceil(position)]! - sorted[left]!) * (position - left)
  );
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function legacyMetricDecision(
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
    return typeof baseline === "number" && typeof candidate === "number"
      ? [{ baseline, candidate }]
      : [];
  });
  const direction = metricDirection(metric);
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
