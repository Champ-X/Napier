import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPaths = [
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-calibration-20260804.json",
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260804.json",
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260805.json",
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260806.json",
];

export async function verifyCodingExecutorComparison(input, options = {}) {
  const errors = [];
  if (!record(input)) return { valid: false, errors: ["report_not_object"] };
  if (
    input.type !== "napier.executor-comparison-calibration" ||
    input.schemaVersion !== 1
  ) {
    errors.push("report_identity_invalid");
  }
  if (
    input.model?.provider !== "deepseek" ||
    input.model?.id !== "deepseek-v4-flash"
  ) {
    errors.push("model_binding_invalid");
  }
  const selection = input.taskSelection;
  if (
    !record(selection) ||
    selection.samePrompt !== true ||
    selection.sameFixture !== true ||
    selection.sameHiddenOutcomeTest !== true ||
    !positiveInteger(selection.externalTimeoutMs) ||
    (selection.seed !== undefined &&
      (!positiveInteger(selection.seed) ||
        !sha256String(selection.suiteSha256))) ||
    (selection.profile !== undefined &&
      !["core_v1", "extended_v1"].includes(selection.profile))
  ) {
    errors.push("task_binding_invalid");
  }
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const caseHashes = cases
    .map((entry) => entry?.caseSha256)
    .filter((digest) => digest !== undefined);
  if (
    cases.length < 3 ||
    cases.length > 8 ||
    new Set(cases.map((entry) => entry?.caseId)).size !== cases.length ||
    !validComplexityCoverage(cases) ||
    new Set(caseHashes).size !== caseHashes.length
  ) {
    errors.push("case_set_invalid");
  }
  if (!validTaskFamilies(selection, cases)) {
    errors.push("task_family_set_invalid");
  }
  for (const entry of cases) validateCase(entry, errors);
  if (containsSensitiveKey(input)) errors.push("sensitive_key_present");

  const calculated = calculateCodingExecutorComparisonSummary(
    input.environment,
    cases,
  );
  const summary = input.summary;
  if (
    !record(summary) ||
    summary.napierOfficialPassed !== calculated.napierOfficialPassed ||
    summary.napierOfficialInconclusive !==
      calculated.napierOfficialInconclusive ||
    summary.napierOfficialFailed !== calculated.napierOfficialFailed ||
    summary.napierCanonicalTargetMatches !==
      calculated.napierCanonicalTargetMatches ||
    summary.ompHiddenOutcomePassed !== calculated.ompHiddenOutcomePassed ||
    summary.ompHiddenOutcomeFailed !== calculated.ompHiddenOutcomeFailed ||
    ("trialCount" in summary &&
      (summary.trialCount !== calculated.trialCount ||
        summary.napierTrialPassed !== calculated.napierTrialPassed ||
        summary.ompTrialPassed !== calculated.ompTrialPassed ||
        summary.napierTrialLatencyWins !==
          calculated.napierTrialLatencyWins)) ||
    summary.napierOuterHiddenOutcomePassed !==
      calculated.napierOuterHiddenOutcomePassed ||
    summary.napierOuterHiddenOutcomeFailed !==
      calculated.napierOuterHiddenOutcomeFailed ||
    summary.outerOutcomeVerdict !== calculated.outerOutcomeVerdict ||
    summary.verdict !== calculated.verdict ||
    ((selection.profile === "extended_v1" || "resources" in summary) &&
      JSON.stringify(summary.resources) !==
        JSON.stringify(calculated.resources))
  ) {
    errors.push("summary_mismatch");
  }
  if (
    !Array.isArray(summary?.requiredFollowUps) ||
    summary.requiredFollowUps.length === 0
  ) {
    errors.push("follow_up_missing");
  }
  return {
    valid: errors.length === 0,
    errors,
    caseCount: cases.length,
    verdict: calculated.verdict,
    ...calculated,
    ...(options.path ? { path: options.path } : {}),
  };
}

export async function verifyCodingExecutorComparisonSet(reports) {
  const results = await Promise.all(
    reports.map((report) => verifyCodingExecutorComparison(report)),
  );
  const seededReports = reports.filter((report) =>
    positiveInteger(report?.taskSelection?.seed),
  );
  const seeds = seededReports.map((report) => report.taskSelection.seed);
  const cases = seededReports.flatMap((report) => report.cases ?? []);
  const trials = cases.flatMap(caseTrials);
  const caseIds = cases.map((entry) => entry?.caseId);
  const errors = [];
  if (seededReports.length === 0) errors.push("seeded_report_missing");
  if (new Set(seeds).size !== seeds.length) errors.push("duplicate_seed");
  if (new Set(caseIds).size !== caseIds.length) errors.push("duplicate_case");
  if (results.some((result) => !result.valid)) {
    errors.push("report_invalid");
  }
  const napierPassed = trials.filter(
    (entry) => entry?.napierStatus === "passed",
  ).length;
  const ompPassed = trials.filter((entry) => entry?.ompPassed === true).length;
  const napierLatencyWins = trials.filter(
    (entry) =>
      entry?.napierStatus === "passed" &&
      entry?.ompPassed === true &&
      typeof entry?.napierDurationMs === "number" &&
      typeof entry?.ompDurationMs === "number" &&
      entry.napierDurationMs < entry.ompDurationMs,
  ).length;
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    seededReportCount: seededReports.length,
    caseCount: cases.length,
    trialCount: trials.length,
    napierPassed,
    ompPassed,
    napierLatencyWins,
    verdict:
      valid && napierPassed >= ompPassed
        ? "napier_not_worse"
        : valid
          ? "napier_worse"
          : "not_proven",
  };
}

function validateCase(entry, errors) {
  if (
    !record(entry) ||
    typeof entry.caseId !== "string" ||
    !record(entry.napier) ||
    !record(entry.napierOuterSandbox) ||
    !record(entry.omp)
  ) {
    errors.push("case_invalid");
    return;
  }
  if (entry.caseSha256 !== undefined && !sha256String(entry.caseSha256)) {
    errors.push(`case_hash_invalid:${entry.caseId}`);
  }
  if (
    !["passed", "inconclusive", "failed"].includes(
      entry.napier.officialStatus,
    ) ||
    typeof entry.napier.targetSemanticMatch !== "boolean" ||
    typeof entry.napier.durationMs !== "number" ||
    entry.napier.durationMs < 0 ||
    typeof entry.napierOuterSandbox.hiddenOutcomePassed !== "boolean" ||
    typeof entry.napierOuterSandbox.durationMs !== "number" ||
    entry.napierOuterSandbox.durationMs < 0 ||
    typeof entry.omp.hiddenOutcomePassed !== "boolean" ||
    typeof entry.omp.durationMs !== "number" ||
    entry.omp.durationMs < 0
  ) {
    errors.push(`case_metrics_invalid:${entry.caseId}`);
  }
  if (
    (entry.napier.costUsd !== undefined &&
      !nonNegativeNumber(entry.napier.costUsd)) ||
    (entry.napier.usage !== undefined &&
      !validUsage(entry.napier.usage, false)) ||
    (entry.omp.usage !== undefined && !validUsage(entry.omp.usage, true))
  ) {
    errors.push(`case_resource_metrics_invalid:${entry.caseId}`);
  }
  if (
    entry.taskFamily !== undefined &&
    (typeof entry.taskFamily !== "string" ||
      !/^[a-z][a-z0-9_]{2,63}$/u.test(entry.taskFamily))
  ) {
    errors.push(`case_task_family_invalid:${entry.caseId}`);
  }
  if (entry.trials !== undefined) {
    if (
      !Array.isArray(entry.trials) ||
      entry.trials.length < 2 ||
      entry.trials.length > 10 ||
      new Set(entry.trials.map((trial) => trial?.trial)).size !==
        entry.trials.length
    ) {
      errors.push(`case_trials_invalid:${entry.caseId}`);
      return;
    }
    for (const trial of entry.trials) {
      if (
        !positiveInteger(trial?.trial) ||
        !["passed", "inconclusive", "failed"].includes(trial?.napier?.status) ||
        typeof trial?.napier?.durationMs !== "number" ||
        trial.napier.durationMs < 0 ||
        typeof trial?.omp?.hiddenOutcomePassed !== "boolean" ||
        typeof trial?.omp?.durationMs !== "number" ||
        trial.omp.durationMs < 0 ||
        (trial.napier.costUsd !== undefined &&
          !nonNegativeNumber(trial.napier.costUsd)) ||
        (trial.napier.usage !== undefined &&
          !validUsage(trial.napier.usage, false)) ||
        (trial.omp.usage !== undefined && !validUsage(trial.omp.usage, true))
      ) {
        errors.push(`case_trials_invalid:${entry.caseId}`);
        break;
      }
    }
  }
}

export function calculateCodingExecutorComparisonSummary(environment, cases) {
  const count = (select) => cases.filter(select).length;
  const summary = {
    napierOfficialPassed: count(
      (entry) => entry?.napier?.officialStatus === "passed",
    ),
    napierOfficialInconclusive: count(
      (entry) => entry?.napier?.officialStatus === "inconclusive",
    ),
    napierOfficialFailed: count(
      (entry) => entry?.napier?.officialStatus === "failed",
    ),
    napierCanonicalTargetMatches: count(
      (entry) => entry?.napier?.targetSemanticMatch === true,
    ),
    ompHiddenOutcomePassed: count(
      (entry) => entry?.omp?.hiddenOutcomePassed === true,
    ),
    ompHiddenOutcomeFailed: count(
      (entry) => entry?.omp?.hiddenOutcomePassed === false,
    ),
    napierOuterHiddenOutcomePassed: count(
      (entry) => entry?.napierOuterSandbox?.hiddenOutcomePassed === true,
    ),
    napierOuterHiddenOutcomeFailed: count(
      (entry) => entry?.napierOuterSandbox?.hiddenOutcomePassed === false,
    ),
  };
  const infrastructureUnavailable =
    environment?.nestedSandboxAvailable !== true ||
    summary.napierOfficialInconclusive > 0;
  const trials = cases.flatMap(caseTrials);
  const napierTrialPassed = trials.filter(
    (trial) => trial.napierStatus === "passed",
  ).length;
  const ompTrialPassed = trials.filter((trial) => trial.ompPassed).length;
  const napierTrialLatencyWins = trials.filter(
    (trial) =>
      trial.napierStatus === "passed" &&
      trial.ompPassed &&
      trial.napierDurationMs < trial.ompDurationMs,
  ).length;
  return {
    ...summary,
    trialCount: trials.length,
    napierTrialPassed,
    ompTrialPassed,
    napierTrialLatencyWins,
    resources: calculateResourceEvidence(trials),
    outerOutcomeVerdict:
      summary.napierOuterHiddenOutcomePassed >= summary.ompHiddenOutcomePassed
        ? "napier_not_worse"
        : "napier_worse",
    verdict: infrastructureUnavailable
      ? "not_proven"
      : napierTrialPassed >= ompTrialPassed
        ? "napier_not_worse"
        : "napier_worse",
  };
}

function caseTrials(entry) {
  if (Array.isArray(entry?.trials) && entry.trials.length > 0) {
    return entry.trials.map((trial, index) => ({
      napierStatus: trial?.napier?.status,
      napierDurationMs: trial?.napier?.durationMs,
      napierCostUsd:
        trial?.napier?.costUsd ??
        (index === 0 ? entry?.napier?.costUsd : undefined),
      napierUsage:
        trial?.napier?.usage ??
        (index === 0 ? entry?.napier?.usage : undefined),
      ompPassed: trial?.omp?.hiddenOutcomePassed === true,
      ompDurationMs: trial?.omp?.durationMs,
      ompCostUsd:
        trial?.omp?.usage?.costUsd ??
        (index === 0 ? entry?.omp?.usage?.costUsd : undefined),
      ompUsage:
        trial?.omp?.usage ?? (index === 0 ? entry?.omp?.usage : undefined),
    }));
  }
  return [
    {
      napierStatus: entry?.napier?.officialStatus,
      napierDurationMs: entry?.napier?.durationMs,
      napierCostUsd: entry?.napier?.costUsd,
      napierUsage: entry?.napier?.usage,
      ompPassed: entry?.omp?.hiddenOutcomePassed === true,
      ompDurationMs: entry?.omp?.durationMs,
      ompCostUsd: entry?.omp?.usage?.costUsd,
      ompUsage: entry?.omp?.usage,
    },
  ];
}

function calculateResourceEvidence(trials) {
  const napierUsage = trials
    .map((trial) => trial.napierUsage)
    .filter((usage) => validUsage(usage, false));
  const ompUsage = trials
    .map((trial) => trial.ompUsage)
    .filter((usage) => validUsage(usage, true));
  const comparableUsageSampleCount = trials.filter(
    (trial) =>
      validUsage(trial.napierUsage, false) && validUsage(trial.ompUsage, true),
  ).length;
  const napierCosts = trials
    .map((trial) => trial.napierUsage?.costUsd ?? trial.napierCostUsd)
    .filter(nonNegativeNumber);
  const ompCosts = trials
    .map((trial) => trial.ompUsage?.costUsd ?? trial.ompCostUsd)
    .filter(nonNegativeNumber);
  const comparableCostSampleCount = trials.filter(
    (trial) =>
      nonNegativeNumber(trial.napierUsage?.costUsd ?? trial.napierCostUsd) &&
      nonNegativeNumber(trial.ompUsage?.costUsd ?? trial.ompCostUsd),
  ).length;
  return {
    sampleCount: trials.length,
    napierUsageSampleCount: napierUsage.length,
    ompUsageSampleCount: ompUsage.length,
    comparableUsageSampleCount,
    napierCostSampleCount: napierCosts.length,
    ompCostSampleCount: ompCosts.length,
    comparableCostSampleCount,
    napierInputTokens: sumUsage(napierUsage, "inputTokens"),
    napierOutputTokens: sumUsage(napierUsage, "outputTokens"),
    napierCostUsd: sumNumbers(napierCosts),
    ompInputTokens: sumUsage(ompUsage, "inputTokens"),
    ompOutputTokens: sumUsage(ompUsage, "outputTokens"),
    ompCostUsd: sumNumbers(ompCosts),
  };
}

function sumUsage(usages, key) {
  const values = usages
    .map((usage) => usage[key])
    .filter((value) => typeof value === "number");
  return sumNumbers(values);
}

function sumNumbers(values) {
  if (values.length === 0) return null;
  return Number(values.reduce((total, value) => total + value, 0).toFixed(12));
}

function validUsage(value, allowPartial) {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  const allowed = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ];
  if (
    keys.length === 0 ||
    keys.some((key) => !allowed.includes(key)) ||
    keys.some(
      (key) =>
        typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0,
    )
  ) {
    return false;
  }
  return (
    allowPartial ||
    allowed.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      (!allowedUsageMetricKey(key) &&
        /(?:api.?key|secret|token|credential)/iu.test(key)) ||
      containsSensitiveKey(nested),
  );
}

function validComplexityCoverage(cases) {
  const complexities = cases.map((entry) => entry?.complexity);
  if (
    complexities.some(
      (complexity) => !["low", "medium", "high"].includes(complexity),
    )
  ) {
    return false;
  }
  const low = complexities.indexOf("low");
  const medium = complexities.indexOf("medium");
  const high = complexities.indexOf("high");
  return low >= 0 && medium > low && high > medium;
}

function validTaskFamilies(selection, cases) {
  const families = cases
    .map((entry) => entry?.taskFamily)
    .filter((family) => family !== undefined);
  if (
    families.some(
      (family) =>
        typeof family !== "string" || !/^[a-z][a-z0-9_]{2,63}$/u.test(family),
    ) ||
    new Set(families).size !== families.length
  ) {
    return false;
  }
  if (selection?.profile !== "extended_v1") return true;
  return (
    cases.length >= 4 &&
    families.length === cases.length &&
    families.includes("test_guided_concurrency")
  );
}

function allowedUsageMetricKey(key) {
  return (
    [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
    ].includes(key) || /^(?:napier|omp)(?:Input|Output)Tokens$/u.test(key)
  );
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sha256String(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reportPaths = process.argv[2]
    ? [path.resolve(root, process.argv[2])]
    : defaultPaths.map((entry) => path.resolve(root, entry));
  const results = [];
  const reports = [];
  for (const reportPath of reportPaths) {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    reports.push(report);
    results.push(
      await verifyCodingExecutorComparison(report, {
        path: path.relative(root, reportPath),
      }),
    );
  }
  const aggregate = await verifyCodingExecutorComparisonSet(reports);
  process.stdout.write(
    `${JSON.stringify({ reports: results, aggregate }, null, 2)}\n`,
  );
  if (!aggregate.valid) process.exitCode = 1;
}
