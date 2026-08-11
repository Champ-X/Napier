import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  sandboxMultiArchitectureImplementation,
  validateSandboxMultiArchitectureArtifact,
} from "./sandbox-multi-architecture-artifact.mjs";
import { runSandboxMultiArchitectureAcceptance } from "./sandbox-multi-architecture-live.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT_PATH =
  "docs/artifacts/sandbox-multi-architecture-stage14.json";

export async function collectSandboxMultiArchitecture(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const source = await sandboxImageSourceEvidence(repoRoot);
  const live = await runSandboxMultiArchitectureAcceptance({
    repoRoot,
    source,
    dependencies: options.dependencies,
  });
  const implementation = await sandboxMultiArchitectureImplementation(repoRoot);
  const withoutHash = {
    kind: "napier.sandbox-multi-architecture-stage14",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    implementation,
    ...live,
    retention: {
      credentialValues: false,
      rawBuildOutput: false,
      rawDockerOutput: false,
      resourceNames: false,
      temporaryTags: false,
      workspacePaths: false,
      daemonEndpoints: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      localBuildAndExecution: true,
      registryPublication: false,
      signature: false,
      crossHostAcceptance: false,
      remaining: [
        "multi-architecture registry publication",
        "image signature and external attestation",
        "non-POSIX host user and path mapping",
        "Windows and Linux host product acceptance",
      ],
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export async function verifySandboxMultiArchitecture(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoPath(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT_PATH,
  );
  const [value, source, implementation] = await Promise.all([
    readJson(artifactPath, "Sandbox multi-architecture artifact"),
    sandboxImageSourceEvidence(repoRoot),
    sandboxMultiArchitectureImplementation(repoRoot),
  ]);
  const errors = validateSandboxMultiArchitectureArtifact(
    value,
    source,
    implementation,
  );
  return {
    valid: errors.length === 0,
    errors,
    path: toRepoPath(repoRoot, artifactPath),
    sha256: sha256(await readFile(artifactPath)),
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const live = args.includes("--live") || args.includes("--write");
  const write = args.includes("--write");
  if (args.some((arg) => !["--live", "--write"].includes(arg))) {
    throw new Error("Unknown Sandbox multi-architecture option");
  }
  if (live) {
    const artifact = await collectSandboxMultiArchitecture();
    if (write) {
      await writeJson(
        path.join(defaultRepoRoot, DEFAULT_ARTIFACT_PATH),
        artifact,
      );
    }
    console.log(
      `Sandbox multi-architecture ${write ? "written" : "verified live"}: ${artifact.platforms.length} platforms`,
    );
    return;
  }
  const result = await verifySandboxMultiArchitecture();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Sandbox multi-architecture verified: ${result.path} ${result.sha256.slice(0, 16)}`,
  );
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
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

function resolveRepoPath(repoRoot, candidate) {
  const absolute = path.resolve(repoRoot, candidate);
  const relative = path.relative(repoRoot, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("artifact path must remain inside the repository");
  }
  return absolute;
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
