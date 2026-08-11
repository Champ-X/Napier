import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { OCI_PROCESS_RESOURCE_POLICY_SHA256 } from "../packages/runtime/dist/sandbox-container-policy.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const CASE_IDS = [
  "workspace_write_denied",
  "outside_read_denied",
  "secret_inheritance_denied",
  "private_network_denied",
  "temporary_storage_exhausted",
  "process_limit_enforced",
  "memory_limit_enforced",
  "wall_time_enforced",
  "output_limit_enforced",
  "cancellation_enforced",
  "identity_drift_rejected",
];

export async function sandboxSecurityImplementation(repoRoot) {
  const files = {
    commandExecution: "packages/runtime/src/command-execution.ts",
    processLifecycle: "packages/runtime/src/sandboxed-process.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    containerPolicy: "packages/runtime/src/sandbox-container-policy.ts",
    checkScript: "scripts/check-sandbox-security-casebook.mjs",
    artifactVerifier: "scripts/sandbox-security-casebook-artifact.mjs",
    liveHarness: "scripts/sandbox-security-casebook-live.mjs",
  };
  return {
    resourcePolicySha256: OCI_PROCESS_RESOURCE_POLICY_SHA256,
    ...Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([name, relative]) => [
          `${name}Sha256`,
          sha256(await readFile(path.join(repoRoot, relative))),
        ]),
      ),
    ),
  };
}

export function validateSandboxSecurityArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-security-casebook-stage12" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.image) ||
    value.image.id !== provenance.image?.id ||
    value.image.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    !SHA256.test(value.image.provenanceSha256) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !Array.isArray(value.cases) ||
    value.cases.length !== CASE_IDS.length ||
    value.cases.map((item) => item.id).join("\n") !== CASE_IDS.join("\n") ||
    !value.cases.every(validCase) ||
    !isRecord(value.resourceClosure) ||
    value.resourceClosure.exactBaselineRestored !== true ||
    value.resourceClosure.containerDeltaCount !== 0 ||
    value.resourceClosure.networkDeltaCount !== 0 ||
    value.resourceClosure.scratchDeltaCount !== 0 ||
    !validRetention(value.retention) ||
    !isRecord(value.scope) ||
    value.scope.sliceComplete !== true ||
    value.scope.s1Complete !== false ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox security Casebook artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox security Casebook artifact content hash is invalid");
  }
  return errors;
}

function validCase(value) {
  return (
    isRecord(value) &&
    CASE_IDS.includes(value.id) &&
    value.status === "passed" &&
    typeof value.reason === "string" &&
    /^[a-z0-9_]{3,80}$/u.test(value.reason) &&
    SHA256.test(value.evidenceSha256) &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 30_000 &&
    (value.observedCount === undefined ||
      (Number.isSafeInteger(value.observedCount) &&
        value.observedCount >= 0 &&
        value.observedCount <= 10_000)) &&
    (value.rejectedCount === undefined ||
      (Number.isSafeInteger(value.rejectedCount) &&
        value.rejectedCount >= 0 &&
        value.rejectedCount <= 10_000))
  );
}

function validRetention(value) {
  const names = [
    "canaryValues",
    "credentialValues",
    "rawCommandOutput",
    "rawDockerOutput",
    "rawDaemonEndpoint",
    "resourceNames",
    "workspacePaths",
    "outsidePaths",
    "endpointUrls",
  ];
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === names.sort().join("\n") &&
    names.every((name) => value[name] === false)
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
