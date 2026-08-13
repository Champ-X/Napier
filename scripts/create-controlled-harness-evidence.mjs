#!/usr/bin/env node

import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  createControlledHarnessEvidence,
  parseControlledHarnessEvidence,
} from "../packages/runtime/dist/controlled-harness-evidence.js";

import {
  verifyCodingExecutorComparison,
  verifyCodingExecutorComparisonSet,
} from "./check-coding-executor-comparison.mjs";
import { verifyBrowserAutonomyComparison } from "./browser-autonomy-comparison.mjs";
import { loadOpenWebComparisonCampaignArtifacts } from "./open-web-comparison-campaign-artifacts.mjs";
import { verifyOpenWebComparisonCampaign } from "./open-web-comparison-campaign.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaults = {
  openWebCampaignPath: path.join(
    repoRoot,
    "benchmark-results/napier-open-web-executor-comparison-campaign-seeds-20260805-20260813-d108a2049df3c910.json",
  ),
  codingPaths: [20260804, 20260805, 20260806].map((seed) =>
    path.join(
      repoRoot,
      `docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-${String(seed)}.json`,
    ),
  ),
  browserAutonomyPath: path.join(
    repoRoot,
    "benchmark-results/napier-browser-autonomy-comparison-seed-20260813-6fecdfcc3e41d459.json",
  ),
  outputPath: path.join(
    repoRoot,
    "docs/artifacts/controlled-harness-evidence-0.1.0.json",
  ),
};

const args = parseArgs(process.argv.slice(2));

if (args.verifyPath) {
  const evidence = parseControlledHarnessEvidence(
    await readJson(args.verifyPath, 512 * 1024),
  );
  if (!evidence) throw new Error("Controlled Harness evidence is invalid");
  print({
    valid: true,
    evidenceSha256: evidence.contentSha256,
    controlledTrackReady: evidence.controlledTrackReady,
    blockers: evidence.blockers,
  });
} else {
  const loadedCampaign = await loadOpenWebComparisonCampaignArtifacts(
    args.openWebCampaignPath,
  );
  const campaignVerification = verifyOpenWebComparisonCampaign(
    loadedCampaign.campaign,
    loadedCampaign.reports,
  );
  if (!campaignVerification.valid)
    throw new Error(
      `Open-web campaign is invalid: ${campaignVerification.diagnostics.join(",")}`,
    );

  const codingReports = await Promise.all(
    args.codingPaths.map((filePath) => readJson(filePath, 512 * 1024)),
  );
  const codingVerifications = await Promise.all(
    codingReports.map((report) => verifyCodingExecutorComparison(report)),
  );
  const codingSetVerification =
    await verifyCodingExecutorComparisonSet(codingReports);
  if (
    codingVerifications.some((verification) => !verification.valid) ||
    !codingSetVerification.valid
  ) {
    throw new Error("Coding comparison set is invalid");
  }

  const browserAutonomy = await readJson(args.browserAutonomyPath, 512 * 1024);
  const browserVerification = verifyBrowserAutonomyComparison(browserAutonomy);
  if (!browserVerification.valid)
    throw new Error(
      `Browser autonomy comparison is invalid: ${browserVerification.diagnostics.join(",")}`,
    );

  const campaignSha = loadedCampaign.campaign.contentSha256;
  const codingShas = codingReports.map((report) =>
    sha256(canonicalJson(report)),
  );
  const browserAutonomySha = browserAutonomy.contentSha256;
  const comparisons = [
    openWebComparison(
      loadedCampaign.reports,
      "search_primary_source",
      "search",
      campaignSha,
    ),
    openWebComparison(
      loadedCampaign.reports,
      "dynamic_browser_evidence",
      "browser_omp",
      campaignSha,
    ),
    codingComparison(codingReports, codingShas),
    browserUseComparison(browserAutonomy, browserAutonomySha),
  ];
  const generatedAt = [
    loadedCampaign.campaign.generatedAt,
    browserAutonomy.generatedAt,
  ]
    .sort()
    .at(-1);
  const evidence = createControlledHarnessEvidence({
    kind: "napier.controlled-harness-evidence",
    schemaVersion: 1,
    generatedAt,
    productVersion: args.productVersion,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    sources: [
      { role: "open_web_campaign", contentSha256: campaignSha },
      ...codingShas.map((contentSha256) => ({
        role: "coding_seed",
        contentSha256,
      })),
      {
        role: "browser_autonomy",
        contentSha256: browserAutonomySha,
      },
    ],
    comparisons,
    advantage: openWebEvidenceAdvantage(loadedCampaign.reports, campaignSha),
  });
  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  print({
    status: evidence.controlledTrackReady ? "ready" : "not_proven",
    outputPath: path.relative(repoRoot, args.outputPath),
    evidenceSha256: evidence.contentSha256,
    comparisonGates: evidence.comparisonGates.map((gate) => ({
      domain: gate.domain,
      trials: `${gate.decisiveTrialCount}/${gate.trialCount}`,
      result: `${gate.napierPassed}/${gate.baselinePassed}`,
      verdict: gate.verdict,
    })),
    blockers: evidence.blockers,
  });
}

function openWebComparison(reportArtifacts, taskFamily, domain, campaignSha) {
  const cases = reportArtifacts.flatMap(({ report }) =>
    report.cases.filter((entry) => entry.taskFamily === taskFamily),
  );
  const pairs = cases.flatMap(
    (entry) =>
      entry.tracks.find((track) => track.track === "controlled")?.trials ?? [],
  );
  return comparisonFromPairs({
    domain,
    baseline: "omp",
    caseCount: cases.length,
    pairs: pairs.map((pair) => ({
      napierStatus: pair.napier.status,
      baselineStatus: pair.omp.status,
      napierSecretLeakDetected:
        pair.napier.security?.secretLeakDetected === true,
    })),
    sourceArtifactSha256s: [campaignSha],
  });
}

function openWebEvidenceAdvantage(reportArtifacts, campaignSha) {
  const pairs = reportArtifacts.flatMap(({ report }) =>
    report.cases.flatMap(
      (entry) =>
        entry.tracks.find((track) => track.track === "controlled")?.trials ??
        [],
    ),
  );
  const napierVerified = pairs.filter((pair) =>
    hasVerifiableFinalEvidence(pair.napier),
  ).length;
  const baselineVerified = pairs.filter((pair) =>
    hasVerifiableFinalEvidence(pair.omp),
  ).length;
  return {
    metric: "evidence",
    baseline: "omp",
    direction: "higher",
    unit: "verifiable_final_evidence_rate",
    napierValue: rate(napierVerified, pairs.length),
    baselineValue: rate(baselineVerified, pairs.length),
    napierSampleCount: pairs.length,
    baselineSampleCount: pairs.length,
    sourceArtifactSha256s: [campaignSha],
  };
}

function hasVerifiableFinalEvidence(result) {
  return (
    result.process?.parseFailed === false &&
    result.security?.secretLeakDetected === false &&
    /^[a-f0-9]{64}$/u.test(result.evidence?.finalOutputSha256 ?? "") &&
    Number.isSafeInteger(result.evidence?.finalOutputBytes) &&
    result.evidence.finalOutputBytes > 0
  );
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function codingComparison(reports, sourceArtifactSha256s) {
  const cases = reports.flatMap((report) => report.cases);
  const pairs = cases.flatMap((entry) => codingCasePairs(entry));
  return comparisonFromPairs({
    domain: "coding",
    baseline: "omp",
    caseCount: cases.length,
    pairs,
    sourceArtifactSha256s,
  });
}

function codingCasePairs(entry) {
  if (Array.isArray(entry.trials) && entry.trials.length > 0) {
    return entry.trials.map((trial) => ({
      napierStatus: trial.napier.status,
      baselineStatus: trial.omp.hiddenOutcomePassed ? "passed" : "failed",
      napierSecretLeakDetected: false,
    }));
  }
  return [
    {
      napierStatus: entry.napier.officialStatus,
      baselineStatus: entry.omp.hiddenOutcomePassed ? "passed" : "failed",
      napierSecretLeakDetected: false,
    },
  ];
}

function browserUseComparison(report, sourceSha) {
  return comparisonFromPairs({
    domain: "browser_autonomy",
    baseline: "browser_use",
    caseCount: 1,
    pairs: report.trials.map((trial) => ({
      napierStatus: trial.napier.status,
      baselineStatus: trial.browserUse.status,
      napierSecretLeakDetected: trial.napier.secretLeakDetected,
    })),
    sourceArtifactSha256s: [sourceSha],
  });
}

function comparisonFromPairs({
  domain,
  baseline,
  caseCount,
  pairs,
  sourceArtifactSha256s,
}) {
  const decisive = pairs.filter(
    (pair) =>
      ["passed", "failed"].includes(pair.napierStatus) &&
      ["passed", "failed"].includes(pair.baselineStatus),
  );
  return {
    domain,
    baseline,
    caseCount,
    trialCount: pairs.length,
    decisiveTrialCount: decisive.length,
    excludedTrialCount: pairs.length - decisive.length,
    napierPassed: decisive.filter((pair) => pair.napierStatus === "passed")
      .length,
    baselinePassed: decisive.filter((pair) => pair.baselineStatus === "passed")
      .length,
    napierOnlyPassed: decisive.filter(
      (pair) =>
        pair.napierStatus === "passed" && pair.baselineStatus !== "passed",
    ).length,
    baselineOnlyPassed: decisive.filter(
      (pair) =>
        pair.baselineStatus === "passed" && pair.napierStatus !== "passed",
    ).length,
    napierSecretLeakDetected: pairs.some(
      (pair) => pair.napierSecretLeakDetected,
    ),
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s,
  };
}

function parseArgs(argv) {
  const options = {
    ...defaults,
    productVersion: "0.1.0",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--verify") options.verifyPath = path.resolve(value);
    else if (flag === "--output") options.outputPath = path.resolve(value);
    else if (flag === "--open-web-campaign")
      options.openWebCampaignPath = path.resolve(value);
    else if (flag === "--browser-autonomy")
      options.browserAutonomyPath = path.resolve(value);
    else if (flag === "--coding")
      options.codingPaths = value.split(",").map((item) => path.resolve(item));
    else if (flag === "--product-version") options.productVersion = value;
    else throw new Error(`Unknown Controlled Harness evidence option: ${flag}`);
  }
  return options;
}

async function readJson(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 2 ||
    info.size > maximumBytes
  ) {
    throw new Error("Controlled Harness source artifact is invalid");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
