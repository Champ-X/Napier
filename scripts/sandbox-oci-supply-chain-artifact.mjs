import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  ed25519KeyId,
  parseEd25519PublicKeySpki,
  sha256,
  verifyEd25519Statement,
} from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u;
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";

export async function sandboxOciSupplyChainImplementation(repoRoot) {
  const files = {
    checkScript: "scripts/check-sandbox-oci-supply-chain.mjs",
    artifactVerifier: "scripts/sandbox-oci-supply-chain-artifact.mjs",
    liveHarness: "scripts/sandbox-oci-supply-chain-live.mjs",
    layoutVerifier: "scripts/sandbox-oci-layout-verification.mjs",
    signing: "scripts/sandbox-oci-signing.mjs",
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

export function validateSandboxOciSupplyChainArtifact(
  value,
  source,
  implementation,
) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-oci-supply-chain-stage18" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    canonicalJson(value.source) !== canonicalJson(source) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validBuilder(value.builder) ||
    !validPublication(value.publication, source) ||
    !validSigning(value.signing, value.publication, source) ||
    !validAttestation(
      value.attestation,
      value.publication,
      source,
      value.builder,
    ) ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Sandbox OCI supply-chain artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox OCI supply-chain artifact content hash is invalid");
  }
  return errors;
}

function validBuilder(value) {
  const content = value && {
    driver: value.driver,
    buildxVersion: value.buildxVersion,
    buildkitVersion: value.buildkitVersion,
    supportedPlatforms: value.supportedPlatforms,
    outputType: value.outputType,
    externalRegistryPublished: value.externalRegistryPublished,
  };
  return (
    isRecord(value) &&
    ["docker", "docker-container"].includes(value.driver) &&
    VERSION.test(value.buildxVersion) &&
    VERSION.test(value.buildkitVersion) &&
    Array.isArray(value.supportedPlatforms) &&
    value.supportedPlatforms.join("\n") === PLATFORMS.join("\n") &&
    value.outputType === "oci-layout" &&
    value.externalRegistryPublished === false &&
    value.identitySha256 === sha256(canonicalJson(content))
  );
}

function validPublication(value, source) {
  if (
    !isRecord(value) ||
    value.layoutVersion !== "1.0.0" ||
    !SHA256.test(value.rootIndexSha256) ||
    !DIGEST.test(value.imageIndexDigest) ||
    !Number.isSafeInteger(value.imageIndexBytes) ||
    value.imageIndexBytes <= 0 ||
    !Array.isArray(value.platforms) ||
    value.platforms.length !== PLATFORMS.length ||
    value.platforms.map((item) => item.platform).join("\n") !==
      PLATFORMS.join("\n") ||
    !value.platforms.every((item) => validPlatform(item, source)) ||
    !Number.isSafeInteger(value.blobCount) ||
    value.blobCount < 6 ||
    !Number.isSafeInteger(value.blobBytes) ||
    value.blobBytes <= 0 ||
    value.blobBytes > 512 * 1024 * 1024 ||
    !SHA256.test(value.blobSetSha256) ||
    value.allBlobDigestsVerified !== true ||
    value.completeReachabilityClosure !== true ||
    !SHA256.test(value.evidenceSha256) ||
    value.buildStatus !== "passed" ||
    !SHA256.test(value.buildOutputSha256) ||
    !Number.isSafeInteger(value.buildOutputBytes) ||
    value.buildOutputBytes < 0 ||
    value.buildOutputBytes > 128 * 1024 ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 15 * 60 * 1_000
  ) {
    return false;
  }
  const {
    buildStatus: _buildStatus,
    buildOutputSha256: _buildOutputSha256,
    buildOutputBytes: _buildOutputBytes,
    durationMs: _durationMs,
    ...evidence
  } = value;
  return (
    value.evidenceSha256 ===
    sha256(
      canonicalJson({
        ...evidence,
        evidenceSha256: undefined,
      }),
    )
  );
}

function validPlatform(value, source) {
  return (
    isRecord(value) &&
    PLATFORMS.includes(value.platform) &&
    DIGEST.test(value.manifestDigest) &&
    Number.isSafeInteger(value.manifestBytes) &&
    value.manifestBytes > 0 &&
    DIGEST.test(value.configDigest) &&
    Number.isSafeInteger(value.layerCount) &&
    value.layerCount > 0 &&
    SHA256.test(value.layerSetSha256) &&
    value.contextSha256 === source.contextSha256
  );
}

function validSigning(value, publication, source) {
  if (
    !isRecord(value) ||
    value.algorithm !== "Ed25519" ||
    value.keyOrigin !== "ephemeral-memory" ||
    !SHA256.test(value.keyId) ||
    typeof value.publicKeySpki !== "string" ||
    !isRecord(value.statement) ||
    typeof value.signature !== "string" ||
    value.verified !== true ||
    value.privateKeyRetained !== false ||
    value.transparencyLogRecorded !== false
  ) {
    return false;
  }
  let publicKey;
  try {
    publicKey = parseEd25519PublicKeySpki(value.publicKeySpki, "OCI index");
  } catch {
    return false;
  }
  return (
    value.keyId === ed25519KeyId(value.publicKeySpki) &&
    value.statement.kind === "napier.sandbox-oci-index-signature-statement" &&
    value.statement.schemaVersion === 1 &&
    value.statement.subject?.name === "napier-sandbox" &&
    value.statement.subject?.digest === publication.imageIndexDigest &&
    canonicalJson(value.statement.source) === canonicalJson(source) &&
    value.statement.platformSetSha256 === sha256(canonicalJson(PLATFORMS)) &&
    value.statement.publicationEvidenceSha256 === publication.evidenceSha256 &&
    verifyEd25519Statement(value.statement, value.signature, publicKey)
  );
}

function validAttestation(value, publication, source, builder) {
  if (
    !isRecord(value) ||
    value.format !== "DSSE" ||
    value.statementType !== "https://in-toto.io/Statement/v1" ||
    value.predicateType !== "https://slsa.dev/provenance/v1" ||
    value.keyOrigin !== "ephemeral-memory" ||
    !SHA256.test(value.keyId) ||
    typeof value.publicKeySpki !== "string" ||
    !isRecord(value.envelope) ||
    value.envelopeSha256 !== sha256(canonicalJson(value.envelope)) ||
    value.verified !== true ||
    value.privateKeyRetained !== false ||
    value.externalAttestation !== false
  ) {
    return false;
  }
  const envelope = value.envelope;
  if (
    envelope.payloadType !== DSSE_PAYLOAD_TYPE ||
    typeof envelope.payload !== "string" ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length !== 1 ||
    envelope.signatures[0]?.keyid !== value.keyId ||
    typeof envelope.signatures[0]?.sig !== "string"
  ) {
    return false;
  }
  let payload;
  let signature;
  let publicKey;
  try {
    payload = decodeCanonicalBase64(envelope.payload);
    signature = decodeCanonicalBase64(envelope.signatures[0].sig);
    publicKey = createPublicKey({
      key: decodeCanonicalBase64(value.publicKeySpki),
      format: "der",
      type: "spki",
    });
  } catch {
    return false;
  }
  if (
    value.keyId !== ed25519KeyId(value.publicKeySpki) ||
    !verify(null, dssePae(envelope.payloadType, payload), publicKey, signature)
  ) {
    return false;
  }
  let statement;
  try {
    statement = JSON.parse(payload.toString("utf8"));
  } catch {
    return false;
  }
  return (
    payload.toString("utf8") === canonicalJson(statement) &&
    statement._type === value.statementType &&
    statement.predicateType === value.predicateType &&
    statement.subject?.length === 1 &&
    statement.subject[0]?.name === "napier-sandbox" &&
    statement.subject[0]?.digest?.sha256 ===
      publication.imageIndexDigest.slice("sha256:".length) &&
    statement.predicate?.buildDefinition?.buildType ===
      "https://napier.local/buildkit/oci-layout/v1" &&
    canonicalJson(
      statement.predicate?.buildDefinition?.externalParameters?.source,
    ) === canonicalJson(source) &&
    statement.predicate?.buildDefinition?.internalParameters
      ?.externalRegistryPublished === false &&
    statement.predicate?.runDetails?.builder?.id ===
      `napier:buildkit:${builder.identitySha256}` &&
    isIsoDate(statement.predicate?.runDetails?.metadata?.startedOn) &&
    isIsoDate(statement.predicate?.runDetails?.metadata?.finishedOn)
  );
}

function validResourceClosure(value) {
  return (
    isRecord(value) &&
    value.exactBaselineRestored === true &&
    value.containerDeltaCount === 0 &&
    value.networkDeltaCount === 0 &&
    value.imageDeltaCount === 0 &&
    value.scratchDeltaCount === 0 &&
    value.temporaryRootRemoved === true
  );
}

function validRetention(value) {
  const names = [
    "credentialValues",
    "privateKeys",
    "rawBuildOutput",
    "rawDockerOutput",
    "resourceNames",
    "workspacePaths",
    "daemonEndpoints",
    "ociLayoutBytes",
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
    value.localOciPublication === true &&
    value.localEphemeralSignature === true &&
    value.localDsseAttestation === true &&
    value.externalRegistryPublished === false &&
    value.releaseSigningIdentity === false &&
    value.transparencyLogRecorded === false &&
    value.externalAttestation === false &&
    Array.isArray(value.remaining) &&
    value.remaining.includes(
      "external multi-architecture registry publication",
    ) &&
    value.remaining.includes("release signing identity and transparency log") &&
    value.remaining.includes("external attestation") &&
    value.remaining.includes("Windows and Linux host product acceptance")
  );
}

function dssePae(payloadType, payload) {
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${Buffer.byteLength(payloadType, "utf8")} ${payloadType} ${payload.byteLength} `,
    ),
    payload,
  ]);
}

function decodeCanonicalBase64(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) ||
    value.length % 4 !== 0
  ) {
    throw new Error("Base64 evidence is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new Error("Base64 evidence is invalid");
  }
  return bytes;
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
