import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { validSandboxImageRepairAcceptance } from "./sandbox-image-repair-artifact.mjs";
import { validSandboxInvalidBindingRepairAcceptance } from "./sandbox-invalid-binding-repair-artifact.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function sandboxProductAcceptanceImplementation(repoRoot) {
  const files = {
    setupService: "packages/runtime/src/sandbox-setup-service.ts",
    runtimeSetup: "packages/runtime/src/sandbox-runtime-setup.ts",
    acquisitionRuntime:
      "packages/runtime/src/sandbox-runtime-acquisition.ts",
    releaseRuntime: "packages/runtime/src/sandbox-official-release.ts",
    releaseModel:
      "packages/runtime/src/sandbox-official-release-model.ts",
    setupVerification:
      "packages/runtime/src/sandbox-setup-verification.ts",
    installation: "packages/runtime/src/sandbox-installation.ts",
    setupContract: "packages/contracts/src/sandbox-setup.ts",
    cliSetup: "apps/cli/src/sandbox-runtime-setup-cli.ts",
    webSetupViewModel: "apps/web/src/sandbox-setup-view-model.ts",
    containerIdentity: "packages/runtime/src/sandbox-container-runtime.ts",
    pathMapping: "packages/runtime/src/sandbox-container-path-mapping.ts",
    launchPolicy: "packages/runtime/src/sandbox-launch-policy.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    ociLaunchArguments: "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    lspProbe: "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    verificationRuntime: "packages/runtime/src/verification-runtime.ts",
    verificationRunner: "packages/runtime/src/verification.ts",
    processManager: "packages/runtime/src/workspace-processes.ts",
    cliRun: "apps/cli/src/cli.ts",
    cliReadiness: "apps/cli/src/cli-run-readiness.ts",
    cliPublicError: "apps/cli/src/cli-public-error.ts",
    capabilityPresets: "packages/contracts/src/agent-capabilities.ts",
    agentRuntime: "packages/runtime/src/agent-runtime.ts",
    agentCapabilityRuntime: "packages/runtime/src/agent-capability-runtime.ts",
    processRunReadiness: "packages/runtime/src/process-run-readiness.ts",
    serverRunReadiness: "apps/server/src/thread-run-readiness.ts",
    webComposerMode: "apps/web/src/composer-mode-view-model.ts",
    webComposerControl: "apps/web/src/ComposerCapabilityControl.tsx",
    webSandboxSetupCard: "apps/web/src/SandboxSetupCard.tsx",
    checkScript: "scripts/check-sandbox-product-acceptance.mjs",
    artifactVerifier: "scripts/sandbox-product-acceptance-artifact.mjs",
    liveHarness: "scripts/sandbox-product-acceptance-live.mjs",
    firstUseHarness: "scripts/sandbox-first-use-coding-acceptance.mjs",
    firstUseSupport: "scripts/sandbox-first-use-coding-support.mjs",
    invalidBindingRepairHarness:
      "scripts/sandbox-invalid-binding-repair-acceptance.mjs",
    invalidBindingRepairVerifier:
      "scripts/sandbox-invalid-binding-repair-artifact.mjs",
    imageRepairHarness: "scripts/sandbox-image-repair-acceptance.mjs",
    imageRepairVerifier: "scripts/sandbox-image-repair-artifact.mjs",
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
    value.schemaVersion !== 5 ||
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
    !validFirstUse(value.firstUse) ||
    !validSandboxInvalidBindingRepairAcceptance(value.invalidBindingRepair) ||
    !validSandboxImageRepairAcceptance(value.imageRepair) ||
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
    value.checkCount === 15 &&
    value.passedCount === 11 &&
    value.warningCount === 1 &&
    value.skippedCount === 3 &&
    validBrowserUseLocalCode(value.browserUseLocalCode) &&
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

export function validSandboxFirstUseCodingAcceptance(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "freshWorkspace",
      "freshDataRoot",
      "workspaceFixtureSha256",
      "setup",
      "profile",
      "run",
      "doctor",
      "uninstall",
      "resourceClosure",
      "taskRootRemoved",
    ]) &&
    value.freshWorkspace === true &&
    value.freshDataRoot === true &&
    SHA256.test(value.workspaceFixtureSha256) &&
    validFirstUseSetup(value.setup) &&
    validFirstUseProfile(value.profile) &&
    validFirstUseRun(value.run) &&
    validFirstUseDoctor(value.doctor) &&
    validFirstUseUninstall(value.uninstall) &&
    validFirstUseResourceClosure(value.resourceClosure) &&
    value.taskRootRemoved === true
  );
}

function validFirstUse(value) {
  return validSandboxFirstUseCodingAcceptance(value);
}

function validFirstUseSetup(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "previewStatus",
      "previewActive",
      "previewSha256",
      "applyAction",
      "status",
      "checkCount",
      "checkCodes",
      "installationSha256",
      "resultSha256",
    ]) &&
    validSetup(value)
  );
}

function validFirstUseProfile(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "agentRevision",
      "profileSha256Before",
      "profileSha256After",
      "revisionSetSha256Before",
      "revisionSetSha256After",
      "revisionCountBefore",
      "revisionCountAfter",
      "credentialCountBefore",
      "credentialCountAfter",
      "persistedToolPolicy",
      "persistedProcessExecution",
      "projectionSha256",
    ]) &&
    value.agentRevision === 1 &&
    value.profileSha256Before === value.profileSha256After &&
    value.revisionSetSha256Before === value.revisionSetSha256After &&
    value.revisionCountBefore === 1 &&
    value.revisionCountAfter === 1 &&
    value.credentialCountBefore === 0 &&
    value.credentialCountAfter === 0 &&
    value.persistedToolPolicy === "observe" &&
    value.persistedProcessExecution === false &&
    SHA256.test(value.profileSha256Before) &&
    SHA256.test(value.revisionSetSha256Before) &&
    SHA256.test(value.projectionSha256)
  );
}

function validFirstUseRun(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "status",
      "source",
      "model",
      "capabilityPreset",
      "agentRevision",
      "toolPolicy",
      "workspaceWrite",
      "processExecution",
      "configurationSha256",
      "promptSha256",
      "frameCount",
      "stdoutBytes",
      "stdoutSha256",
      "threadIdSha256",
      "runIdSha256",
    ]) &&
    value.status === "completed" &&
    value.source === "user" &&
    value.model === "napier/demo" &&
    value.capabilityPreset === "coding" &&
    value.agentRevision === 1 &&
    value.toolPolicy === "workspace" &&
    value.workspaceWrite === true &&
    value.processExecution === true &&
    Number.isSafeInteger(value.frameCount) &&
    value.frameCount >= 3 &&
    Number.isSafeInteger(value.stdoutBytes) &&
    value.stdoutBytes > 0 &&
    value.stdoutBytes <= 4 * 1024 * 1024 &&
    [
      "configurationSha256",
      "promptSha256",
      "stdoutSha256",
      "threadIdSha256",
      "runIdSha256",
    ].every((field) => SHA256.test(value[field]))
  );
}

function validFirstUseDoctor(value) {
  const codes = {
    skillsCode: "skills_empty",
    sandboxCode: "sandbox_ready",
    shellCode: "shell_ready",
    pythonCode: "python_ready",
    lspCode: "lsp_ready",
    dapCode: "dap_ready",
    verificationCode: "verification_ready",
    serviceCode: "service_ready",
  };
  return (
    isRecord(value) &&
    exactKeys(value, [
      "status",
      "checkCount",
      "passedCount",
      "warningCount",
      "failedCount",
      "skippedCount",
      "browserUseLocalCode",
      ...Object.keys(codes),
      "reportSha256",
    ]) &&
    value.status === "degraded" &&
    value.checkCount === 15 &&
    value.passedCount === 11 &&
    value.warningCount === 1 &&
    value.failedCount === 0 &&
    value.skippedCount === 3 &&
    validBrowserUseLocalCode(value.browserUseLocalCode) &&
    Object.entries(codes).every(([field, code]) => value[field] === code) &&
    SHA256.test(value.reportSha256)
  );
}

function validFirstUseUninstall(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "previewStatus",
      "active",
      "previewSha256",
      "status",
      "imageRetained",
      "bindingRemoved",
      "finalStatus",
      "resultSha256",
    ]) &&
    validUninstall(value) &&
    value.finalStatus === "not_installed"
  );
}

function validFirstUseResourceClosure(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "exactBaselineRestored",
      "containerDeltaCount",
      "networkDeltaCount",
      "scratchDeltaCount",
    ]) &&
    validResourceClosure(value)
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

function validBrowserUseLocalCode(value) {
  return [
    "browser_use_local_missing",
    "browser_use_local_unsupported",
  ].includes(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
  return Object.keys(value).sort().join("\n") === [...fields].sort().join("\n");
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
