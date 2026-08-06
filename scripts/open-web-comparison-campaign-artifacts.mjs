import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  openWebComparisonCampaignArtifactReferences,
  openWebComparisonCampaignFileName,
  verifyOpenWebComparisonCampaign,
} from "./open-web-comparison-campaign.mjs";
import { verifyOpenWebComparisonReport } from "./open-web-comparison-report.mjs";

const MAX_CAMPAIGN_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export async function loadOpenWebComparisonReportArtifact(reportPath) {
  const absolutePath = path.resolve(reportPath);
  const report = await readJsonFile(absolutePath, MAX_REPORT_BYTES);
  const verification = verifyOpenWebComparisonReport(report);
  if (!verification.valid || report?.schemaVersion !== 2) {
    throw new Error(
      `Open-web comparison report is invalid: ${verification.diagnostics.join(
        ",",
      )}`,
    );
  }
  const fileName = path.basename(absolutePath);
  if (
    fileName !==
    `napier-open-web-executor-comparison-seed-${String(report.seed)}.json`
  ) {
    throw new Error("Open-web comparison report filename is invalid");
  }
  return { fileName, report };
}

export async function loadOpenWebComparisonCampaignArtifacts(campaignPath) {
  const absolutePath = path.resolve(campaignPath);
  const campaign = await readJsonFile(absolutePath, MAX_CAMPAIGN_BYTES);
  const references = openWebComparisonCampaignArtifactReferences(campaign);
  if (
    path.basename(absolutePath) !== openWebComparisonCampaignFileName(campaign)
  ) {
    throw new Error("Open-web comparison campaign filename is invalid");
  }
  const root = path.dirname(absolutePath);
  const reports = await Promise.all(
    references.map((reference) =>
      loadOpenWebComparisonReportArtifact(path.join(root, reference.fileName)),
    ),
  );
  return { campaign, reports };
}

export async function verifyOpenWebComparisonCampaignFile(campaignPath) {
  const loaded = await loadOpenWebComparisonCampaignArtifacts(campaignPath);
  return verifyOpenWebComparisonCampaign(loaded.campaign, loaded.reports);
}

async function readJsonFile(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 2 ||
    info.size > maximumBytes
  ) {
    throw new Error("Open-web comparison artifact file is invalid");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}
