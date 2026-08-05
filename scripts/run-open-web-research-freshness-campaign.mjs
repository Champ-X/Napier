#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOpenWebResearchBenchmarkCase } from "../apps/cli/dist/open-web-research-benchmark-case.js";
import {
  loadOpenWebResearchFreshnessCampaignArtifacts,
  loadOpenWebResearchFreshnessObservation,
} from "../apps/cli/dist/open-web-research-freshness-artifacts.js";
import {
  verifyOpenWebResearchFreshnessCampaign,
  writeOpenWebResearchFreshnessCampaign,
} from "../apps/cli/dist/open-web-research-freshness-campaign.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const loadedCase = await loadOpenWebResearchBenchmarkCase(args.caseRoot);

if (args.verifyCampaign) {
  const loaded = await loadOpenWebResearchFreshnessCampaignArtifacts(
    args.verifyCampaign,
  );
  const verification = verifyOpenWebResearchFreshnessCampaign(
    loaded.campaign,
    loaded.observations,
    loadedCase.benchmarkCase,
    loadedCase.expected,
  );
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.valid) process.exitCode = 1;
} else {
  const observations = await Promise.all(
    args.observationPaths.map(loadOpenWebResearchFreshnessObservation),
  );
  const artifacts = await writeOpenWebResearchFreshnessCampaign({
    generatedAt: new Date().toISOString(),
    outputDir: args.outputDir,
    observations,
    benchmarkCase: loadedCase.benchmarkCase,
    expected: loadedCase.expected,
  });
  console.log(
    JSON.stringify(
      {
        caseId: artifacts.campaign.caseId,
        observationCount: artifacts.campaign.observationCount,
        firstObservedAt: artifacts.campaign.firstObservedAt,
        lastObservedAt: artifacts.campaign.lastObservedAt,
        observationSpanMs: artifacts.campaign.observationSpanMs,
        minimumObservationGapMs: artifacts.campaign.minimumObservationGapMs,
        trialCount: artifacts.campaign.trialCount,
        passedTrialCount: artifacts.campaign.passedTrialCount,
        failedTrialCount: artifacts.campaign.failedTrialCount,
        inconclusiveTrialCount: artifacts.campaign.inconclusiveTrialCount,
        passRate: artifacts.campaign.passRate,
        sourceCoverageMatchTrialCount:
          artifacts.campaign.sourceCoverageMatchTrialCount,
        citationEvidenceMatchTrialCount:
          artifacts.campaign.citationEvidenceMatchTrialCount,
        replayValidTrialCount: artifacts.campaign.replayValidTrialCount,
        credentialLeakTrialCount: artifacts.campaign.credentialLeakTrialCount,
        uniqueSourceEvidenceCount: artifacts.campaign.uniqueSourceEvidenceCount,
        uniqueCitationEvidenceCount:
          artifacts.campaign.uniqueCitationEvidenceCount,
        metrics: artifacts.campaign.metrics,
        campaignSha256: artifacts.campaign.contentSha256,
        campaignPath: path.relative(repoRoot, artifacts.campaignPath),
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const values = new Map();
  const observations = [];
  const allowed = new Set([
    "--case",
    "--output-dir",
    "--observation",
    "--verify",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error("Unknown open-web freshness campaign option");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--observation") observations.push(path.resolve(value));
    else {
      if (values.has(flag)) {
        throw new Error(
          `Duplicate open-web freshness campaign option: ${flag}`,
        );
      }
      values.set(flag, value);
    }
    index += 1;
  }
  const verifyCampaign = values.get("--verify");
  if (!values.has("--case")) {
    throw new Error("--case is required");
  }
  if (verifyCampaign) {
    if (observations.length > 0 || values.has("--output-dir")) {
      throw new Error("--verify can only be combined with --case");
    }
  } else {
    if (observations.length < 2 || observations.length > 10) {
      throw new Error("--observation must be provided 2-10 times");
    }
  }
  const outputDir = path.resolve(
    values.get("--output-dir") ?? path.join(repoRoot, "benchmark-results"),
  );
  if (
    !verifyCampaign &&
    observations.some(
      (observationPath) => path.dirname(observationPath) !== outputDir,
    )
  ) {
    throw new Error("Every --observation artifact must be inside --output-dir");
  }
  return {
    caseRoot: path.resolve(values.get("--case")),
    outputDir,
    observationPaths: observations,
    ...(verifyCampaign ? { verifyCampaign: path.resolve(verifyCampaign) } : {}),
  };
}
