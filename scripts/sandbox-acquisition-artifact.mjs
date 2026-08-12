import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
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

export async function sandboxAcquisitionImplementation(repoRoot) {
  const files = {
    contract: "packages/contracts/src/sandbox-setup.ts",
    releaseModel:
      "packages/runtime/src/sandbox-official-release-model.ts",
    releaseRuntime: "packages/runtime/src/sandbox-official-release.ts",
    acquisitionRuntime: "packages/runtime/src/sandbox-runtime-acquisition.ts",
    runtimeSetup: "packages/runtime/src/sandbox-runtime-setup.ts",
    setupService: "packages/runtime/src/sandbox-setup-service.ts",
    setupVerification:
      "packages/runtime/src/sandbox-setup-verification.ts",
    installation: "packages/runtime/src/sandbox-installation.ts",
    cliSetup: "apps/cli/src/sandbox-runtime-setup-cli.ts",
    webSetupCard: "apps/web/src/SandboxSetupCard.tsx",
    webSetupViewModel: "apps/web/src/sandbox-setup-view-model.ts",
    copyAsset: "scripts/copy-sandbox-image.mjs",
    harness: "scripts/sandbox-acquisition-acceptance.mjs",
    support: "scripts/sandbox-acquisition-support.mjs",
    verifier: "scripts/sandbox-acquisition-artifact.mjs",
    check: "scripts/check-sandbox-acquisition.mjs",
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

export function validateSandboxAcquisitionArtifact(value, implementation) {
  const errors = [];
  if (
    !record(value) ||
    value.kind !== "napier.sandbox-acquisition-stage20" ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validLocalAnonymous(value.localAnonymous) ||
    !validPrivateFallback(value.privateFallback) ||
    !validResourceClosure(value.resourceClosure) ||
    value.taskRootRemoved !== true ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Sandbox acquisition artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox acquisition artifact content hash is invalid");
  }
  return errors;
}

function validLocalAnonymous(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "transport",
      "anonymousPull",
      "action",
      "acquisition",
      "immutableDigest",
      "sourceLabelVerified",
      "contextLabelVerified",
      "checkCount",
      "checkCodes",
      "bindingSchemaVersion",
      "installationSha256",
      "resultSha256",
      "uninstallStatus",
      "bindingRemoved",
    ]) &&
    value.transport === "loopback_registry" &&
    value.anonymousPull === true &&
    value.action === "pulled" &&
    value.acquisition === "external_release" &&
    value.immutableDigest === true &&
    value.sourceLabelVerified === true &&
    value.contextLabelVerified === true &&
    validChecks(value) &&
    value.bindingSchemaVersion === 2 &&
    SHA256.test(value.installationSha256 ?? "") &&
    SHA256.test(value.resultSha256 ?? "") &&
    value.uninstallStatus === "removed" &&
    value.bindingRemoved === true
  );
}

function validPrivateFallback(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "transport",
      "anonymousPullUnavailable",
      "action",
      "acquisition",
      "releaseProvenanceRetained",
      "checkCount",
      "checkCodes",
      "bindingSchemaVersion",
      "installationSha256",
      "resultSha256",
      "uninstallStatus",
      "bindingRemoved",
      "candidateDigest",
      "candidateSourceSha",
      "candidateContextSha256",
      "candidateSha256",
    ]) &&
    value.transport === "private_ghcr" &&
    value.anonymousPullUnavailable === true &&
    value.action === "built" &&
    value.acquisition === "packaged_source" &&
    value.releaseProvenanceRetained === false &&
    validChecks(value) &&
    value.bindingSchemaVersion === 2 &&
    SHA256.test(value.installationSha256 ?? "") &&
    SHA256.test(value.resultSha256 ?? "") &&
    value.uninstallStatus === "removed" &&
    value.bindingRemoved === true &&
    DIGEST.test(value.candidateDigest ?? "") &&
    SOURCE_SHA.test(value.candidateSourceSha ?? "") &&
    SHA256.test(value.candidateContextSha256 ?? "") &&
    SHA256.test(value.candidateSha256 ?? "") &&
    value.candidateSha256 ===
      sha256(
        canonicalJson({
          reference:
            `ghcr.io/champ-x/napier-sandbox@${value.candidateDigest}`,
          sourceSha: value.candidateSourceSha,
          contextSha256: value.candidateContextSha256,
        }),
      )
  );
}

function validChecks(value) {
  return (
    value.checkCount === CHECK_CODES.length &&
    value.checkCodes?.join("\n") === CHECK_CODES.join("\n")
  );
}

function validResourceClosure(value) {
  const counts = [
    "containerDeltaCount",
    "networkDeltaCount",
    "scratchDeltaCount",
    "imageDeltaCount",
    "imageReferenceDeltaCount",
    "allContainerDeltaCount",
    "allNetworkDeltaCount",
    "allVolumeDeltaCount",
  ];
  return (
    record(value) &&
    exactKeys(value, [
      "exactBaselineRestored",
      ...counts,
      "originalTagRestored",
    ]) &&
    value.exactBaselineRestored === true &&
    counts.every((field) => value[field] === 0) &&
    value.originalTagRestored === true
  );
}

function validRetention(value) {
  const fields = [
    "credentialValues",
    "rawCliOutput",
    "rawDockerOutput",
    "imageIds",
    "imageReferences",
    "resourceNames",
    "workspacePaths",
    "registryEndpoints",
  ];
  return (
    record(value) &&
    exactKeys(value, fields) &&
    fields.every((field) => value[field] === false)
  );
}

function validScope(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "sliceComplete",
      "s1Complete",
      "localAnonymousTransportAccepted",
      "privateRegistryFallbackAccepted",
      "publicExternalReleaseAccepted",
      "windowsHostProductAcceptance",
      "remaining",
    ]) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    value.localAnonymousTransportAccepted === true &&
    value.privateRegistryFallbackAccepted === true &&
    value.publicExternalReleaseAccepted === false &&
    value.windowsHostProductAcceptance === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes("public signed external release") &&
    value.remaining.includes("Windows host product acceptance")
  );
}

function exactKeys(value, fields) {
  return Object.keys(value).sort().join("\n") === [...fields].sort().join("\n");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
