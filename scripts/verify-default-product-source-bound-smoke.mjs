import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseDirectReleaseProductGate } from "../packages/runtime/dist/release-product-gate.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "../packages/runtime/dist/release-product-identity.js";

const EXPECTED_CASES = [
  "settings",
  "network-reference",
  "url-pdf",
  "dynamic-browser",
  "coding-verification",
  "shell-sandbox",
];
const RELEASE_IDENTITY = NAPIER_RELEASE_IDENTITY_SHA256;
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

export async function verifyDefaultProductSourceBoundSmoke(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(info.size <= 256 * 1024, true);
  const artifact = JSON.parse(await readFile(target, "utf8"));
  const gate = parseDirectReleaseProductGate(artifact);
  assert.ok(gate, "Source-bound Default Product Gate is invalid");
  assert.equal(gate.currentProductVersion, "0.1.3");
  assert.equal(gate.currentReleaseIdentitySha256, RELEASE_IDENTITY);
  assert.deepEqual(gate.consecutivePassingVersions, []);
  assert.equal(gate.defaultTrackReady, false);
  assert.equal(gate.adoptions, undefined);
  assert.deepEqual(
    gate.trials.map((trial) => trial.templateCaseId),
    EXPECTED_CASES,
  );
  assert.equal(
    gate.trials.every(
      (trial) =>
        trial.status === "passed" &&
        trial.runStatus === "completed" &&
        trial.releaseIdentitySha256 === RELEASE_IDENTITY,
    ),
    true,
  );
  assert.equal(gate.versions.length, 1);
  const version = gate.versions[0];
  assert.ok(version);
  const { firstRecordedAt, lastRecordedAt, ...versionSummary } = version;
  assert.deepEqual(versionSummary, {
    productVersion: "0.1.3",
    caseCount: 10,
    coveredCaseCount: 6,
    trialCount: 6,
    passedCount: 6,
    failedCount: 0,
    inconclusiveCount: 0,
    successRate: 1,
    minimumSuccessRate: 0.9,
    meanUxScore: 4.17,
    configurationInterventions: 3,
    humanInterventions: 2,
    recoveryEvents: 0,
    criticalCaseIds: [
      "settings",
      "high-risk-confirmation",
      "shell-sandbox",
      "coding-verification",
      "long-task-recovery",
    ],
    failedCriticalCaseIds: ["high-risk-confirmation", "long-task-recovery"],
    releaseIdentitySha256: RELEASE_IDENTITY,
    status: "incomplete",
  });
  assert.equal(firstRecordedAt, gate.trials[0]?.recordedAt);
  assert.equal(lastRecordedAt, gate.trials.at(-1)?.recordedAt);
  assert.equal(Number.isNaN(Date.parse(firstRecordedAt)), false);
  assert.equal(Number.isNaN(Date.parse(lastRecordedAt)), false);
  assert.equal(firstRecordedAt <= lastRecordedAt, true);
  assert.equal(findForbiddenKey(gate), undefined);
  return gate;
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
  if (!file) throw new Error("Gate file is required");
  const gate = await verifyDefaultProductSourceBoundSmoke(file);
  process.stdout.write(`${gate.contentSha256} ${file}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
