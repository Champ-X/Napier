#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadOpenWebComparisonCampaignArtifacts,
  loadOpenWebComparisonReportArtifact,
} from "./open-web-comparison-campaign-artifacts.mjs";
import {
  createOpenWebComparisonCampaign,
  openWebComparisonCampaignFileName,
  verifyOpenWebComparisonCampaign,
} from "./open-web-comparison-campaign.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));

if (args.verifyPath) {
  const loaded = await loadOpenWebComparisonCampaignArtifacts(args.verifyPath);
  const verification = verifyOpenWebComparisonCampaign(
    loaded.campaign,
    loaded.reports,
  );
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.valid) process.exitCode = 1;
} else {
  const reports = await Promise.all(
    args.reportPaths.map(loadOpenWebComparisonReportArtifact),
  );
  const campaign = createOpenWebComparisonCampaign({
    generatedAt: new Date(
      Math.max(...reports.map(({ report }) => Date.parse(report.generatedAt))),
    ).toISOString(),
    reports,
  });
  const outputPath = path.join(
    args.outputDir,
    openWebComparisonCampaignFileName(campaign),
  );
  await mkdir(args.outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(campaign, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: path.relative(repoRoot, outputPath),
        reportCount: campaign.reportCount,
        seeds: campaign.seeds,
        summary: campaign.summary,
        contentSha256: campaign.contentSha256,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv) {
  const values = new Map();
  const reports = [];
  const allowed = new Set(["--output-dir", "--report", "--verify"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error("Unknown open-web comparison campaign option");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--report") {
      reports.push(path.resolve(value));
    } else {
      if (values.has(flag)) {
        throw new Error(
          `Duplicate open-web comparison campaign option: ${flag}`,
        );
      }
      values.set(flag, value);
    }
    index += 1;
  }
  const verifyPath = values.get("--verify");
  if (verifyPath) {
    if (reports.length > 0 || values.has("--output-dir")) {
      throw new Error("--verify cannot be combined with creation options");
    }
    return { verifyPath: path.resolve(verifyPath) };
  }
  if (reports.length < 2 || reports.length > 10) {
    throw new Error("--report must be provided 2-10 times");
  }
  const outputDir = path.resolve(
    values.get("--output-dir") ?? path.join(repoRoot, "benchmark-results"),
  );
  if (reports.some((reportPath) => path.dirname(reportPath) !== outputDir)) {
    throw new Error("Every --report artifact must be inside --output-dir");
  }
  return { outputDir, reportPaths: reports };
}
