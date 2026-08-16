import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseDirectReleaseProductGate,
  projectReleaseProductGate,
} from "../packages/runtime/dist/release-product-gate.js";
import { createReleaseProductTrialAdoption } from "../packages/runtime/dist/release-product-trial-adoption.js";

export const DEFAULT_PRODUCT_CONSOLIDATION_SOURCES = Object.freeze([
  "docs/artifacts/default-product-trial-m4-0.1.2.json",
  "docs/artifacts/default-product-coding-rerun-m4-0.1.2.json",
  "docs/artifacts/default-product-critical-coverage-m4-0.1.2.json",
  "docs/artifacts/default-product-breadth-m4-0.1.2.json",
]);

const DESTINATION_CASEBOOK_ID = "casebook_m4consolidated012";
const DEFAULT_PRODUCT_VERSION = "0.1.2";
const MAX_SOURCE_BYTES = 256 * 1024;

export async function consolidateDefaultProductGates({
  sourcePaths,
  destinationCasebookId = DESTINATION_CASEBOOK_ID,
  productVersion = DEFAULT_PRODUCT_VERSION,
  adoptedAt = "2026-08-17T00:00:00.000Z",
}) {
  assert.match(destinationCasebookId, /^casebook_[a-z0-9]{8,80}$/);
  assert.equal(
    Number.isFinite(Date.parse(adoptedAt)),
    true,
    "Adoption timestamp is invalid",
  );
  const sourceGates = await Promise.all(sourcePaths.map(loadDirectGate));
  const selectedByCase = selectLatestPassedTrials(sourceGates, productVersion);
  const destination = {
    id: destinationCasebookId,
    templateId: "release-product-v1",
  };
  const adoptions = sourceGates.flatMap((sourceGate, sourceIndex) => {
    const sourceTrialIds = sourceGate.trials
      .filter(
        (trial) => selectedByCase.get(trial.templateCaseId)?.id === trial.id,
      )
      .map((trial) => trial.id);
    if (sourceTrialIds.length === 0) return [];
    return [
      createReleaseProductTrialAdoption(
        destination,
        sourceGate,
        sourceTrialIds,
        {
          id: adoptionId(destinationCasebookId, sourceGate.contentSha256),
          adoptedAt: offsetTimestamp(adoptedAt, sourceIndex),
        },
      ),
    ];
  });
  const projection = projectReleaseProductGate(
    destination,
    [],
    productVersion,
    adoptions,
  );
  const version = projection.versions.find(
    (candidate) => candidate.productVersion === productVersion,
  );
  assert.equal(
    version?.coveredCaseCount,
    10,
    "Consolidated coverage is incomplete",
  );
  assert.equal(
    version?.passedCount,
    10,
    "Consolidated coverage is not passing",
  );
  assert.equal(version?.status, "passed", "Consolidated version did not pass");
  assert.deepEqual(
    projection.consecutivePassingVersions,
    [productVersion],
    "Consolidation must remain a single passing version",
  );
  assert.equal(
    projection.defaultTrackReady,
    false,
    "One consolidated version must not claim Default Track readiness",
  );
  return projection;
}

async function loadDirectGate(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true, `Source Gate is not a file: ${file}`);
  assert.equal(
    info.isSymbolicLink(),
    false,
    `Source Gate is a symlink: ${file}`,
  );
  assert.equal(
    info.size <= MAX_SOURCE_BYTES,
    true,
    `Source Gate exceeds its byte bound: ${file}`,
  );
  const gate = parseDirectReleaseProductGate(
    JSON.parse(await readFile(target, "utf8")),
  );
  assert.ok(gate, `Source Gate failed hash verification: ${file}`);
  return gate;
}

function selectLatestPassedTrials(sourceGates, productVersion) {
  const selected = new Map();
  for (const gate of sourceGates) {
    assert.equal(
      gate.currentProductVersion,
      productVersion,
      "Source Gate product version does not match",
    );
    for (const trial of gate.trials) {
      if (trial.productVersion !== productVersion || trial.status !== "passed")
        continue;
      const previous = selected.get(trial.templateCaseId);
      if (!previous || previous.recordedAt < trial.recordedAt) {
        selected.set(trial.templateCaseId, trial);
      }
    }
  }
  assert.equal(
    selected.size,
    10,
    "Every fixed case needs a passed source Trial",
  );
  assert.equal(
    new Set([...selected.values()].map((trial) => trial.runId)).size,
    selected.size,
    "Selected source Runs must be unique",
  );
  return selected;
}

function adoptionId(destinationCasebookId, sourceGateSha256) {
  return `release_adoption_${createHash("sha256")
    .update(`${destinationCasebookId}:${sourceGateSha256}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function offsetTimestamp(value, offset) {
  return new Date(Date.parse(value) + offset).toISOString();
}

function parseArgs(args) {
  const sourcePaths = [];
  let outputPath;
  let destinationCasebookId = DESTINATION_CASEBOOK_ID;
  let productVersion = DEFAULT_PRODUCT_VERSION;
  let adoptedAt = "2026-08-17T00:00:00.000Z";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--source" && value) {
      sourcePaths.push(value);
      index += 1;
    } else if (arg === "--output" && value) {
      outputPath = value;
      index += 1;
    } else if (arg === "--casebook-id" && value) {
      destinationCasebookId = value;
      index += 1;
    } else if (arg === "--product-version" && value) {
      productVersion = value;
      index += 1;
    } else if (arg === "--adopted-at" && value) {
      adoptedAt = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!outputPath) throw new Error("--output is required");
  return {
    sourcePaths:
      sourcePaths.length > 0
        ? sourcePaths
        : [...DEFAULT_PRODUCT_CONSOLIDATION_SOURCES],
    outputPath,
    destinationCasebookId,
    productVersion,
    adoptedAt,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projection = await consolidateDefaultProductGates(options);
  await writeFile(
    path.resolve(options.outputPath),
    `${JSON.stringify(projection, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${projection.contentSha256} ${options.outputPath}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
