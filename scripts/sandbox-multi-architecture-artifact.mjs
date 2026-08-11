import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const CHECK_CODES = [
  "sandbox_process_ready",
  "sandbox_resources_ready",
  "verification_ready",
  "shell_ready",
  "python_ready",
  "git_ready",
  "lsp_ready",
  "dap_ready",
  "service_ready",
];

export async function sandboxMultiArchitectureImplementation(repoRoot) {
  const files = {
    containerIdentity: "packages/runtime/src/sandbox-container-runtime.ts",
    pathMapping: "packages/runtime/src/sandbox-container-path-mapping.ts",
    launchPolicy: "packages/runtime/src/sandbox-launch-policy.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    ociLaunchArguments: "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    lspProbe: "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    checkScript: "scripts/check-sandbox-multi-architecture.mjs",
    artifactVerifier: "scripts/sandbox-multi-architecture-artifact.mjs",
    liveHarness: "scripts/sandbox-multi-architecture-live.mjs",
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, relative]) => [
        `${name}Sha256`,
        sha256(await readFile(path.join(repoRoot, relative))),
      ]),
    ),
  );
}

export function validateSandboxMultiArchitectureArtifact(
  value,
  source,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-multi-architecture-stage14" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    canonicalJson(value.source) !== canonicalJson(source) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validBuilder(value.builder) ||
    !Array.isArray(value.platforms) ||
    value.platforms.length !== PLATFORMS.length ||
    value.platforms.map((item) => item.platform).join("\n") !==
      PLATFORMS.join("\n") ||
    !value.platforms.every(validPlatform) ||
    !validParity(value.parity, value.platforms) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox multi-architecture artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox multi-architecture artifact content hash is invalid");
  }
  return errors;
}

function validBuilder(value) {
  return (
    isRecord(value) &&
    ["docker", "docker-container"].includes(value.driver) &&
    visibleVersion(value.buildxVersion) &&
    visibleVersion(value.buildkitVersion) &&
    Array.isArray(value.supportedPlatforms) &&
    value.supportedPlatforms.join("\n") === PLATFORMS.join("\n") &&
    value.explicitPlatformBuild === true &&
    value.localLoadOnly === true &&
    value.registryPublished === false &&
    value.signed === false &&
    value.attested === false &&
    SHA256.test(value.identitySha256)
  );
}

function validPlatform(value) {
  return (
    isRecord(value) &&
    PLATFORMS.includes(value.platform) &&
    IMAGE_ID.test(value.imageId) &&
    SHA256.test(value.imageIdentitySha256) &&
    value.buildStatus === "passed" &&
    SHA256.test(value.buildOutputSha256) &&
    Number.isSafeInteger(value.buildOutputBytes) &&
    value.buildOutputBytes > 0 &&
    value.buildOutputBytes <= 64 * 1024 &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 15 * 60 * 1_000 &&
    Array.isArray(value.checkCodes) &&
    value.checkCodes.join("\n") === CHECK_CODES.join("\n") &&
    validToolchain(value.toolchain) &&
    validVerification(value.verification) &&
    SHA256.test(value.evidenceSha256)
  );
}

function validToolchain(value) {
  const names = [
    "node",
    "shellSha256",
    "python",
    "pythonSha256",
    "git",
    "gitSha256",
    "typescript",
    "typescriptLanguageServer",
    "vitest",
    "prettier",
    "packageJsonSha256",
    "packageLockSha256",
    "runtimeIdentitySha256",
  ];
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === names.sort().join("\n") &&
    visibleVersion(value.node) &&
    SHA256.test(value.shellSha256) &&
    visibleVersion(value.python) &&
    SHA256.test(value.pythonSha256) &&
    typeof value.git === "string" &&
    /^git version [^\u0000-\u001f\u007f]{1,160}$/u.test(value.git) &&
    SHA256.test(value.gitSha256) &&
    visibleVersion(value.typescript) &&
    visibleVersion(value.typescriptLanguageServer) &&
    visibleVersion(value.vitest) &&
    visibleVersion(value.prettier) &&
    SHA256.test(value.packageJsonSha256) &&
    SHA256.test(value.packageLockSha256) &&
    SHA256.test(value.runtimeIdentitySha256)
  );
}

function validVerification(value) {
  return (
    isRecord(value) &&
    value.typecheckStatus === "passed" &&
    value.testStatus === "passed" &&
    value.typecheckVersion === "5.9.3" &&
    value.testVersion === "4.1.9" &&
    SHA256.test(value.typecheckResultSha256) &&
    SHA256.test(value.testResultSha256)
  );
}

function validParity(value, platforms) {
  return (
    isRecord(value) &&
    value.distinctImageIds === true &&
    platforms[0].imageId !== platforms[1].imageId &&
    value.toolchainVersionsEqual === true &&
    value.manifestHashesEqual === true &&
    value.allProductionChecksReady === true &&
    value.explicitPlatformLaunch === true &&
    SHA256.test(value.evidenceSha256)
  );
}

function validResourceClosure(value) {
  return (
    isRecord(value) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.imageDeltaCount === 0 &&
    value.scratchDeltaCount === 0 &&
    value.temporaryTagDeltaCount === 0
  );
}

function validRetention(value) {
  const names = [
    "credentialValues",
    "rawBuildOutput",
    "rawDockerOutput",
    "resourceNames",
    "temporaryTags",
    "workspacePaths",
    "daemonEndpoints",
  ];
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === names.sort().join("\n") &&
    names.every((name) => value[name] === false)
  );
}

function validScope(value) {
  return (
    isRecord(value) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    value.localBuildAndExecution === true &&
    value.registryPublication === false &&
    value.signature === false &&
    value.crossHostAcceptance === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes("multi-architecture registry publication") &&
    value.remaining.includes("image signature and external attestation") &&
    value.remaining.includes("Windows and Linux host product acceptance")
  );
}

function visibleVersion(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(value)
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
