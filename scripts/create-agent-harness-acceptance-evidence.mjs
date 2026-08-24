#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createAgentHarnessAcceptanceEvidence,
  validateAgentHarnessAcceptanceEvidence,
} from "../packages/runtime/dist/agent-harness-acceptance.js";
import { validateHarnessExperimentReleaseEvidence } from "../packages/runtime/dist/harness-experiments.js";
import { collectCodeBridgeEvidence } from "./agent-harness-acceptance-bridge.mjs";
import { collectRouteAndToolEvidence } from "./agent-harness-acceptance-route-tools.mjs";
import { collectSubagentEvidence } from "./agent-harness-acceptance-subagents.mjs";
import { collectTokenEvidence } from "./agent-harness-acceptance-token.mjs";
import { createReleaseProductSourceManifest } from "./release-product-source-manifest.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(
  repoRoot,
  "docs/artifacts/agent-harness-acceptance-evidence-0.1.3.json",
);
const harnessPath = path.join(
  repoRoot,
  "docs/artifacts/harness-experiment-release-evidence-0.1.3.json",
);

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex >= 0) {
  const target = path.resolve(
    repoRoot,
    process.argv[verifyIndex + 1] ?? path.relative(repoRoot, outputPath),
  );
  const evidence = validateAgentHarnessAcceptanceEvidence(
    JSON.parse(await readFile(target, "utf8")),
  );
  const { sourceManifest, harness } = await releaseBindings();
  if (evidence.sourceManifestSha256 !== sourceManifest.contentSha256) {
    throw new Error("Agent Harness acceptance evidence source manifest drift");
  }
  if (evidence.harnessExperimentEvidenceSha256 !== harness.contentSha256) {
    throw new Error("Agent Harness acceptance evidence experiment drift");
  }
  process.stdout.write(
    `${JSON.stringify({ valid: true, acceptanceReady: evidence.acceptanceReady, contentSha256: evidence.contentSha256 })}\n`,
  );
} else {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-agent-harness-acceptance-"),
  );
  try {
    const { sourceManifest, harness } = await releaseBindings();
    const ledgerRuns = [];
    const routeAndTools = await collectRouteAndToolEvidence(
      temporaryRoot,
      ledgerRuns,
    );
    const codeBridge = await collectCodeBridgeEvidence(
      temporaryRoot,
      ledgerRuns,
    );
    const subagents = await collectSubagentEvidence(temporaryRoot, ledgerRuns);
    const tokens = await collectTokenEvidence(temporaryRoot, ledgerRuns);
    const evidence = createAgentHarnessAcceptanceEvidence({
      kind: "napier.agent-harness-acceptance-evidence",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      productVersion: sourceManifest.productVersion,
      sourceManifestSha256: sourceManifest.contentSha256,
      harnessExperimentEvidenceSha256: harness.contentSha256,
      primaryModels: tokens.primaryModels,
      ledgerRuns,
      routeCases: routeAndTools.routeCases,
      capabilityReachabilityCases: routeAndTools.capabilityReachabilityCases,
      loopPairs: routeAndTools.loopPairs,
      codeBridgeCalls: codeBridge.codeBridgeCalls,
      codeBridgePrivilegeProbes: codeBridge.codeBridgePrivilegeProbes,
      subagentTasks: subagents.subagentTasks,
      steeringBoundaryChecks: subagents.steeringBoundaryChecks,
      cancellationBoundaryChecks: subagents.cancellationBoundaryChecks,
      tokenCalibrationObservations: tokens.tokenCalibrationObservations,
      conservativeTokenFallbackProbe: tokens.conservativeTokenFallbackProbe,
    });
    if (!evidence.acceptanceReady) {
      throw new Error(
        `Agent Harness acceptance evidence is blocked: ${evidence.blockers.join(",")}`,
      );
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `${JSON.stringify({ outputPath: path.relative(repoRoot, outputPath), ledgerRunCount: evidence.ledgerRuns.length, summary: evidence.summary, contentSha256: evidence.contentSha256 })}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function releaseBindings() {
  const sourceManifest = await createReleaseProductSourceManifest();
  const harness = validateHarnessExperimentReleaseEvidence(
    JSON.parse(await readFile(harnessPath, "utf8")),
  );
  if (!harness.promotionReady) {
    throw new Error(
      `Harness experiment evidence is blocked: ${harness.blockers.join(",")}`,
    );
  }
  if (
    harness.bindings.some(
      (binding) =>
        binding.sourceManifestSha256 !== sourceManifest.contentSha256,
    )
  ) {
    throw new Error("Harness experiment evidence source manifest drift");
  }
  return { sourceManifest, harness };
}
