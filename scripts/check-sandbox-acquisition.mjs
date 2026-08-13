import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  sandboxAcquisitionImplementation,
  validateSandboxAcquisitionArtifact,
} from "./sandbox-acquisition-artifact.mjs";
import { runSandboxAcquisitionAcceptance } from "./sandbox-acquisition-acceptance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT = "docs/artifacts/sandbox-acquisition-stage20.json";

export async function collectSandboxAcquisition(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const contextSha256 = options.contextSha256;
  const privateReference = options.privateReference;
  const privateSourceSha = options.privateSourceSha;
  if (
    !/^[a-f0-9]{64}$/u.test(contextSha256 ?? "") ||
    !/^ghcr\.io\/champ-x\/napier-sandbox@sha256:[a-f0-9]{64}$/u.test(
      privateReference ?? "",
    ) ||
    !/^[a-f0-9]{40}$/u.test(privateSourceSha ?? "")
  ) {
    throw new Error("Sandbox acquisition live inputs are invalid");
  }
  const [live, implementation] = await Promise.all([
    runSandboxAcquisitionAcceptance({
      repoRoot,
      contextSha256,
      privateReference,
      privateSourceSha,
    }),
    sandboxAcquisitionImplementation(repoRoot),
  ]);
  const withoutHash = {
    kind: "napier.sandbox-acquisition-stage20",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    implementation,
    ...live,
    retention: {
      credentialValues: false,
      rawCliOutput: false,
      rawDockerOutput: false,
      imageIds: false,
      imageReferences: false,
      resourceNames: false,
      workspacePaths: false,
      registryEndpoints: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      localAnonymousTransportAccepted: true,
      privateRegistryFallbackAccepted: true,
      publicExternalReleaseAccepted: false,
      windowsHostProductAcceptance: false,
      remaining: [
        "public signed external release",
        "Windows host product acceptance",
      ],
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export async function verifySandboxAcquisition(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoPath(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT,
  );
  const [value, implementation] = await Promise.all([
    readJson(artifactPath),
    sandboxAcquisitionImplementation(repoRoot),
  ]);
  const errors = validateSandboxAcquisitionArtifact(value, implementation);
  return {
    valid: errors.length === 0,
    errors,
    path: toRepoPath(repoRoot, artifactPath),
    sha256: sha256(await readFile(artifactPath)),
  };
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  if (args.live || args.write) {
    const artifact = await collectSandboxAcquisition(args);
    if (args.write) {
      await writeJson(path.join(defaultRepoRoot, DEFAULT_ARTIFACT), artifact);
    }
    console.log(
      `Sandbox acquisition ${args.write ? "written" : "verified live"}: ${artifact.contentSha256.slice(0, 16)}`,
    );
    return;
  }
  const result = await verifySandboxAcquisition();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Sandbox acquisition verified: ${result.path} ${result.sha256.slice(0, 16)}`,
  );
}

function parseArguments(arguments_) {
  const options = {
    live: false,
    write: false,
    contextSha256: undefined,
    privateReference: undefined,
    privateSourceSha: undefined,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--live") options.live = true;
    else if (argument === "--write") {
      options.live = true;
      options.write = true;
    } else if (
      [
        "--context-sha256",
        "--private-reference",
        "--private-source-sha",
      ].includes(argument)
    ) {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} needs a value`);
      }
      if (argument === "--context-sha256") options.contextSha256 = value;
      if (argument === "--private-reference") options.privateReference = value;
      if (argument === "--private-source-sha") options.privateSourceSha = value;
      index += 1;
    } else throw new Error("Unknown Sandbox acquisition option");
  }
  return options;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Sandbox acquisition artifact is not valid JSON");
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
