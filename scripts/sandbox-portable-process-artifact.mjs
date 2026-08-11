import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;

export async function sandboxPortableProcessImplementation(repoRoot) {
  const files = {
    containerIdentity: "packages/runtime/src/sandbox-container-runtime.ts",
    pathMapping: "packages/runtime/src/sandbox-container-path-mapping.ts",
    launchPolicy: "packages/runtime/src/sandbox-launch-policy.ts",
    launchArguments: "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    gitProcess: "packages/runtime/src/git-inspect-process.ts",
    verification: "packages/runtime/src/verification.ts",
    checkScript: "scripts/check-sandbox-portable-process.mjs",
    artifactVerifier: "scripts/sandbox-portable-process-artifact.mjs",
    liveHarness: "scripts/sandbox-portable-process-live.mjs",
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

export function validateSandboxPortableProcessArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-portable-process-stage15" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.image) ||
    value.image.id !== provenance.image?.id ||
    value.image.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    !SHA256.test(value.image.provenanceSha256) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validIdentity(value.portableIdentity) ||
    !validWindowsProjection(value.controlledWindowsProjection) ||
    !validDogfood(value.productionDogfood) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox portable process artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox portable process artifact content hash is invalid");
  }
  return errors;
}

function validIdentity(value) {
  return (
    isRecord(value) &&
    value.mapping === "portable-non-posix" &&
    value.nonRoot === true &&
    value.hostIdsRetained === false &&
    SHA256.test(value.userIdentitySha256) &&
    SHA256.test(value.runtimeIdentitySha256)
  );
}

function validWindowsProjection(value) {
  return (
    isRecord(value) &&
    value.workspaceMapped === true &&
    value.nestedCwdMapped === true &&
    value.verifierTargetMapped === true &&
    value.gitPrivatePathMapped === true &&
    value.runtimePathMapped === true &&
    value.imageRuntimePathsPreserved === true &&
    value.outsideDriveRejected === true &&
    value.explicitPlatformLaunch === true &&
    value.windowsHostExecuted === false &&
    SHA256.test(value.projectionSha256)
  );
}

function validDogfood(value) {
  return (
    isRecord(value) &&
    value.hostPlatform === "darwin" &&
    value.sandbox === "oci-container" &&
    validCommand(value.command) &&
    validGit(value.git) &&
    validVerification(value.verification) &&
    validWrite(value.scopedWrite)
  );
}

function validCommand(value) {
  return (
    isRecord(value) &&
    value.status === "succeeded" &&
    value.containerCwdMapped === true &&
    value.inputRead === true &&
    SHA256.test(value.resultSha256)
  );
}

function validGit(value) {
  return (
    isRecord(value) &&
    value.status === "succeeded" &&
    value.processLocalSafeDirectory === true &&
    value.wildcardSafeDirectory === false &&
    value.hostGlobalConfigChanged === false &&
    SHA256.test(value.resultSha256)
  );
}

function validVerification(value) {
  return (
    isRecord(value) &&
    value.typecheckStatus === "passed" &&
    value.testStatus === "passed" &&
    value.typecheckVersion === "5.9.3" &&
    value.testVersion === "4.1.9" &&
    SHA256.test(value.typecheckRuntimeIdentitySha256) &&
    SHA256.test(value.testRuntimeIdentitySha256) &&
    SHA256.test(value.typecheckResultSha256) &&
    SHA256.test(value.testResultSha256)
  );
}

function validWrite(value) {
  return (
    isRecord(value) &&
    value.status === "passed" &&
    value.containerUserNonRoot === true &&
    value.hostOwnershipPreserved === true &&
    value.contentVerified === true &&
    SHA256.test(value.resultSha256)
  );
}

function validResourceClosure(value) {
  return (
    isRecord(value) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.scratchDeltaCount === 0 &&
    value.temporaryRootRemoved === true
  );
}

function validRetention(value) {
  const names = [
    "credentialValues",
    "rawCommandOutput",
    "rawDockerOutput",
    "rawGitOutput",
    "workspacePaths",
    "temporaryPaths",
    "numericHostUserIds",
    "resourceNames",
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
    value.portableProcessPlane === true &&
    value.windowsHostExecuted === false &&
    value.windowsLspReadPathsComplete === true &&
    value.windowsProtocolPathsComplete === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes("portable DAP protocol path translation") &&
    value.remaining.includes("Windows and Linux host product acceptance") &&
    value.remaining.includes("multi-architecture registry publication") &&
    value.remaining.includes("image signature and external attestation")
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
