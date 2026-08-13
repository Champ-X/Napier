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

export function validSandboxImageRepairAcceptance(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "preview",
      "repair",
      "uninstall",
      "resourceClosure",
      "taskRootRemoved",
    ]) &&
    validPreview(value.preview) &&
    validRepair(value.repair) &&
    validUninstall(value.uninstall) &&
    validResourceClosure(value.resourceClosure) &&
    value.taskRootRemoved === true
  );
}

function validPreview(value) {
  return (
    record(value) &&
    exactKeys(value, ["status", "staticLabelAccepted", "previewSha256"]) &&
    value.status === "ready" &&
    value.staticLabelAccepted === true &&
    SHA256.test(value.previewSha256)
  );
}

function validRepair(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "trigger",
      "action",
      "imageChanged",
      "checkCount",
      "checkCodes",
      "installationSha256",
      "resultSha256",
    ]) &&
    value.trigger === "image_toolchain_identity" &&
    value.action === "repaired" &&
    value.imageChanged === true &&
    value.checkCount === CHECK_CODES.length &&
    value.checkCodes?.join("\n") === CHECK_CODES.join("\n") &&
    SHA256.test(value.installationSha256) &&
    SHA256.test(value.resultSha256)
  );
}

function validUninstall(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "imageRetained",
      "bindingRemoved",
      "resultSha256",
    ]) &&
    value.status === "removed" &&
    value.imageRetained === true &&
    value.bindingRemoved === true &&
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
      "imageDeltaCount",
      "originalTagRestored",
    ]) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.scratchDeltaCount === 0 &&
    value.imageDeltaCount === 0 &&
    value.originalTagRestored === true
  );
}

function exactKeys(value, fields) {
  return Object.keys(value).sort().join("\n") === [...fields].sort().join("\n");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
