import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseReleaseProductTrial,
  projectReleaseProductGate,
} from "../packages/runtime/dist/release-product-gate.js";

const MAX_ARTIFACT_BYTES = 64 * 1024;
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

export async function verifyDefaultProductBreadthArtifact(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true, "Breadth Gate must be a file");
  assert.equal(
    info.isSymbolicLink(),
    false,
    "Breadth Gate must not be a symlink",
  );
  assert.equal(
    info.size <= MAX_ARTIFACT_BYTES,
    true,
    "Breadth Gate exceeds its byte bound",
  );
  const artifact = JSON.parse(await readFile(target, "utf8"));
  assert.equal(artifact.kind, "napier.release-product-gate");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.currentProductVersion, "0.1.2");
  assert.equal(artifact.templateId, "release-product-v1");
  assert.equal(artifact.templateVersion, 1);
  assert.equal(artifact.defaultTrackReady, false);
  assert.deepEqual(artifact.consecutivePassingVersions, []);
  assert.equal(artifact.trials?.length, 2);
  const trials = artifact.trials.map(parseReleaseProductTrial);
  assert.equal(trials.every(Boolean), true, "Breadth Trial is invalid");
  assert.deepEqual(
    trials.map((trial) => ({
      templateCaseId: trial.templateCaseId,
      runStatus: trial.runStatus,
      status: trial.status,
      configurationInterventions: trial.configurationInterventions,
      humanInterventions: trial.humanInterventions,
      recoveryEvents: trial.recoveryEvents,
      uxScore: trial.uxScore,
    })),
    [
      {
        templateCaseId: "url-pdf",
        runStatus: "completed",
        status: "passed",
        configurationInterventions: 0,
        humanInterventions: 0,
        recoveryEvents: 0,
        uxScore: 5,
      },
      {
        templateCaseId: "skill",
        runStatus: "completed",
        status: "passed",
        configurationInterventions: 0,
        humanInterventions: 1,
        recoveryEvents: 0,
        uxScore: 4,
      },
    ],
  );
  assert.deepEqual(
    artifact,
    projectReleaseProductGate(
      { id: artifact.casebookId, templateId: artifact.templateId },
      trials,
      artifact.currentProductVersion,
    ),
  );
  assert.deepEqual(artifact.versions, [
    {
      productVersion: "0.1.2",
      caseCount: 10,
      coveredCaseCount: 2,
      trialCount: 2,
      passedCount: 2,
      failedCount: 0,
      inconclusiveCount: 0,
      successRate: 1,
      minimumSuccessRate: 0.9,
      meanUxScore: 4.5,
      configurationInterventions: 0,
      humanInterventions: 1,
      recoveryEvents: 0,
      criticalCaseIds: [
        "settings",
        "high-risk-confirmation",
        "shell-sandbox",
        "coding-verification",
        "long-task-recovery",
      ],
      failedCriticalCaseIds: [
        "settings",
        "high-risk-confirmation",
        "shell-sandbox",
        "coding-verification",
        "long-task-recovery",
      ],
      status: "incomplete",
      firstRecordedAt: "2026-08-16T15:31:24.724Z",
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const file = process.argv[2];
  assert.ok(
    file && process.argv.length === 3,
    "Usage: node scripts/verify-default-product-breadth.mjs <artifact.json>",
  );
  const artifact = await verifyDefaultProductBreadthArtifact(file);
  process.stdout.write(
    `Verified Default Product breadth: ${artifact.trials.length} Trials ${artifact.contentSha256}\n`,
  );
}
