import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./sandbox-external-publication-model.mjs";
import {
  applySandboxExternalReleasePromotion,
  previewSandboxExternalReleasePromotion,
} from "./sandbox-external-release-promotion.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");

export async function runSandboxExternalReleasePromotion(options) {
  const preview = await previewSandboxExternalReleasePromotion(options);
  if (!options.apply) return preview.preview;
  return applySandboxExternalReleasePromotion({
    ...options,
    expectedPreviewSha256: options.expectedPreviewSha256,
  });
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
        "--evidence-dir",
        "--authority-path",
        "--expected-preview",
      ].includes(name) ||
      !value
    ) {
      throw new Error(
        "Sandbox external release promotion arguments are invalid",
      );
    }
    if (name === "--repo-root") options.repoRoot = path.resolve(value);
    if (name === "--source-sha") options.sourceSha = value;
    if (name === "--expected-run-id") options.expectedRunId = value;
    if (name === "--evidence-dir") options.evidenceDir = path.resolve(value);
    if (name === "--authority-path") {
      options.authorityPath = path.resolve(value);
    }
    if (name === "--expected-preview") options.expectedPreviewSha256 = value;
    index += 1;
  }
  if (
    !options.sourceSha ||
    !options.expectedRunId ||
    !options.evidenceDir ||
    !options.authorityPath ||
    (options.apply && !options.expectedPreviewSha256) ||
    (!options.apply && options.expectedPreviewSha256)
  ) {
    throw new Error("Sandbox external release promotion inputs are incomplete");
  }
  return options;
}

async function runCli() {
  try {
    const result = await runSandboxExternalReleasePromotion(
      parseOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnosticSha256 = sha256(
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      `Sandbox external release promotion failed (${diagnosticSha256.slice(
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
