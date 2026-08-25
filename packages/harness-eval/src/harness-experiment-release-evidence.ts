import type {
  HarnessExperiment,
  HarnessExperimentExecution,
  HarnessExperimentMetric,
  HarnessExperimentRegressionAttribution,
  HarnessExperimentRegressionFactor,
  HarnessExperimentReleaseBinding,
  HarnessExperimentReleaseEvidence,
  HarnessExperimentTrendPoint,
} from "@napier/contracts/harness-experiments";

import { canonicalJson, sha256 } from "@napier/runtime/harness-eval-support";
import { validateHarnessExperiment } from "./harness-experiment-definition.js";
import { validateHarnessExperimentExecution } from "./harness-experiment-execution.js";

const HASH = /^[a-f0-9]{64}$/u;
const PRODUCT_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/u;
const CREDENTIAL_CLASS = /^[a-z][a-z0-9_.-]{1,63}$/u;

export function createHarnessExperimentReleaseEvidence(input: {
  generatedAt: string;
  productVersion: string;
  experiment: HarnessExperiment;
  executions: HarnessExperimentExecution[];
  bindings: HarnessExperimentReleaseBinding[];
}): HarnessExperimentReleaseEvidence {
  const experiment = validateHarnessExperiment(input.experiment);
  assertReleaseIdentity(input.generatedAt, input.productVersion);
  const executions = input.executions
    .map((execution) =>
      validateHarnessExperimentExecution(execution, experiment),
    )
    .sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
  if (executions.length < 1 || executions.length > 64) {
    throw new Error("Harness experiment release history is invalid");
  }
  const bindings = normalizeBindings(input.bindings, executions);
  const trend = executions.map(projectTrendPoint);
  const regressionAttribution = attributeRegression(executions, bindings);
  const blockers = releaseBlockers(
    experiment,
    executions,
    bindings,
    regressionAttribution,
  );
  const content = {
    kind: "napier.harness-experiment-release-evidence" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    productVersion: input.productVersion,
    experiment,
    executions,
    bindings,
    trend,
    regressionAttribution,
    promotionReady: blockers.length === 0,
    blockers,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateHarnessExperimentReleaseEvidence(
  input: unknown,
): HarnessExperimentReleaseEvidence {
  if (
    !record(input) ||
    input["kind"] !== "napier.harness-experiment-release-evidence" ||
    input["schemaVersion"] !== 1
  ) {
    throw new Error("Harness experiment release evidence is invalid");
  }
  const rebuilt = createHarnessExperimentReleaseEvidence({
    generatedAt: String(input["generatedAt"] ?? ""),
    productVersion: String(input["productVersion"] ?? ""),
    experiment: input["experiment"] as HarnessExperiment,
    executions: array(input["executions"]) as HarnessExperimentExecution[],
    bindings: array(input["bindings"]) as HarnessExperimentReleaseBinding[],
  });
  if (canonicalJson(rebuilt) !== canonicalJson(input)) {
    throw new Error("Harness experiment release evidence hash is invalid");
  }
  return rebuilt;
}

function normalizeBindings(
  input: HarnessExperimentReleaseBinding[],
  executions: HarnessExperimentExecution[],
): HarnessExperimentReleaseBinding[] {
  if (!Array.isArray(input) || input.length !== executions.length) {
    throw new Error("Harness experiment release bindings are incomplete");
  }
  const byExecution = new Map(
    input.map((binding) => [binding.executionSha256, binding]),
  );
  if (byExecution.size !== input.length) {
    throw new Error("Harness experiment release bindings are duplicated");
  }
  return executions.map((execution) => {
    const binding = byExecution.get(execution.contentSha256);
    if (
      !binding ||
      !HASH.test(binding.sourceManifestSha256) ||
      !HASH.test(binding.configurationSha256) ||
      !CREDENTIAL_CLASS.test(binding.credentialClass)
    ) {
      throw new Error("Harness experiment release binding is invalid");
    }
    return structuredClone(binding);
  });
}

function projectTrendPoint(
  execution: HarnessExperimentExecution,
): HarnessExperimentTrendPoint {
  const decisions = [
    ...execution.evaluation.primary,
    ...execution.evaluation.guardrails,
  ];
  return {
    executionSha256: execution.contentSha256,
    finishedAt: execution.finishedAt,
    verdict: execution.evaluation.verdict,
    comparablePairCount: execution.evaluation.comparablePairCount,
    fallbackPairCount: execution.evaluation.fallbackPairCount,
    servingModelMismatchPairCount:
      execution.evaluation.servingModelMismatchPairCount,
    profileMismatchPairCount: execution.evaluation.profileMismatchPairCount,
    metricDeltas: Object.fromEntries(
      decisions.flatMap((decision) =>
        decision.delta === undefined ? [] : [[decision.metric, decision.delta]],
      ),
    ) as Partial<Record<HarnessExperimentMetric, number>>,
  };
}

function attributeRegression(
  executions: HarnessExperimentExecution[],
  bindings: HarnessExperimentReleaseBinding[],
): HarnessExperimentRegressionAttribution {
  const latest = executions.at(-1)!;
  const previous = executions.at(-2);
  const base = {
    latestExecutionSha256: latest.contentSha256,
    ...(previous ? { previousExecutionSha256: previous.contentSha256 } : {}),
  };
  if (latest.evaluation.verdict === "insufficient_evidence") {
    return { ...base, status: "insufficient_evidence", factors: [] };
  }
  if (latest.evaluation.verdict !== "regressed") {
    return { ...base, status: "not_regressed", factors: [] };
  }
  if (!previous) {
    return { ...base, status: "insufficient_evidence", factors: [] };
  }
  const factors = changedFactors(bindings.at(-2)!, bindings.at(-1)!);
  return factors.length > 0
    ? { ...base, status: "confounded", factors }
    : {
        ...base,
        status: "controlled_candidate_regression",
        factors: ["candidate_profile"],
      };
}

function changedFactors(
  previous: HarnessExperimentReleaseBinding,
  latest: HarnessExperimentReleaseBinding,
): HarnessExperimentRegressionFactor[] {
  const factors: HarnessExperimentRegressionFactor[] = [];
  if (previous.sourceManifestSha256 !== latest.sourceManifestSha256)
    factors.push("source_manifest");
  if (previous.configurationSha256 !== latest.configurationSha256)
    factors.push("configuration");
  if (previous.credentialClass !== latest.credentialClass)
    factors.push("credential_class");
  return factors;
}

function releaseBlockers(
  experiment: HarnessExperiment,
  executions: HarnessExperimentExecution[],
  bindings: HarnessExperimentReleaseBinding[],
  attribution: HarnessExperimentRegressionAttribution,
): string[] {
  const latest = executions.at(-1)!;
  const blockers: string[] = [];
  if (experiment.cases.length < 30) blockers.push("release_case_set_below_30");
  if (executions.length < 2)
    blockers.push("experiment_trend_history_insufficient");
  if (executions.length >= 2) {
    for (const factor of changedFactors(bindings.at(-2)!, bindings.at(-1)!)) {
      blockers.push(`release_control_drift:${factor}`);
    }
  }
  if (latest.evaluation.verdict === "insufficient_evidence")
    blockers.push("latest_experiment_insufficient");
  if (latest.evaluation.verdict === "regressed")
    blockers.push("latest_experiment_regressed");
  if (attribution.status === "confounded")
    blockers.push("regression_attribution_confounded");
  const toolTokens = toolSchemaReduction(latest);
  if (
    !toolTokens ||
    toolTokens.baselineMean <= 0 ||
    (toolTokens.baselineMean - toolTokens.candidateMean) /
      toolTokens.baselineMean <
      0.35
  ) {
    blockers.push("tool_schema_token_reduction_below_35_percent");
  }
  return blockers;
}

function toolSchemaReduction(
  execution: HarnessExperimentExecution,
): { baselineMean: number; candidateMean: number } | undefined {
  const baseline = execution.trials.flatMap((trial) =>
    trial.arm === "baseline" &&
    typeof trial.metrics.tool_schema_tokens === "number"
      ? [trial.metrics.tool_schema_tokens]
      : [],
  );
  const candidate = execution.trials.flatMap((trial) =>
    trial.arm === "candidate" &&
    typeof trial.metrics.tool_schema_tokens === "number"
      ? [trial.metrics.tool_schema_tokens]
      : [],
  );
  if (
    baseline.length !== execution.evaluation.expectedPairCount ||
    candidate.length !== execution.evaluation.expectedPairCount
  ) {
    return undefined;
  }
  return {
    baselineMean: mean(baseline),
    candidateMean: mean(candidate),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertReleaseIdentity(
  generatedAt: string,
  productVersion: string,
): void {
  if (
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt ||
    !PRODUCT_VERSION.test(productVersion)
  ) {
    throw new Error("Harness experiment release identity is invalid");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Harness experiment release evidence array is invalid");
  return value;
}
