import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function sandboxPortableLspImplementation(repoRoot) {
  const files = {
    sandboxTypes: "packages/runtime/src/sandbox-types.ts",
    containerLspRuntime:
      "packages/runtime/src/sandbox-container-lsp-runtime.ts",
    runtimeAssets: "packages/runtime/src/lsp-runtime-assets.ts",
    protocolPathBinding: "packages/runtime/src/lsp-protocol-path-binding.ts",
    protocolSession: "packages/runtime/src/lsp-protocol-session.ts",
    sourceSession: "packages/runtime/src/lsp-source-session.ts",
    persistentSession: "packages/runtime/src/lsp-persistent-session.ts",
    persistentBinding: "packages/runtime/src/lsp-persistent-session-binding.ts",
    locations: "packages/runtime/src/lsp-locations.ts",
    checkScript: "scripts/check-sandbox-portable-lsp.mjs",
    artifactVerifier: "scripts/sandbox-portable-lsp-artifact.mjs",
    liveHarness: "scripts/sandbox-portable-lsp-live.mjs",
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

export function validateSandboxPortableLspArtifact(
  value,
  provenance,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-portable-lsp-stage16" ||
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
    errors.push("Sandbox portable LSP artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox portable LSP artifact content hash is invalid");
  }
  return errors;
}

function validProtocol(value) {
  return (
    isRecord(value) &&
    value.protocolWorkspaceRoot === "/workspace" &&
    value.workspaceRootMapped === true &&
    value.targetUriMapped === true &&
    value.hostUriRestored === true &&
    value.escapeRejected === true &&
    value.authorityRejected === true &&
    value.queryRejected === true &&
    SHA256.test(value.bindingSha256)
  );
}

function validParity(value) {
  return (
    isRecord(value) &&
    value.hostPlatform === "darwin" &&
    value.sandbox === "oci-container" &&
    value.sameTarget === true &&
    validCapability(value.diagnostics, "clean") &&
    validCapability(value.symbols, "found") &&
    validCapability(value.definition, "found") &&
    value.allEqual === true &&
    SHA256.test(value.evidenceSha256)
  );
}

function validCapability(value, status) {
  return (
    isRecord(value) &&
    value.hostStatus === status &&
    value.portableStatus === status &&
    value.equal === true &&
    SHA256.test(value.hostResultSha256) &&
    SHA256.test(value.portableResultSha256) &&
    SHA256.test(value.projectionSha256)
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
  const names = [
    "credentialValues",
    "rawDiagnostics",
    "rawSymbols",
    "rawLocations",
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
    value.portableLspReadPlane === true &&
    value.windowsHostExecuted === false &&
    value.portableDapComplete === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes("portable DAP protocol path translation") &&
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
