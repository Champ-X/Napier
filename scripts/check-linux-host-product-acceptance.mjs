import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  linuxHostProductAcceptanceImplementation,
  validateLinuxHostProductAcceptanceArtifact,
} from "./linux-host-product-acceptance-artifact.mjs";
import { runLinuxHostProductAcceptance } from "./linux-host-product-acceptance-live.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT_PATH =
  "docs/artifacts/linux-host-product-acceptance-stage19.json";

export async function collectLinuxHostProductAcceptance(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const live = await runLinuxHostProductAcceptance({ repoRoot });
  const implementation =
    await linuxHostProductAcceptanceImplementation(repoRoot);
  const withoutHash = {
    kind: "napier.linux-host-product-acceptance-stage19",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    implementation,
    ...live,
    retention: {
      credentialValues: false,
      rawCommandOutput: false,
      rawDockerOutput: false,
      rawDoctorReport: false,
      resourceNames: false,
      workspacePaths: false,
      guestPaths: false,
      endpointUrls: false,
      nodeArchiveBytes: false,
      sourceArchiveBytes: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      freshLinuxInstall: true,
      linuxHostProductAcceptance: true,
      windowsHostProductAcceptance: false,
      externalRegistryPublished: false,
      releaseSigningIdentity: false,
      externalAttestation: false,
      remaining: [
        "external multi-architecture registry publication",
        "release signing identity and transparency log",
        "external attestation",
        "Windows host product acceptance",
      ],
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export async function verifyLinuxHostProductAcceptance(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoPath(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT_PATH,
  );
  const [value, implementation] = await Promise.all([
    readJson(artifactPath, "Linux host product acceptance artifact"),
    linuxHostProductAcceptanceImplementation(repoRoot),
  ]);
  const errors = validateLinuxHostProductAcceptanceArtifact(
    value,
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
    throw new Error("Unknown Linux host product acceptance option");
  }
  if (live) {
    const artifact = await collectLinuxHostProductAcceptance();
    if (write) {
      await writeJson(
        path.join(defaultRepoRoot, DEFAULT_ARTIFACT_PATH),
        artifact,
      );
    }
    console.log(
      `Linux host product acceptance ${write ? "written" : "verified live"}: ${artifact.guest.host.distribution} ${artifact.guest.host.arch}`,
    );
    return;
  }
  const result = await verifyLinuxHostProductAcceptance();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Linux host product acceptance verified: ${result.path} ${result.sha256.slice(0, 16)}`,
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
