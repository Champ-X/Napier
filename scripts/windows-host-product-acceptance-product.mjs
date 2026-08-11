const SHA256 = /^[a-f0-9]{64}$/u;

export function validWindowsProductAcceptance(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "imagePlatform",
      "imageProvenanceSha256",
      "setup",
      "doctor",
      "verification",
      "service",
      "restart",
      "uninstall",
      "resourceClosure",
      "contentSha256",
    ]) &&
    value.imagePlatform === "linux/amd64" &&
    SHA256.test(value.imageProvenanceSha256) &&
    validSetup(value.setup) &&
    validDoctor(value.doctor) &&
    validVerification(value.verification) &&
    validService(value.service) &&
    validRestart(value.restart) &&
    validUninstall(value.uninstall) &&
    validResourceClosure(value.resourceClosure) &&
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
    record(value) &&
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
    value.previewStatus === "ready" &&
    value.previewActive === false &&
    value.applyAction === "reused" &&
    value.status === "ready" &&
    value.checkCount === checks.length &&
    value.checkCodes?.join("\n") === checks.join("\n") &&
    SHA256.test(value.previewSha256) &&
    SHA256.test(value.installationSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validDoctor(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "checkCount",
      "passedCount",
      "warningCount",
      "skippedCount",
      "sandboxCode",
      "verificationCode",
      "reportSha256",
    ]) &&
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
    record(value) &&
    exactKeys(value, ["sandbox", "typecheck", "test"]) &&
    value.sandbox === "oci-container" &&
    validVerificationResult(value.typecheck, "5.9.3") &&
    validVerificationResult(value.test, "4.1.9")
  );
}

function validVerificationResult(value, version) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "verifierVersion",
      "verifierSha256",
      "runtimeIdentitySha256",
      "resultSha256",
    ]) &&
    value.status === "passed" &&
    value.verifierVersion === version &&
    SHA256.test(value.verifierSha256) &&
    SHA256.test(value.runtimeIdentitySha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validService(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "ready",
      "healthChecked",
      "cancelled",
      "endpointClosed",
      "identitySha256",
      "endpointSha256",
    ]) &&
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
    record(value) &&
    exactKeys(value, [
      "preRestartStatus",
      "reopenedStatus",
      "unknownOutcome",
      "staleOutputExposed",
      "processSha256",
    ]) &&
    value.preRestartStatus === "running" &&
    value.reopenedStatus === "interrupted" &&
    value.unknownOutcome === true &&
    value.staleOutputExposed === false &&
    SHA256.test(value.processSha256)
  );
}

function validUninstall(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "previewStatus",
      "active",
      "previewSha256",
      "status",
      "imageRetained",
      "bindingRemoved",
      "resultSha256",
    ]) &&
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
    record(value) &&
    exactKeys(value, [
      "exactBaselineRestored",
      "containerDeltaCount",
      "networkDeltaCount",
      "scratchDeltaCount",
    ]) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.scratchDeltaCount === 0
  );
}

function exactKeys(value, names) {
  return Object.keys(value).sort().join("\n") === [...names].sort().join("\n");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
