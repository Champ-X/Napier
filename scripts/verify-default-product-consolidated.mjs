import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseDirectReleaseProductGate,
  projectReleaseProductGate,
} from "../packages/runtime/dist/release-product-gate.js";
import { parseReleaseProductTrialAdoption } from "../packages/runtime/dist/release-product-trial-adoption.js";

const EXPECTED_SOURCE_GATE_SHA256 = new Set([
  "19566cdf8ef1bcc0ce531af6d51b124437abb9ac007fdb55f3808541738bda1c",
  "04c2e2caedd99c8b13cf336387585a3bbaaef9ebaea1a91296721ee6c032b464",
  "c801e0f985c0be86545b01bb695712cf0c192fdcd072f3a4dbbd2e44f9e88bbe",
  "7459afcfad494351b861a064ee7220ffa475e44e7bd4da888fb74416781d5e24",
]);
const EXPECTED_CASE_IDS = new Set([
  "settings",
  "network-reference",
  "url-pdf",
  "dynamic-browser",
  "high-risk-confirmation",
  "shell-sandbox",
  "skill",
  "coding-verification",
  "long-task-recovery",
  "artifact-delivery",
]);
const FORBIDDEN_KEYS = new Set([
  "answer",
  "credential",
  "output",
  "prompt",
  "reasoning",
  "secret",
  "transcript",
  "url",
]);
const MAX_ARTIFACT_BYTES = 512 * 1024;

export async function verifyDefaultProductConsolidatedArtifact(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true, "Consolidated Gate must be a file");
  assert.equal(
    info.isSymbolicLink(),
    false,
    "Consolidated Gate must not be a symlink",
  );
  assert.equal(
    info.size <= MAX_ARTIFACT_BYTES,
    true,
    "Consolidated Gate exceeds its byte bound",
  );
  const artifact = JSON.parse(await readFile(target, "utf8"));
  assert.equal(artifact.kind, "napier.release-product-gate");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.currentProductVersion, "0.1.2");
  assert.equal(artifact.casebookId, "casebook_m4consolidated012");
  assert.equal(artifact.templateId, "release-product-v1");
  assert.equal(artifact.templateVersion, 1);
  assert.deepEqual(artifact.trials, []);
  assert.equal(artifact.adoptions?.length, 4);
  assert.deepEqual(artifact.consecutivePassingVersions, ["0.1.2"]);
  assert.equal(artifact.defaultTrackReady, false);
  const adoptions = artifact.adoptions.map(parseReleaseProductTrialAdoption);
  assert.equal(
    adoptions.every(Boolean),
    true,
    "Consolidated adoption is invalid",
  );
  assert.deepEqual(
    new Set(adoptions.map((adoption) => adoption.sourceGate.contentSha256)),
    EXPECTED_SOURCE_GATE_SHA256,
  );
  for (const adoption of adoptions) {
    assert.ok(parseDirectReleaseProductGate(adoption.sourceGate));
  }
  const selectedTrials = adoptions.flatMap((adoption) =>
    adoption.sourceTrialIds.map((trialId) => {
      const trial = adoption.sourceGate.trials.find(
        (candidate) => candidate.id === trialId,
      );
      assert.ok(trial, `Adopted Trial is missing: ${trialId}`);
      return trial;
    }),
  );
  assert.equal(selectedTrials.length, 10);
  assert.equal(new Set(selectedTrials.map((trial) => trial.id)).size, 10);
  assert.equal(new Set(selectedTrials.map((trial) => trial.runId)).size, 10);
  assert.deepEqual(
    new Set(selectedTrials.map((trial) => trial.templateCaseId)),
    EXPECTED_CASE_IDS,
  );
  assert.equal(
    selectedTrials.every(
      (trial) => trial.status === "passed" && trial.runStatus === "completed",
    ),
    true,
  );
  assert.deepEqual(
    artifact,
    projectReleaseProductGate(
      { id: artifact.casebookId, templateId: artifact.templateId },
      [],
      artifact.currentProductVersion,
      adoptions,
    ),
  );
  assert.deepEqual(artifact.versions, [
    {
      productVersion: "0.1.2",
      caseCount: 10,
      coveredCaseCount: 10,
      trialCount: 10,
      passedCount: 10,
      failedCount: 0,
      inconclusiveCount: 0,
      successRate: 1,
      minimumSuccessRate: 0.9,
      meanUxScore: 3.7,
      configurationInterventions: 6,
      humanInterventions: 6,
      recoveryEvents: 1,
      criticalCaseIds: [
        "settings",
        "high-risk-confirmation",
        "shell-sandbox",
        "coding-verification",
        "long-task-recovery",
      ],
      failedCriticalCaseIds: [],
      status: "passed",
      firstRecordedAt: "2026-08-16T13:16:49.348Z",
      lastRecordedAt: "2026-08-16T15:44:42.667Z",
    },
  ]);
  assert.equal(findForbiddenKey(artifact), undefined);
  return artifact;
}

function findForbiddenKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return key;
    const found = findForbiddenKey(item);
    if (found) return found;
  }
  return undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error("Usage: verify-default-product-consolidated.mjs <file>");
  const artifact = await verifyDefaultProductConsolidatedArtifact(file);
  process.stdout.write(`${artifact.contentSha256} ${file}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
