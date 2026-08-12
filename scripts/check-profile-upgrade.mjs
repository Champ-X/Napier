import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  profileUpgradeImplementation,
  validateProfileUpgradeArtifact,
} from "./profile-upgrade-artifact.mjs";
import { runProfileUpgradeAcceptance } from "./profile-upgrade-acceptance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT = "docs/artifacts/profile-upgrade-stage21.json";

export async function collectProfileUpgrade(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const [live, implementation] = await Promise.all([
    runProfileUpgradeAcceptance(repoRoot),
    profileUpgradeImplementation(repoRoot),
  ]);
  const content = {
    kind: "napier.profile-upgrade-stage21",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    implementation,
    ...live,
    retention: {
      profileBodies: false,
      systemPrompts: false,
      workspacePaths: false,
      rawCliOutput: false,
      rawBrowserOutput: false,
      credentialValues: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      managedUpgradeAccepted: true,
      explicitOverridesPreserved: true,
      unmanagedInferenceRejected: true,
      remaining: [
        "public signed external release",
        "Windows host product acceptance",
      ],
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export async function verifyProfileUpgrade(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = path.join(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT,
  );
  const [value, implementation] = await Promise.all([
    readJson(artifactPath),
    profileUpgradeImplementation(repoRoot),
  ]);
  const errors = validateProfileUpgradeArtifact(value, implementation);
  return {
    valid: errors.length === 0,
    errors,
    path: path.relative(repoRoot, artifactPath).split(path.sep).join("/"),
    sha256: sha256(await readFile(artifactPath)),
  };
}

async function runCli() {
  const write = process.argv.slice(2).includes("--write");
  if (process.argv.length > (write ? 3 : 2)) {
    throw new Error(
      "Usage: node scripts/check-profile-upgrade.mjs [--write]",
    );
  }
  if (write) {
    const artifact = await collectProfileUpgrade();
    await writeJson(path.join(defaultRepoRoot, DEFAULT_ARTIFACT), artifact);
    console.log(
      `Profile upgrade written: ${artifact.contentSha256.slice(0, 16)}`,
    );
    return;
  }
  const result = await verifyProfileUpgrade();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Profile upgrade verified: ${result.path} ${result.sha256.slice(0, 16)}`,
  );
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Profile upgrade artifact is not valid JSON");
  }
}

async function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o644);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
