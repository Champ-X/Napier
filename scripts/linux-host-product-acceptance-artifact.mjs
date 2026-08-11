import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { validSandboxFirstUseCodingAcceptance } from "./sandbox-product-acceptance-artifact.mjs";
import { validSandboxInvalidBindingRepairAcceptance } from "./sandbox-invalid-binding-repair-artifact.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-.][A-Za-z0-9]+)*$/u;
const NODE_VERSION = "v24.16.0";
const PTY_VERSION = "1.2.0-beta.15";

export async function linuxHostProductAcceptanceImplementation(repoRoot) {
  const files = {
    packageLock: "package-lock.json",
    ptyPreparation: "scripts/prepare-node-pty.mjs",
    ptyPreparationTest: "scripts/prepare-node-pty.test.mjs",
    skillSnapshot: "packages/runtime/src/project-skill-snapshot.ts",
    skillSnapshotModel: "packages/runtime/src/project-skill-snapshot-model.ts",
    skillSnapshotAnchor:
      "packages/runtime/src/project-skill-snapshot-anchor.ts",
    skillSnapshotAcquisition:
      "packages/runtime/src/project-skill-snapshot-acquisition.ts",
    skillSnapshotMemory:
      "packages/runtime/src/project-skill-snapshot-memory.ts",
    sandboxTerminal: "packages/runtime/src/sandbox-terminal.ts",
    productCheck: "scripts/check-sandbox-product-acceptance.mjs",
    productArtifact: "scripts/sandbox-product-acceptance-artifact.mjs",
    productLive: "scripts/sandbox-product-acceptance-live.mjs",
    firstUseHarness: "scripts/sandbox-first-use-coding-acceptance.mjs",
    firstUseSupport: "scripts/sandbox-first-use-coding-support.mjs",
    invalidBindingRepairHarness:
      "scripts/sandbox-invalid-binding-repair-acceptance.mjs",
    invalidBindingRepairVerifier:
      "scripts/sandbox-invalid-binding-repair-artifact.mjs",
    guestHarness: "scripts/linux-host-product-acceptance-guest.mjs",
    liveHarness: "scripts/linux-host-product-acceptance-live.mjs",
    checkScript: "scripts/check-linux-host-product-acceptance.mjs",
    artifactVerifier: "scripts/linux-host-product-acceptance-artifact.mjs",
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

export function validateLinuxHostProductAcceptanceArtifact(
  value,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.linux-host-product-acceptance-stage19" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    value.backend !== "colima" ||
    value.hostType !== "linux-vm" ||
    value.nodeBootstrapVersion !== NODE_VERSION ||
    !SHA256.test(value.sourceArchiveSha256) ||
    !Number.isSafeInteger(value.sourceFileCount) ||
    value.sourceFileCount < 1_000 ||
    !validGuest(value.guest, implementation) ||
    !validOrchestration(value.orchestration) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Linux host product acceptance artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push(
      "Linux host product acceptance artifact content hash is invalid",
    );
  }
  return errors;
}

function validGuest(value, implementation) {
  if (
    !isRecord(value) ||
    !validHost(value.host) ||
    !validSource(value.source, implementation) ||
    !validCommand(value.install) ||
    !validPty(value.pty) ||
    !validCommand(value.build) ||
    !validProduct(value.product) ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 20 * 60 * 1_000 ||
    !SHA256.test(value.evidenceSha256)
  ) {
    return false;
  }
  const { evidenceSha256, ...content } = value;
  return evidenceSha256 === sha256(canonicalJson(content));
}

function validHost(value) {
  const identity = value && {
    platform: value.platform,
    arch: value.arch,
    distribution: value.distribution,
    distributionVersion: value.distributionVersion,
    initSystem: value.initSystem,
    virtualization: value.virtualization,
    virtualized: value.virtualized,
    containerized: value.containerized,
    nodeVersion: value.nodeVersion,
    npmVersion: value.npmVersion,
    dockerServerOs: value.dockerServerOs,
    dockerServerArch: value.dockerServerArch,
    dockerServerVersion: value.dockerServerVersion,
  };
  return (
    isRecord(value) &&
    value.platform === "linux" &&
    ["arm64", "x64"].includes(value.arch) &&
    typeof value.distribution === "string" &&
    value.distribution.length > 0 &&
    typeof value.distributionVersion === "string" &&
    value.distributionVersion.length > 0 &&
    value.initSystem === "systemd" &&
    typeof value.virtualization === "string" &&
    value.virtualization !== "none" &&
    value.virtualized === true &&
    value.containerized === false &&
    value.nodeVersion === NODE_VERSION &&
    VERSION.test(value.npmVersion) &&
    value.dockerServerOs === "linux" &&
    ["arm64", "amd64"].includes(value.dockerServerArch) &&
    VERSION.test(value.dockerServerVersion) &&
    value.identitySha256 === sha256(canonicalJson(identity))
  );
}

function validSource(value, implementation) {
  return (
    isRecord(value) &&
    value.cleanSourceSnapshot === true &&
    value.nodeModulesAbsentBeforeInstall === true &&
    value.distAbsentBeforeBuild === true &&
    value.packageLockSha256 === implementation.packageLockSha256 &&
    value.ptyPackage === "@lydell/node-pty" &&
    value.ptyVersion === PTY_VERSION
  );
}

function validCommand(value) {
  return (
    isRecord(value) &&
    value.status === "passed" &&
    value.exitCode === 0 &&
    Number.isSafeInteger(value.outputBytes) &&
    value.outputBytes >= 0 &&
    value.outputBytes <= 1024 * 1024 &&
    SHA256.test(value.outputSha256) &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 5 * 60 * 1_000
  );
}

function validPty(value) {
  return (
    isRecord(value) &&
    ["@lydell/node-pty-linux-arm64", "@lydell/node-pty-linux-x64"].includes(
      value.package,
    ) &&
    value.version === PTY_VERSION &&
    SHA256.test(value.nativeBinarySha256) &&
    SHA256.test(value.probeOutputSha256) &&
    value.exitCode === 0 &&
    value.passed === true
  );
}

function validProduct(value) {
  return (
    isRecord(value) &&
    ["linux/arm64", "linux/amd64"].includes(value.imagePlatform) &&
    SHA256.test(value.imageProvenanceSha256) &&
    validSetup(value.setup) &&
    validDoctor(value.doctor) &&
    validVerification(value.verification) &&
    validSandboxFirstUseCodingAcceptance(value.firstUse) &&
    validSandboxInvalidBindingRepairAcceptance(value.invalidBindingRepair) &&
    isRecord(value.service) &&
    value.service.ready === true &&
    value.service.healthChecked === true &&
    value.service.cancelled === true &&
    value.service.endpointClosed === true &&
    SHA256.test(value.service.identitySha256) &&
    SHA256.test(value.service.endpointSha256) &&
    isRecord(value.restart) &&
    value.restart.preRestartStatus === "running" &&
    value.restart.reopenedStatus === "interrupted" &&
    value.restart.unknownOutcome === true &&
    value.restart.staleOutputExposed === false &&
    SHA256.test(value.restart.processSha256) &&
    isRecord(value.uninstall) &&
    value.uninstall.status === "removed" &&
    value.uninstall.active === true &&
    value.uninstall.imageRetained === true &&
    value.uninstall.bindingRemoved === true &&
    validProductResourceClosure(value.resourceClosure) &&
    SHA256.test(value.contentSha256)
  );
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

function validProductResourceClosure(value) {
  return (
    isRecord(value) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.scratchDeltaCount === 0
  );
}

function validOrchestration(value) {
  return (
    isRecord(value) &&
    value.status === "passed" &&
    value.exitCode === 0 &&
    SHA256.test(value.stdoutSha256) &&
    Number.isSafeInteger(value.stdoutBytes) &&
    value.stdoutBytes > 0 &&
    value.stdoutBytes <= 256 * 1024 &&
    SHA256.test(value.stderrSha256) &&
    Number.isSafeInteger(value.stderrBytes) &&
    value.stderrBytes >= 0 &&
    value.stderrBytes <= 256 * 1024 &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 20 * 60 * 1_000
  );
}

function validResourceClosure(value) {
  return (
    isRecord(value) &&
    value.hostArchiveRemoved === true &&
    value.guestTemporaryRootRemoved === true &&
    value.productResourceBaselineRestored === true
  );
}

function validRetention(value) {
  const fields = [
    "credentialValues",
    "rawCommandOutput",
    "rawDockerOutput",
    "rawDoctorReport",
    "resourceNames",
    "workspacePaths",
    "guestPaths",
    "endpointUrls",
    "nodeArchiveBytes",
    "sourceArchiveBytes",
  ];
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === fields.sort().join("\n") &&
    fields.every((field) => value[field] === false)
  );
}

function validScope(value) {
  return (
    isRecord(value) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    value.freshLinuxInstall === true &&
    value.linuxHostProductAcceptance === true &&
    value.windowsHostProductAcceptance === false &&
    value.externalRegistryPublished === false &&
    value.releaseSigningIdentity === false &&
    value.externalAttestation === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes(
      "external multi-architecture registry publication",
    ) &&
    value.remaining.includes("release signing identity and transparency log") &&
    value.remaining.includes("external attestation") &&
    value.remaining.includes("Windows host product acceptance")
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
