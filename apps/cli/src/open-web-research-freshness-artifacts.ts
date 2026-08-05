import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { OpenWebResearchFreshnessObservationArtifacts } from "./open-web-research-freshness-campaign-types.js";
import { openWebResearchFreshnessCampaignArtifactReferences } from "./open-web-research-freshness-campaign.js";
import { openWebResearchSeriesArtifactReferences } from "./open-web-research-series.js";

const MAX_CAMPAIGN_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

export async function loadOpenWebResearchFreshnessObservation(
  artifactPath: string,
): Promise<OpenWebResearchFreshnessObservationArtifacts> {
  const absolutePath = path.resolve(artifactPath);
  const artifactFileName = path.basename(absolutePath);
  const artifact = await readJson(absolutePath, MAX_RESULT_BYTES);
  if (
    record(artifact)?.["kind"] === "napier.open-web-research-benchmark-result"
  ) {
    return {
      artifactFileName,
      artifact:
        artifact as OpenWebResearchFreshnessObservationArtifacts["artifact"],
      trials: [
        {
          resultFileName: artifactFileName,
          result:
            artifact as OpenWebResearchFreshnessObservationArtifacts["trials"][number]["result"],
        },
      ],
    };
  }
  const references = openWebResearchSeriesArtifactReferences(artifact);
  const root = path.dirname(absolutePath);
  return {
    artifactFileName,
    artifact:
      artifact as OpenWebResearchFreshnessObservationArtifacts["artifact"],
    trials: await Promise.all(
      references.map(async (reference) => ({
        resultFileName: reference.resultFileName,
        result: (await readJson(
          path.join(root, reference.resultFileName),
          MAX_RESULT_BYTES,
        )) as OpenWebResearchFreshnessObservationArtifacts["trials"][number]["result"],
      })),
    ),
  };
}

export async function loadOpenWebResearchFreshnessCampaignArtifacts(
  campaignPath: string,
) {
  const absolutePath = path.resolve(campaignPath);
  const campaign = await readJson(absolutePath, MAX_CAMPAIGN_BYTES);
  const references =
    openWebResearchFreshnessCampaignArtifactReferences(campaign);
  const root = path.dirname(absolutePath);
  return {
    campaign,
    observations: await Promise.all(
      references.map((observation) => {
        const artifactFileName = observation.artifactFileName;
        return loadOpenWebResearchFreshnessObservation(
          path.join(root, artifactFileName),
        );
      }),
    ),
  };
}

async function readJson(filePath: string, maximumBytes: number) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) {
    throw new Error("Open-web Research freshness artifact file is invalid");
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
