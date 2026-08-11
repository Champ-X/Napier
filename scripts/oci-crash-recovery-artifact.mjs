import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { OCI_PROCESS_RESOURCE_POLICY_SHA256 } from "../packages/runtime/dist/sandbox-container-policy.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_CYCLE_DURATION_MS = 35_000;

export async function ociCrashRecoveryImplementation(repoRoot) {
  const files = {
    guardianContract: "packages/runtime/src/process-guardian.ts",
    guardianWorker: "packages/runtime/src/process-guardian-worker-source.ts",
    containerIdentity: "packages/runtime/src/sandbox-container-runtime.ts",
    ociAdapter: "packages/runtime/src/sandbox-oci.ts",
    ociLaunchArguments: "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    checkScript: "scripts/check-oci-crash-recovery.mjs",
    artifactVerifier: "scripts/oci-crash-recovery-artifact.mjs",
    liveHarness: "scripts/oci-crash-recovery-live.mjs",
    childFixture: "scripts/oci-crash-recovery-fixture.mjs",
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

export function validateOciCrashRecoveryArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.oci-crash-recovery-stage11" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.image) ||
    value.image.id !== provenance.image?.id ||
    value.image.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    !SHA256.test(value.image.provenanceSha256) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !Array.isArray(value.cycles) ||
    value.cycles.length !== 2 ||
    !value.cycles.every(validCycle) ||
    !isRecord(value.recovery) ||
    value.recovery.cycleCount !== 2 ||
    value.recovery.freshRuntimeSecondCycle !== true ||
    value.recovery.differentEndpointIdentity !== true ||
    value.recovery.exactBaselineRestoredAfterEachCycle !== true ||
    value.cycles[0].endpointSha256 === value.cycles[1].endpointSha256 ||
    !isRecord(value.failureRecovery) ||
    value.failureRecovery.cleanupFailureExitCode !== 75 ||
    value.failureRecovery.driftedScratchRetained !== true ||
    value.failureRecovery.matchingScratchRemovedWhenDockerCleanupFails !==
      true ||
    !validRetention(value.retention) ||
    !isRecord(value.scope) ||
    value.scope.sliceComplete !== true ||
    value.scope.s1Complete !== false ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("OCI crash recovery artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("OCI crash recovery artifact content hash is invalid");
  }
  return errors;
}

function validCycle(value) {
  return (
    isRecord(value) &&
    (value.index === 1 || value.index === 2) &&
    value.runtimeSignal === "SIGKILL" &&
    value.serviceReady === true &&
    SHA256.test(value.serviceIdentitySha256) &&
    SHA256.test(value.endpointSha256) &&
    value.containerDeltaCount === 1 &&
    value.networkDeltaCount === 1 &&
    value.scratchDeltaCount === 1 &&
    value.containerCleanupVerified === true &&
    value.networkCleanupVerified === true &&
    value.scratchCleanupVerified === true &&
    value.endpointClosedVerified === true &&
    value.exactBaselineRestored === true &&
    Number.isSafeInteger(value.cleanupDurationMs) &&
    value.cleanupDurationMs >= 0 &&
    value.cleanupDurationMs <= MAX_CYCLE_DURATION_MS
  );
}

function validRetention(value) {
  const names = [
    "credentialValues",
    "rawDockerOutput",
    "rawChildOutput",
    "rawDaemonEndpoint",
    "resourceNames",
    "endpointUrls",
    "workspacePaths",
    "scratchPaths",
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
