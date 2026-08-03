import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPaths = [
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-calibration-20260804.json",
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260804.json",
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260805.json",
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
    !positiveInteger(selection.externalTimeoutMs)
  ) {
    errors.push("task_binding_invalid");
  }
  const cases = Array.isArray(input.cases) ? input.cases : [];
  if (
    cases.length < 3 ||
    new Set(cases.map((entry) => entry?.caseId)).size !== cases.length ||
    cases.map((entry) => entry?.complexity).join(",") !== "low,medium,high"
  ) {
    errors.push("case_set_invalid");
  }
  for (const entry of cases) validateCase(entry, errors);
  if (containsSensitiveKey(input)) errors.push("sensitive_key_present");

  const calculated = calculateSummary(input.environment, cases);
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
    summary.napierOuterHiddenOutcomePassed !==
      calculated.napierOuterHiddenOutcomePassed ||
    summary.napierOuterHiddenOutcomeFailed !==
      calculated.napierOuterHiddenOutcomeFailed ||
    summary.outerOutcomeVerdict !== calculated.outerOutcomeVerdict ||
    summary.verdict !== calculated.verdict
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
  const caseIds = cases.map((entry) => entry?.caseId);
  const errors = [];
  if (seededReports.length === 0) errors.push("seeded_report_missing");
  if (new Set(seeds).size !== seeds.length) errors.push("duplicate_seed");
  if (new Set(caseIds).size !== caseIds.length) errors.push("duplicate_case");
  if (results.some((result) => !result.valid)) {
    errors.push("report_invalid");
  }
  const napierPassed = cases.filter(
    (entry) => entry?.napier?.officialStatus === "passed",
  ).length;
  const ompPassed = cases.filter(
    (entry) => entry?.omp?.hiddenOutcomePassed === true,
  ).length;
  const napierLatencyWins = cases.filter(
    (entry) =>
      typeof entry?.napier?.durationMs === "number" &&
      typeof entry?.omp?.durationMs === "number" &&
      entry.napier.durationMs < entry.omp.durationMs,
  ).length;
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    seededReportCount: seededReports.length,
    caseCount: cases.length,
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
}

function calculateSummary(environment, cases) {
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
  return {
    ...summary,
    outerOutcomeVerdict:
      summary.napierOuterHiddenOutcomePassed >= summary.ompHiddenOutcomePassed
        ? "napier_not_worse"
        : "napier_worse",
    verdict: infrastructureUnavailable
      ? "not_proven"
      : summary.napierOfficialPassed >= summary.ompHiddenOutcomePassed
        ? "napier_not_worse"
        : "napier_worse",
  };
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /(?:api.?key|secret|token|credential)/iu.test(key) ||
      containsSensitiveKey(nested),
  );
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
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
