import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  sha256,
  validateWindowsHostProductAcceptanceReceipt,
  windowsHostProductAcceptanceImplementation,
} from "./windows-host-product-acceptance-artifact.mjs";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function verifyWindowsHostProductAcceptance(options) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sourceSha = String(options.sourceSha ?? "");
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error("expected Windows acceptance source SHA is invalid");
  }
  const artifactCandidate = options.artifactPath;
  if (
    typeof artifactCandidate !== "string" ||
    !path.isAbsolute(artifactCandidate)
  ) {
    throw new Error("Windows acceptance artifact path must be absolute");
  }
  const artifactPath = path.resolve(artifactCandidate);
  const value = await readJson(
    artifactPath,
    "Windows host product acceptance receipt",
  );
  const [implementation, sandboxSource] = await Promise.all([
    windowsHostProductAcceptanceImplementation(repoRoot),
    sandboxImageSourceEvidence(repoRoot),
  ]);
  const errors = validateWindowsHostProductAcceptanceReceipt(value, {
    sourceSha,
    implementation,
    contextSha256: sandboxSource.contextSha256,
  });
  return {
    valid: errors.length === 0,
    errors,
    path: artifactPath,
    sha256: sha256(await readFile(artifactPath)),
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseOptions(args) {
  const options = { repoRoot: defaultRepoRoot };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !["--artifact-path", "--source-sha", "--repo-root"].includes(name) ||
      !value
    ) {
      throw new Error(
        "Windows host receipt verification arguments are invalid",
      );
    }
    if (name === "--artifact-path") options.artifactPath = path.resolve(value);
    if (name === "--source-sha") options.sourceSha = value;
    if (name === "--repo-root") options.repoRoot = path.resolve(value);
  }
  if (!options.artifactPath || !options.sourceSha) {
    throw new Error(
      "Windows host receipt path and expected source SHA are required",
    );
  }
  return options;
}

async function runCli() {
  const result = await verifyWindowsHostProductAcceptance(
    parseOptions(process.argv.slice(2)),
  );
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Windows host product acceptance verified: ${result.sha256.slice(0, 16)}`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
