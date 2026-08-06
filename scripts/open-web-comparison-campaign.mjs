import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

import {
  openWebComparisonExactKeys as exactKeys,
  openWebComparisonIsoDate as isoDate,
  openWebComparisonRecord as record,
} from "./open-web-comparison-report-shape.mjs";
import {
  openWebComparisonSummary,
  verifyOpenWebComparisonReport,
} from "./open-web-comparison-report.mjs";

const CAMPAIGN_TYPE = "napier.open-web-executor-comparison-campaign";
const TRACKS = ["default", "controlled"];

export const OPEN_WEB_COMPARISON_CAMPAIGN_NOTES = [
  "Each sibling schema-2 report is independently verified against the deterministic suite regenerated from its seed before aggregation.",
  "Campaign entries retain only digests, configuration, timing aggregates, statuses, and counts; raw tasks, URLs, quotes, model output, reasoning, and transcripts are excluded.",
  "Inconclusive and infrastructure-failure pairs remain in executor status totals and excludedPairCount, and are excluded from paired win/loss counts.",
  "Multiple seeds reduce one-seed risk but do not by themselves establish broad executor superiority.",
];

export function createOpenWebComparisonCampaign(input) {
  if (
    !Array.isArray(input?.reports) ||
    input.reports.length < 2 ||
    input.reports.length > 10
  ) {
    throw new Error("Open-web comparison campaign requires 2-10 reports");
  }
  if (!isoDate(input.generatedAt)) {
    throw new Error("Open-web comparison campaign generation time is invalid");
  }
  const artifacts = [...input.reports]
    .map(assertCanonicalReportArtifact)
    .sort((left, right) => left.report.seed - right.report.seed);
  assertUnique(
    artifacts.map((artifact) => artifact.report.seed),
    "seed",
  );
  assertUnique(
    artifacts.map((artifact) => artifact.report.contentSha256),
    "report hash",
  );
  assertCompatibleReports(artifacts.map((artifact) => artifact.report));
  const latestReportTime = Math.max(
    ...artifacts.map((artifact) => Date.parse(artifact.report.generatedAt)),
  );
  if (Date.parse(input.generatedAt) < latestReportTime) {
    throw new Error("Open-web comparison campaign predates a retained report");
  }
  const first = artifacts[0].report;
  const reports = artifacts.map(({ fileName, report }, index) => ({
    index: index + 1,
    fileName,
    seed: report.seed,
    generatedAt: report.generatedAt,
    contentSha256: report.contentSha256,
    suiteSha256: report.suite.contentSha256,
    summary: structuredClone(report.summary),
  }));
  const content = {
    type: CAMPAIGN_TYPE,
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    reportCount: reports.length,
    seeds: reports.map((report) => report.seed),
    trialCount: first.trialCount,
    timeoutMs: first.timeoutMs,
    model: structuredClone(first.model),
    environment: structuredClone(first.environment),
    tracks: [...TRACKS],
    reports,
    reportSetSha256: reportSetSha256(reports),
    summary: openWebComparisonSummary(
      artifacts.flatMap((artifact) => artifact.report.cases),
    ),
    notes: [...OPEN_WEB_COMPARISON_CAMPAIGN_NOTES],
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyOpenWebComparisonCampaign(input, reportArtifacts) {
  if (!validCampaignShape(input)) {
    return invalidCampaign(input);
  }
  const diagnostics = [];
  if (containsSensitiveKey(input) || containsRawEvidence(input)) {
    diagnostics.push("campaign_privacy_invalid");
  }
  const artifacts = Array.isArray(reportArtifacts) ? reportArtifacts : [];
  if (artifacts.length !== input.reportCount) {
    diagnostics.push("campaign_report_count_mismatch");
  }
  const reportDiagnostics = input.reports.map((entry) => {
    const matches = artifacts.filter(
      (artifact) => artifact?.fileName === entry.fileName,
    );
    const issues =
      matches.length === 1
        ? verifyCampaignReport(entry, matches[0].report)
        : [
            matches.length === 0
              ? "report_artifact_missing"
              : "report_artifact_duplicate",
          ];
    return { index: entry.index, seed: entry.seed, diagnostics: issues };
  });
  if (reportDiagnostics.some((entry) => entry.diagnostics.length > 0)) {
    diagnostics.push("campaign_report_invalid");
  }
  const recreated = recreateCampaign(input, artifacts, reportDiagnostics);
  if (!recreated || canonicalJson(recreated) !== canonicalJson(input)) {
    diagnostics.push("campaign_aggregate_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    campaignSha256: input.contentSha256,
    reportDiagnostics,
  };
}

export function openWebComparisonCampaignArtifactReferences(input) {
  if (!validCampaignShape(input)) {
    throw new Error("Open-web comparison campaign shape is invalid");
  }
  if (containsSensitiveKey(input) || containsRawEvidence(input)) {
    throw new Error("Open-web comparison campaign privacy is invalid");
  }
  return input.reports.map((report) => ({
    index: report.index,
    seed: report.seed,
    fileName: report.fileName,
    contentSha256: report.contentSha256,
  }));
}

export function openWebComparisonCampaignFileName(campaign) {
  if (!validCampaignShape(campaign)) {
    throw new Error("Open-web comparison campaign shape is invalid");
  }
  return `napier-open-web-executor-comparison-campaign-seeds-${String(
    campaign.seeds[0],
  )}-${String(campaign.seeds.at(-1))}-${campaign.contentSha256.slice(
    0,
    16,
  )}.json`;
}

function assertCanonicalReportArtifact(artifact) {
  if (
    !record(artifact) ||
    !exactKeys(artifact, ["fileName", "report"]) ||
    typeof artifact.fileName !== "string" ||
    !record(artifact.report)
  ) {
    throw new Error("Open-web comparison report artifact is invalid");
  }
  const verification = verifyOpenWebComparisonReport(artifact.report);
  if (!verification.valid || artifact.report.schemaVersion !== 2) {
    throw new Error(
      `Open-web comparison report is invalid: ${verification.diagnostics.join(
        ",",
      )}`,
    );
  }
  if (
    artifact.fileName !==
    `napier-open-web-executor-comparison-seed-${String(
      artifact.report.seed,
    )}.json`
  ) {
    throw new Error("Open-web comparison report filename is invalid");
  }
  return artifact;
}

function assertCompatibleReports(reports) {
  const first = reports[0];
  const binding = (report) =>
    canonicalJson({
      schemaVersion: report.schemaVersion,
      trialCount: report.trialCount,
      timeoutMs: report.timeoutMs,
      model: report.model,
      environment: report.environment,
    });
  if (reports.some((report) => binding(report) !== binding(first))) {
    throw new Error(
      "Open-web comparison reports have incompatible execution bindings",
    );
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`Open-web comparison campaign ${label} must be unique`);
  }
}

function verifyCampaignReport(entry, report) {
  const diagnostics = [];
  const verification = verifyOpenWebComparisonReport(report);
  if (!verification.valid) {
    diagnostics.push(...verification.diagnostics);
  }
  if (report?.schemaVersion !== 2) {
    diagnostics.push("report_schema_invalid");
  }
  if (
    !record(report) ||
    entry.seed !== report.seed ||
    entry.generatedAt !== report.generatedAt ||
    entry.contentSha256 !== report.contentSha256 ||
    entry.suiteSha256 !== report.suite?.contentSha256 ||
    canonicalJson(entry.summary) !== canonicalJson(report.summary)
  ) {
    diagnostics.push("report_binding_invalid");
  }
  return [...new Set(diagnostics)];
}

function recreateCampaign(campaign, artifacts, reportDiagnostics) {
  if (
    artifacts.length !== campaign.reportCount ||
    reportDiagnostics.some((entry) => entry.diagnostics.length > 0)
  ) {
    return undefined;
  }
  try {
    return createOpenWebComparisonCampaign({
      generatedAt: campaign.generatedAt,
      reports: campaign.reports.map((entry) => {
        const artifact = artifacts.find(
          (candidate) => candidate.fileName === entry.fileName,
        );
        return { fileName: entry.fileName, report: artifact.report };
      }),
    });
  } catch {
    return undefined;
  }
}

function validCampaignShape(value) {
  if (
    !record(value) ||
    !exactKeys(value, [
      "contentSha256",
      "environment",
      "generatedAt",
      "model",
      "notes",
      "reportCount",
      "reportSetSha256",
      "reports",
      "schemaVersion",
      "seeds",
      "summary",
      "timeoutMs",
      "tracks",
      "trialCount",
      "type",
    ]) ||
    value.type !== CAMPAIGN_TYPE ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    !digest(value.contentSha256) ||
    !digest(value.reportSetSha256) ||
    !integerBetween(value.reportCount, 2, 10) ||
    !integerBetween(value.trialCount, 1, 3) ||
    !integerBetween(value.timeoutMs, 10_000, 300_000) ||
    canonicalJson(value.model) !==
      canonicalJson({ provider: "deepseek", id: "deepseek-v4-flash" }) ||
    !validCampaignEnvironment(value.environment) ||
    canonicalJson(value.tracks) !== canonicalJson(TRACKS) ||
    !validCampaignSummary(value.summary) ||
    canonicalJson(value.notes) !==
      canonicalJson(OPEN_WEB_COMPARISON_CAMPAIGN_NOTES) ||
    !Array.isArray(value.seeds) ||
    !Array.isArray(value.reports) ||
    value.seeds.length !== value.reportCount ||
    value.reports.length !== value.reportCount ||
    !value.reports.every(validReportEntry)
  ) {
    return false;
  }
  const expectedSeeds = value.reports.map((report) => report.seed);
  const { contentSha256, ...content } = value;
  return (
    sha256(canonicalJson(content)) === contentSha256 &&
    canonicalJson(value.seeds) === canonicalJson(expectedSeeds) &&
    expectedSeeds.every(
      (seed, index) => index === 0 || expectedSeeds[index - 1] < seed,
    ) &&
    new Set(value.reports.map((report) => report.fileName)).size ===
      value.reportCount &&
    new Set(value.reports.map((report) => report.contentSha256)).size ===
      value.reportCount &&
    reportSetSha256(value.reports) === value.reportSetSha256 &&
    value.reports.every(
      (report) =>
        Date.parse(report.generatedAt) <= Date.parse(value.generatedAt),
    )
  );
}

function validReportEntry(value, index) {
  return (
    record(value) &&
    exactKeys(value, [
      "contentSha256",
      "fileName",
      "generatedAt",
      "index",
      "seed",
      "suiteSha256",
      "summary",
    ]) &&
    value.index === index + 1 &&
    positiveUint32(value.seed) &&
    value.fileName ===
      `napier-open-web-executor-comparison-seed-${String(value.seed)}.json` &&
    isoDate(value.generatedAt) &&
    digest(value.contentSha256) &&
    digest(value.suiteSha256) &&
    validCampaignSummary(value.summary)
  );
}

function validCampaignEnvironment(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "architecture",
      "browserRuntimeBytes",
      "browserRuntimeExecutableSha256",
      "browserRuntimeFileCount",
      "browserRuntimeSetSha256",
      "napierVersion",
      "nodeVersion",
      "ompExecutableSha256",
      "ompRuntimeExecutableSha256",
      "ompRuntimeVersion",
      "ompVersion",
      "outerSandbox",
      "platform",
    ]) &&
    value.platform === "darwin" &&
    ["arm64", "x64"].includes(value.architecture) &&
    semanticVersion(value.nodeVersion) &&
    value.napierVersion === "0.1.0" &&
    semanticVersion(value.ompVersion) &&
    value.ompRuntimeVersion === value.ompVersion &&
    digest(value.ompExecutableSha256) &&
    digest(value.ompRuntimeExecutableSha256) &&
    digest(value.browserRuntimeExecutableSha256) &&
    digest(value.browserRuntimeSetSha256) &&
    positiveInteger(value.browserRuntimeFileCount) &&
    positiveInteger(value.browserRuntimeBytes) &&
    value.outerSandbox === "macos-sandbox-exec-guarded"
  );
}

function validCampaignSummary(value) {
  return (
    record(value) &&
    exactKeys(value, ["byTrack", "overall"]) &&
    record(value.byTrack) &&
    exactKeys(value.byTrack, TRACKS) &&
    TRACKS.every((track) => validPairSummary(value.byTrack[track])) &&
    validPairSummary(value.overall)
  );
}

function validPairSummary(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "decisivePairCount",
      "excludedPairCount",
      "napier",
      "omp",
      "pairCount",
      "paired",
    ]) &&
    nonNegativeInteger(value.pairCount) &&
    nonNegativeInteger(value.decisivePairCount) &&
    nonNegativeInteger(value.excludedPairCount) &&
    value.decisivePairCount + value.excludedPairCount === value.pairCount &&
    validExecutorSummary(value.napier, value.pairCount) &&
    validExecutorSummary(value.omp, value.pairCount) &&
    record(value.paired) &&
    exactKeys(value.paired, [
      "bothPassed",
      "napierOnlyPassed",
      "neitherPassed",
      "ompOnlyPassed",
    ]) &&
    Object.values(value.paired).every(nonNegativeInteger) &&
    Object.values(value.paired).reduce((total, count) => total + count, 0) ===
      value.decisivePairCount
  );
}

function validExecutorSummary(value, pairCount) {
  return (
    record(value) &&
    exactKeys(value, [
      "failed",
      "inconclusive",
      "infrastructureFailure",
      "meanCostUsd",
      "meanDurationMs",
      "passed",
      "totalManualInterventions",
      "totalToolFailed",
    ]) &&
    [
      "passed",
      "failed",
      "inconclusive",
      "infrastructureFailure",
      "totalToolFailed",
      "totalManualInterventions",
    ].every((key) => nonNegativeInteger(value[key])) &&
    value.passed +
      value.failed +
      value.inconclusive +
      value.infrastructureFailure ===
      pairCount &&
    nonNegativeNumber(value.meanDurationMs) &&
    nonNegativeNumber(value.meanCostUsd)
  );
}

function reportSetSha256(reports) {
  return sha256(
    canonicalJson(
      reports.map((report) => ({
        seed: report.seed,
        fileName: report.fileName,
        contentSha256: report.contentSha256,
      })),
    ),
  );
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      (!allowedDigestKey(key) &&
        /(?:api.?key|secret|credential|cookie|authorization|reasoning|transcript|prompt|quote|source.?url|answer|raw.?output)/iu.test(
          key,
        )) ||
      containsSensitiveKey(nested),
  );
}

function containsRawEvidence(value) {
  const serialized = JSON.stringify(value);
  return (
    /https?:\/\//iu.test(serialized) ||
    [
      "api.deepseek.com",
      "Dummy PDF file",
      "V8 13.6",
      "reasoning_content",
      "[citation:",
    ].some((marker) => serialized.includes(marker))
  );
}

function allowedDigestKey(key) {
  return ["contentSha256", "suiteSha256", "reportSetSha256"].includes(key);
}

function invalidCampaign(input) {
  return {
    valid: false,
    diagnostics: ["campaign_shape_invalid"],
    campaignSha256: sha256(String(input)),
    reportDiagnostics: [],
  };
}

function digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveUint32(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff;
}

function semanticVersion(value) {
  return typeof value === "string" && /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value);
}
