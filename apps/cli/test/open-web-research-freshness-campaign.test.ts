import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime";
import { describe, expect, it } from "vitest";

import { loadOpenWebResearchBenchmarkCase } from "../src/open-web-research-benchmark-case.js";
import {
  createOpenWebResearchFreshnessCampaign,
  verifyOpenWebResearchFreshnessCampaign,
} from "../src/open-web-research-freshness-campaign.js";
import { loadOpenWebResearchFreshnessObservation } from "../src/open-web-research-freshness-artifacts.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CASE_ROOT = path.join(
  REPO_ROOT,
  "benchmarks/research/open-web-source-triad-v1",
);
const RESULT_PATH = path.join(
  REPO_ROOT,
  "benchmark-results/napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b90a841f097b03b9.json",
);
const SERIES_PATH = path.join(
  REPO_ROOT,
  "benchmark-results/napier-open-web-research-series-research_open_web_source_triad_v1-a7b8199e42e13339.json",
);

describe("open-web Research freshness campaign", () => {
  it("aggregates independently verified time-separated observations", async () => {
    const observations = await loadObservations();
    const loaded = await loadOpenWebResearchBenchmarkCase(CASE_ROOT);
    const campaign = createOpenWebResearchFreshnessCampaign({
      generatedAt: "2026-08-05T20:00:00.000Z",
      observations,
    });

    expect(campaign).toEqual(
      expect.objectContaining({
        observationCount: 2,
        firstObservedAt: "2026-08-04T14:18:24.596Z",
        lastObservedAt: "2026-08-05T19:55:53.662Z",
        observationSpanMs: 106_649_066,
        minimumObservationGapMs: 106_609_321,
        trialCount: 3,
        passedTrialCount: 2,
        failedTrialCount: 1,
        inconclusiveTrialCount: 0,
        claimsMatchTrialCount: 3,
        toolTopologyMatchTrialCount: 3,
        sourceCoverageMatchTrialCount: 3,
        citationEvidenceMatchTrialCount: 2,
        citationClaimsMatchTrialCount: 3,
        replayValidTrialCount: 3,
        credentialLeakTrialCount: 0,
        passRate: 2 / 3,
        uniqueSourceEvidenceCount: 1,
        uniqueCitationEvidenceCount: 3,
        metrics: expect.objectContaining({
          searchCount: expect.objectContaining({ total: 3, min: 1, max: 1 }),
          fetchCount: expect.objectContaining({ total: 6, min: 2, max: 2 }),
          browserCount: expect.objectContaining({ total: 9, min: 3, max: 3 }),
          citationCount: expect.objectContaining({ total: 9, min: 3, max: 3 }),
        }),
      }),
    );
    expect(
      verifyOpenWebResearchFreshnessCampaign(
        campaign,
        [...observations].reverse(),
        loaded.benchmarkCase,
        loaded.expected,
      ),
    ).toEqual({
      valid: true,
      diagnostics: [],
      campaignSha256: campaign.contentSha256,
      observationDiagnostics: [
        { index: 1, diagnostics: [] },
        { index: 2, diagnostics: [] },
      ],
    });
    expect(campaign.observations.map((entry) => entry.artifactKind)).toEqual([
      "result",
      "series",
    ]);
    const serialized = JSON.stringify(campaign);
    for (const raw of [
      "https://",
      "[citation:",
      "V8 13.6",
      "Dummy PDF file",
      "The world as we have created it",
      "DEEPSEEK_API_KEY",
    ]) {
      expect(serialized).not.toContain(raw);
    }
  });

  it("rejects substitution, aggregate tampering, and short observation gaps", async () => {
    const observations = await loadObservations();
    const loaded = await loadOpenWebResearchBenchmarkCase(CASE_ROOT);
    const campaign = createOpenWebResearchFreshnessCampaign({
      generatedAt: "2026-08-05T20:00:00.000Z",
      observations,
    });

    const substituted = structuredClone(observations);
    substituted[0] = structuredClone(observations[1]!);
    expect(
      verifyOpenWebResearchFreshnessCampaign(
        campaign,
        substituted,
        loaded.benchmarkCase,
        loaded.expected,
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: [
          "campaign_observation_invalid",
          "campaign_aggregate_mismatch",
        ],
      }),
    );

    const rehashed = structuredClone(campaign);
    rehashed.passedTrialCount = 3;
    const { contentSha256: _contentSha256, ...content } = rehashed;
    rehashed.contentSha256 = sha256(canonicalJson(content));
    expect(
      verifyOpenWebResearchFreshnessCampaign(
        rehashed,
        observations,
        loaded.benchmarkCase,
        loaded.expected,
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["campaign_aggregate_mismatch"],
      }),
    );

    const tooClose = structuredClone(observations);
    const singleton = tooClose[0]!.artifact;
    singleton.generatedAt = "2026-08-05T19:00:00.000Z";
    tooClose[0]!.trials[0]!.result = singleton;
    expect(() =>
      createOpenWebResearchFreshnessCampaign({
        generatedAt: "2026-08-05T20:00:00.000Z",
        observations: tooClose,
      }),
    ).toThrow("must be at least 24 hours apart");
    expect(() =>
      createOpenWebResearchFreshnessCampaign({
        generatedAt: "2026-08-05T20:00:00.000Z",
        observations: [observations[0]!, observations[0]!],
      }),
    ).toThrow("observations are duplicated");
    expect(() =>
      createOpenWebResearchFreshnessCampaign({
        generatedAt: "2026-08-05T19:55:00.000Z",
        observations,
      }),
    ).toThrow("generation time is invalid");
  });
});

async function loadObservations() {
  return Promise.all(
    [RESULT_PATH, SERIES_PATH].map(loadOpenWebResearchFreshnessObservation),
  );
}
