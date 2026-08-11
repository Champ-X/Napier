import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function sandboxProductAcceptanceImplementation(repoRoot) {
  const files = {
    setupService: "packages/runtime/src/sandbox-setup-service.ts",
    containerIdentity: "packages/runtime/src/sandbox-container-runtime.ts",
    pathMapping: "packages/runtime/src/sandbox-container-path-mapping.ts",
    launchPolicy: "packages/runtime/src/sandbox-launch-policy.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    ociLaunchArguments: "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    lspProbe: "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    verificationRuntime: "packages/runtime/src/verification-runtime.ts",
    verificationRunner: "packages/runtime/src/verification.ts",
    processManager: "packages/runtime/src/workspace-processes.ts",
    checkScript: "scripts/check-sandbox-product-acceptance.mjs",
    artifactVerifier: "scripts/sandbox-product-acceptance-artifact.mjs",
    liveHarness: "scripts/sandbox-product-acceptance-live.mjs",
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

export function validateSandboxProductAcceptanceArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-product-acceptance-stage13" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.image) ||
    value.image.id !== provenance.image?.id ||
    value.image.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    !SHA256.test(value.image.provenanceSha256) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validSetup(value.setup) ||
    !validDoctor(value.doctor) ||
    !validVerification(value.verification) ||
    !validService(value.service) ||
    !validRestart(value.restart) ||
    !validUninstall(value.uninstall) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !isRecord(value.scope) ||
    value.scope.sliceComplete !== true ||
    value.scope.s1Complete !== false ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox product acceptance artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox product acceptance artifact content hash is invalid");
  }
  return errors;
}

function validSetup(value) {
  const checks = [
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
  return (
    isRecord(value) &&
    value.previewStatus === "ready" &&
    value.previewActive === false &&
    value.applyAction === "reused" &&
    value.status === "ready" &&
    value.checkCount === checks.length &&
    Array.isArray(value.checkCodes) &&
    value.checkCodes.join("\n") === checks.join("\n") &&
    SHA256.test(value.previewSha256) &&
    SHA256.test(value.installationSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validDoctor(value) {
  return (
    isRecord(value) &&
    value.status === "degraded" &&
    value.checkCount === 14 &&
    value.passedCount === 11 &&
    value.warningCount === 0 &&
    value.skippedCount === 3 &&
    value.sandboxCode === "sandbox_ready" &&
    value.verificationCode === "verification_ready" &&
    SHA256.test(value.reportSha256)
  );
}

function validVerification(value) {
  return (
    isRecord(value) &&
    value.sandbox === "oci-container" &&
    validVerificationResult(value.typecheck, "5.9.3") &&
    validVerificationResult(value.test, "4.1.9")
  );
}

function validVerificationResult(value, version) {
  return (
    isRecord(value) &&
    value.status === "passed" &&
    value.verifierVersion === version &&
    SHA256.test(value.verifierSha256) &&
    SHA256.test(value.runtimeIdentitySha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validService(value) {
  return (
    isRecord(value) &&
    value.ready === true &&
    value.healthChecked === true &&
    value.cancelled === true &&
    value.endpointClosed === true &&
    SHA256.test(value.identitySha256) &&
    SHA256.test(value.endpointSha256)
  );
}

function validRestart(value) {
  return (
    isRecord(value) &&
    value.preRestartStatus === "running" &&
    value.reopenedStatus === "interrupted" &&
    value.unknownOutcome === true &&
    value.staleOutputExposed === false &&
    SHA256.test(value.processSha256)
  );
}

function validUninstall(value) {
  return (
    isRecord(value) &&
    value.previewStatus === "installed" &&
    value.active === true &&
    value.status === "removed" &&
    value.imageRetained === true &&
    value.bindingRemoved === true &&
    SHA256.test(value.previewSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validResourceClosure(value) {
  return (
    isRecord(value) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.scratchDeltaCount === 0
  );
}

function validRetention(value) {
  const fields = [
    "credentialValues",
    "rawCliOutput",
    "rawDoctorReport",
    "rawProcessOutput",
    "rawDockerOutput",
    "resourceNames",
    "workspacePaths",
    "dataRootPaths",
    "endpointUrls",
  ];
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === fields.sort().join("\n") &&
    fields.every((field) => value[field] === false)
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
