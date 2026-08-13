const SHA256 = /^[a-f0-9]{64}$/u;
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

export function validSandboxInvalidBindingRepairAcceptance(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "legacyAgentRevision",
      "invalidBindingSha256",
      "doctor",
      "blockedRun",
      "unsafeSetup",
      "removal",
      "setup",
      "profile",
      "run",
      "resourceClosure",
      "taskRootRemoved",
    ]) &&
    value.legacyAgentRevision === 2 &&
    SHA256.test(value.invalidBindingSha256) &&
    validDoctor(value.doctor) &&
    validBlockedRun(value.blockedRun) &&
    validUnsafeSetup(value.unsafeSetup) &&
    validRemoval(value.removal, value.invalidBindingSha256) &&
    validSetup(value.setup) &&
    validProfile(value.profile) &&
    validRun(value.run) &&
    validResourceClosure(value.resourceClosure) &&
    value.taskRootRemoved === true
  );
}

function validDoctor(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "invalidCode",
      "remediationId",
      "exactUninstallGuidance",
      "invalidReportSha256",
      "repairedPassedCount",
      "repairedWarningCount",
      "repairedSkippedCount",
      "repairedBrowserUseLocalCode",
      "repairedReportSha256",
    ]) &&
    value.invalidCode === "sandbox_configured_invalid" &&
    value.remediationId === "repair_invalid_sandbox" &&
    value.exactUninstallGuidance === true &&
    value.repairedPassedCount === 11 &&
    value.repairedWarningCount === 1 &&
    value.repairedSkippedCount === 3 &&
    [
      "browser_use_local_missing",
      "browser_use_local_unsupported",
    ].includes(value.repairedBrowserUseLocalCode) &&
    SHA256.test(value.invalidReportSha256) &&
    SHA256.test(value.repairedReportSha256)
  );
}

function validBlockedRun(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "exactUninstallGuidance",
      "stateUnchanged",
      "diagnosticSha256",
    ]) &&
    value.status === "blocked" &&
    value.exactUninstallGuidance === true &&
    value.stateUnchanged === true &&
    SHA256.test(value.diagnosticSha256)
  );
}

function validUnsafeSetup(value) {
  return (
    record(value) &&
    exactKeys(value, ["blocked", "diagnosticSha256"]) &&
    value.blocked === true &&
    SHA256.test(value.diagnosticSha256)
  );
}

function validRemoval(value, invalidBindingSha256) {
  return (
    record(value) &&
    exactKeys(value, [
      "previewStatus",
      "active",
      "previewSha256",
      "bindingSha256",
      "status",
      "imageRetained",
      "resultSha256",
    ]) &&
    value.previewStatus === "invalid" &&
    value.active === false &&
    value.bindingSha256 === invalidBindingSha256 &&
    value.status === "removed" &&
    value.imageRetained === true &&
    SHA256.test(value.previewSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validSetup(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "previewStatus",
      "applyAction",
      "status",
      "checkCount",
      "checkCodes",
      "installationSha256",
      "resultSha256",
    ]) &&
    value.previewStatus === "ready" &&
    value.applyAction === "reused" &&
    value.status === "ready" &&
    value.checkCount === CHECK_CODES.length &&
    value.checkCodes?.join("\n") === CHECK_CODES.join("\n") &&
    SHA256.test(value.installationSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validProfile(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "profileSha256Before",
      "profileSha256After",
      "revisionSetSha256Before",
      "revisionSetSha256After",
      "revisionCountBefore",
      "revisionCountAfter",
      "credentialCountBefore",
      "credentialCountAfter",
    ]) &&
    value.profileSha256Before === value.profileSha256After &&
    value.revisionSetSha256Before === value.revisionSetSha256After &&
    value.revisionCountBefore === 2 &&
    value.revisionCountAfter === 2 &&
    value.credentialCountBefore === 0 &&
    value.credentialCountAfter === 0 &&
    SHA256.test(value.profileSha256Before) &&
    SHA256.test(value.revisionSetSha256Before)
  );
}

function validRun(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "capabilityPreset",
      "toolPolicy",
      "processExecution",
      "configurationSha256",
      "promptSha256",
      "runIdSha256",
      "threadIdSha256",
    ]) &&
    value.status === "completed" &&
    value.capabilityPreset === "coding" &&
    value.toolPolicy === "workspace" &&
    value.processExecution === true &&
    [
      "configurationSha256",
      "promptSha256",
      "runIdSha256",
      "threadIdSha256",
    ].every((field) => SHA256.test(value[field]))
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

function exactKeys(value, fields) {
  return Object.keys(value).sort().join("\n") === [...fields].sort().join("\n");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
