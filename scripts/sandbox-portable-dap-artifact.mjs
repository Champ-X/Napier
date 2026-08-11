import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function sandboxPortableDapImplementation(repoRoot) {
  const files = {
    sandboxTypes: "packages/runtime/src/sandbox-types.ts",
    containerDebuggerRuntime:
      "packages/runtime/src/sandbox-container-node-debugger-runtime.ts",
    debuggerRuntime: "packages/runtime/src/node-debugger-runtime.ts",
    protocolPathBinding:
      "packages/runtime/src/node-debugger-protocol-path-binding.ts",
    debuggerManager: "packages/runtime/src/node-debugger.ts",
    worker: "packages/runtime/src/node-debugger-worker.ts",
    sourceMapWorker: "packages/runtime/src/node-debugger-source-map-worker.ts",
    checkScript: "scripts/check-sandbox-portable-dap.mjs",
    artifactVerifier: "scripts/sandbox-portable-dap-artifact.mjs",
    liveHarness: "scripts/sandbox-portable-dap-live.mjs",
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

export function validateSandboxPortableDapArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-portable-dap-stage17" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.image) ||
    value.image.id !== provenance.image?.id ||
    value.image.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    !SHA256.test(value.image.provenanceSha256) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validProtocol(value.protocolBinding) ||
    !validParity(value.productionParity) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox portable DAP artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox portable DAP artifact content hash is invalid");
  }
  return errors;
}

function validProtocol(value) {
  return (
    isRecord(value) &&
    value.protocolWorkspaceRoot === "/workspace" &&
    value.workspaceRootMapped === true &&
    value.sourceTargetMapped === true &&
    value.programTargetMapped === true &&
    value.relativeEvidencePaths === true &&
    value.escapeRejected === true &&
    SHA256.test(value.bindingSha256)
  );
}

function validParity(value) {
  return (
    isRecord(value) &&
    value.hostPlatform === "darwin" &&
    value.sandbox === "oci-container" &&
    value.sameTarget === true &&
    value.launchState === "paused" &&
    value.pauseReason === "breakpoint" &&
    value.breakpointExpected === true &&
    value.evaluationExpected === true &&
    value.completionExpected === true &&
    value.frameProjectionEqual === true &&
    value.evaluationProjectionEqual === true &&
    value.completionProjectionEqual === true &&
    value.allEqual === true &&
    SHA256.test(value.frameProjectionSha256) &&
    SHA256.test(value.evaluationProjectionSha256) &&
    SHA256.test(value.completionProjectionSha256) &&
    SHA256.test(value.hostResultSetSha256) &&
    SHA256.test(value.portableResultSetSha256) &&
    SHA256.test(value.evidenceSha256)
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
    "rawSource",
    "rawFrames",
    "rawEvaluation",
    "rawOutput",
    "rawDockerOutput",
    "workspacePaths",
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
    value.portableDapPlane === true &&
    value.windowsHostExecuted === false &&
    Array.isArray(value.remaining) &&
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
