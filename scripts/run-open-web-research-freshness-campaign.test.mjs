import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  import.meta.dirname,
  "run-open-web-research-freshness-campaign.mjs",
);
const caseRoot = path.join(
  repoRoot,
  "benchmarks/research/open-web-source-triad-v1",
);
const artifactRoot = path.join(repoRoot, "benchmark-results");
const artifactNames = [
  "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b90a841f097b03b9.json",
  "napier-open-web-research-series-research_open_web_source_triad_v1-a7b8199e42e13339.json",
  "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-d7e4f2fd4e284674.json",
  "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b6f353840b7374e9.json",
];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("open-web Research freshness campaign CLI", () => {
  it("creates and independently verifies a portable sibling campaign", async () => {
    const outputDir = await portableFixture();
    const created = await runScript([
      "--case",
      caseRoot,
      "--output-dir",
      outputDir,
      "--observation",
      path.join(outputDir, artifactNames[0]),
      "--observation",
      path.join(outputDir, artifactNames[1]),
    ]);

    expect(created.code).toBe(0);
    const summary = JSON.parse(created.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        observationCount: 2,
        trialCount: 3,
        passedTrialCount: 2,
        failedTrialCount: 1,
        passRate: 2 / 3,
        sourceCoverageMatchTrialCount: 3,
        citationEvidenceMatchTrialCount: 2,
        replayValidTrialCount: 3,
        credentialLeakTrialCount: 0,
      }),
    );
    const campaignName = (await readdir(outputDir)).find((name) =>
      name.startsWith(
        "napier-open-web-research-freshness-campaign-research_open_web_source_triad_v1-",
      ),
    );
    expect(campaignName).toBeTruthy();

    const verified = await runScript([
      "--case",
      caseRoot,
      "--verify",
      path.join(outputDir, campaignName),
    ]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        observationDiagnostics: [
          { index: 1, diagnostics: [] },
          { index: 2, diagnostics: [] },
        ],
      }),
    );
  });

  it("requires bounded co-located observations and isolated verify mode", async () => {
    const outputDir = await portableFixture();
    const outside = path.join(artifactRoot, artifactNames[0]);
    const notCoLocated = await runScript([
      "--case",
      caseRoot,
      "--output-dir",
      outputDir,
      "--observation",
      outside,
      "--observation",
      path.join(outputDir, artifactNames[1]),
    ]);
    expect(notCoLocated.code).not.toBe(0);
    expect(notCoLocated.stderr).toContain(
      "Every --observation artifact must be inside --output-dir",
    );

    const single = await runScript([
      "--case",
      caseRoot,
      "--observation",
      outside,
    ]);
    expect(single.code).not.toBe(0);
    expect(single.stderr).toContain(
      "--observation must be provided 2-10 times",
    );

    const mixed = await runScript([
      "--case",
      caseRoot,
      "--verify",
      "campaign.json",
      "--observation",
      outside,
    ]);
    expect(mixed.code).not.toBe(0);
    expect(mixed.stderr).toContain("--verify can only be combined with --case");

    const maliciousCampaignPath = path.join(
      outputDir,
      "malicious-campaign.json",
    );
    await writeFile(
      maliciousCampaignPath,
      `${JSON.stringify({
        observations: [{ artifactFileName: "../goal.md" }],
      })}\n`,
    );
    const malicious = await runScript([
      "--case",
      caseRoot,
      "--verify",
      maliciousCampaignPath,
    ]);
    expect(malicious.code).not.toBe(0);
    expect(malicious.stderr).toContain(
      "Open-web Research freshness campaign shape is invalid",
    );
  });
});

async function portableFixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "napier-open-web-freshness-"),
  );
  temporaryDirectories.push(directory);
  await Promise.all(
    artifactNames.map((name) =>
      cp(path.join(artifactRoot, name), path.join(directory, name)),
    ),
  );
  return directory;
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
