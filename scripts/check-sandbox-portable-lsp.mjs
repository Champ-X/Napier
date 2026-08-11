import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { verifySandboxImageArtifacts } from "./check-sandbox-image-sbom.mjs";
import {
  sandboxPortableLspImplementation,
  validateSandboxPortableLspArtifact,
} from "./sandbox-portable-lsp-artifact.mjs";
import { runSandboxPortableLspAcceptance } from "./sandbox-portable-lsp-live.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT_PATH =
  "docs/artifacts/sandbox-portable-lsp-stage16.json";
const PROVENANCE_PATH = "docs/artifacts/sandbox-image-provenance-0.1.0.json";

export async function collectSandboxPortableLsp(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const provenance = await readJson(
    path.join(repoRoot, PROVENANCE_PATH),
    "Sandbox image provenance",
  );
  const imageVerification = await verifySandboxImageArtifacts({
    repoRoot,
    verifyReceiptPath: PROVENANCE_PATH,
  });
  if (!imageVerification.valid) {
    throw new Error("Sandbox image provenance is not valid");
  }
  const image = provenance.image;
  if (
    !isRecord(image) ||
    typeof image.id !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(image.id) ||
    image.os !== "linux" ||
    !["amd64", "arm64"].includes(image.arch)
  ) {
    throw new Error("Sandbox image provenance identity is invalid");
  }
  const live = await runSandboxPortableLspAcceptance({
    repoRoot,
    imageId: image.id,
    dependencies: options.dependencies,
  });
  const implementation = await sandboxPortableLspImplementation(repoRoot);
  const withoutHash = {
    kind: "napier.sandbox-portable-lsp-stage16",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    image: {
      id: image.id,
      platform: `${image.os}/${image.arch}`,
      provenanceSha256: imageVerification.receiptSha256,
    },
    implementation,
    ...live,
    retention: {
      credentialValues: false,
      rawDiagnostics: false,
      rawSymbols: false,
      rawLocations: false,
      rawDockerOutput: false,
      workspacePaths: false,
      numericHostUserIds: false,
      resourceNames: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      portableLspReadPlane: true,
      windowsHostExecuted: false,
      portableDapComplete: false,
      remaining: [
        "portable DAP protocol path translation",
        "Windows and Linux host product acceptance",
        "multi-architecture registry publication",
        "image signature and external attestation",
      ],
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export async function verifySandboxPortableLsp(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoPath(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT_PATH,
  );
  const [value, provenance, implementation] = await Promise.all([
    readJson(artifactPath, "Sandbox portable LSP artifact"),
    readJson(path.join(repoRoot, PROVENANCE_PATH), "Sandbox image provenance"),
    sandboxPortableLspImplementation(repoRoot),
  ]);
  const imageVerification = await verifySandboxImageArtifacts({
    repoRoot,
    verifyReceiptPath: PROVENANCE_PATH,
  });
  const errors = validateSandboxPortableLspArtifact(
    value,
    provenance,
    implementation,
  );
  if (!imageVerification.valid) {
    errors.push(
      ...imageVerification.errors.map(
        (error) => `Sandbox image provenance: ${error}`,
      ),
    );
  }
  if (value.image?.provenanceSha256 !== imageVerification.receiptSha256) {
    errors.push(
      "Sandbox portable LSP provenance SHA-256 does not match the receipt",
    );
  }
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
    throw new Error("Unknown Sandbox portable LSP option");
  }
  if (live) {
    const artifact = await collectSandboxPortableLsp();
    if (write) {
      await writeJson(
        path.join(defaultRepoRoot, DEFAULT_ARTIFACT_PATH),
        artifact,
      );
    }
    console.log(
      `Sandbox portable LSP ${write ? "written" : "verified live"}: ${artifact.productionParity.allEqual ? "parity" : "failed"}`,
    );
    return;
  }
  const result = await verifySandboxPortableLsp();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Sandbox portable LSP verified: ${result.path} ${result.sha256.slice(0, 16)}`,
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
