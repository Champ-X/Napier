import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseReleaseProductTrial,
  projectReleaseProductGate,
} from "../packages/runtime/dist/release-product-gate.js";

export const DEFAULT_PRODUCT_TRIAL_CORE_CASE_IDS = Object.freeze([
  "network-reference",
  "coding-verification",
  "dynamic-browser",
  "high-risk-confirmation",
  "artifact-delivery",
  "long-task-recovery",
]);

const MAX_ARTIFACT_BYTES = 256 * 1024;
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

export async function verifyDefaultProductTrialArtifact(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true, "Default Product Trial must be a file");
  assert.equal(
    info.isSymbolicLink(),
    false,
    "Default Product Trial must not be a symlink",
  );
  assert.equal(
    info.size <= MAX_ARTIFACT_BYTES,
    true,
    "Default Product Trial exceeds its byte bound",
  );
  const text = await readFile(target, "utf8");
  const artifact = JSON.parse(text);
  assert.equal(artifact.kind, "napier.release-product-gate");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.currentProductVersion, "0.1.2");
  assert.equal(artifact.templateId, "release-product-v1");
  assert.equal(artifact.templateVersion, 1);
  assert.equal(artifact.defaultTrackReady, false);
  assert.deepEqual(artifact.consecutivePassingVersions, []);
  assert.equal(Array.isArray(artifact.trials), true);
  assert.equal(
    artifact.trials.length,
    DEFAULT_PRODUCT_TRIAL_CORE_CASE_IDS.length,
  );
  assert.deepEqual(
    artifact.trials.map((trial) => trial.templateCaseId),
    DEFAULT_PRODUCT_TRIAL_CORE_CASE_IDS,
  );
  assert.equal(
    new Set(artifact.trials.map((trial) => trial.runId)).size,
    artifact.trials.length,
  );
  const trials = artifact.trials.map((trial) => {
    const parsed = parseReleaseProductTrial(trial);
    assert.ok(
      parsed,
      `Release Product Trial is invalid: ${trial?.id ?? "unknown"}`,
    );
    return parsed;
  });
  assert.deepEqual(
    artifact,
    projectReleaseProductGate(
      { id: artifact.casebookId, templateId: artifact.templateId },
      trials,
      artifact.currentProductVersion,
    ),
  );
  const current = artifact.versions.find(
    (version) => version.productVersion === artifact.currentProductVersion,
  );
  assert.deepEqual(current, {
    productVersion: "0.1.2",
    caseCount: 10,
    coveredCaseCount: 6,
    trialCount: 6,
    passedCount: 5,
    failedCount: 0,
    inconclusiveCount: 1,
    successRate: 0.8333,
    minimumSuccessRate: 0.9,
    meanUxScore: 3.5,
    configurationInterventions: 3,
    humanInterventions: 2,
    recoveryEvents: 1,
    criticalCaseIds: [
      "settings",
      "high-risk-confirmation",
      "shell-sandbox",
      "coding-verification",
      "long-task-recovery",
    ],
    failedCriticalCaseIds: ["settings", "shell-sandbox", "coding-verification"],
    status: "incomplete",
    firstRecordedAt: "2026-08-16T13:16:49.348Z",
    lastRecordedAt: "2026-08-16T13:41:10.478Z",
  });
  assert.deepEqual(
    artifact.trials.map((trial) => ({
      templateCaseId: trial.templateCaseId,
      status: trial.status,
      ...(trial.failureReason ? { failureReason: trial.failureReason } : {}),
    })),
    [
      { templateCaseId: "network-reference", status: "passed" },
      {
        templateCaseId: "coding-verification",
        status: "inconclusive",
        failureReason: "configuration",
      },
      { templateCaseId: "dynamic-browser", status: "passed" },
      { templateCaseId: "high-risk-confirmation", status: "passed" },
      { templateCaseId: "artifact-delivery", status: "passed" },
      { templateCaseId: "long-task-recovery", status: "passed" },
    ],
  );
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
    "Usage: node scripts/verify-default-product-trial.mjs <artifact.json>",
  );
  const artifact = await verifyDefaultProductTrialArtifact(file);
  process.stdout.write(
    `Verified Default Product Trial: ${artifact.trials.length} core cases ${artifact.contentSha256}\n`,
  );
}
