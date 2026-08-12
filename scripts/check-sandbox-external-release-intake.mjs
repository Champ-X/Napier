import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applySandboxExternalReleaseIntake,
  previewSandboxExternalReleaseIntake,
} from "./sandbox-external-release-intake.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function runSandboxExternalReleaseIntake(options) {
  if (!options.apply) return previewSandboxExternalReleaseIntake(options);
  return applySandboxExternalReleaseIntake(options);
}

function parseOptions(args) {
  const options = { repoRoot: defaultRepoRoot, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--apply") {
      options.apply = true;
      continue;
    }
    const value = args[index + 1];
    if (
      ![
        "--repo-root",
        "--source-sha",
        "--expected-run-id",
        "--expected-preview",
      ].includes(name) ||
      !value
    ) {
      throw new Error("Sandbox external release intake arguments are invalid");
    }
    if (name === "--repo-root") options.repoRoot = path.resolve(value);
    if (name === "--source-sha") options.sourceSha = value;
    if (name === "--expected-run-id") options.expectedRunId = value;
    if (name === "--expected-preview") options.expectedPreviewSha256 = value;
    index += 1;
  }
  if (
    !options.sourceSha ||
    !options.expectedRunId ||
    (options.apply && !options.expectedPreviewSha256) ||
    (!options.apply && options.expectedPreviewSha256)
  ) {
    throw new Error("Sandbox external release intake inputs are incomplete");
  }
  return options;
}

async function runCli() {
  try {
    const result = await runSandboxExternalReleaseIntake(
      parseOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnosticSha256 = sha256(
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      `Sandbox external release intake failed (${diagnosticSha256.slice(
        0,
        16,
      )})`,
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
