import { createHash } from "node:crypto";

export const EXTERNAL_PUBLICATION_IMAGE = "ghcr.io/champ-x/napier-sandbox";
export const EXTERNAL_PUBLICATION_PLATFORMS = ["linux/amd64", "linux/arm64"];
export const EXTERNAL_PUBLICATION_PREDICATE_TYPE =
  "https://slsa.dev/provenance/v1";
export const EXTERNAL_PUBLICATION_WORKFLOW =
  ".github/workflows/publish-sandbox.yml";

const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;

export function externalPublicationInput(environment) {
  const value = {
    repository: environment.GITHUB_REPOSITORY,
    workflowRunId: environment.GITHUB_RUN_ID,
    workflowRunAttempt: environment.GITHUB_RUN_ATTEMPT,
    sourceSha: environment.GITHUB_SHA,
    image: environment.IMAGE_NAME,
    version: environment.VERSION,
    digest: environment.DIGEST,
    contextSha256: environment.CONTEXT_SHA256,
  };
  if (
    value.repository !== "Champ-X/Napier" ||
    value.image !== EXTERNAL_PUBLICATION_IMAGE ||
    !/^[1-9][0-9]*$/u.test(value.workflowRunId ?? "") ||
    !/^[1-9][0-9]*$/u.test(value.workflowRunAttempt ?? "") ||
    !SOURCE_SHA.test(value.sourceSha ?? "") ||
    value.version !== "0.1.0" ||
    !DIGEST.test(value.digest ?? "") ||
    !SHA256.test(value.contextSha256 ?? "")
  ) {
    throw new Error("external publication workflow identity is invalid");
  }
  return value;
}

export function validateExternalPublicationReceipt(value) {
  const errors = [];
  if (
    !isRecord(value) ||
    value.kind !== "napier.sandbox-external-publication" ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.generatedAt) ||
    value.repository !== "Champ-X/Napier" ||
    value.workflow !== EXTERNAL_PUBLICATION_WORKFLOW ||
    !/^[1-9][0-9]*$/u.test(value.workflowRunId) ||
    !/^[1-9][0-9]*$/u.test(value.workflowRunAttempt) ||
    !SOURCE_SHA.test(value.sourceSha) ||
    value.image !== EXTERNAL_PUBLICATION_IMAGE ||
    value.version !== "0.1.0" ||
    !DIGEST.test(value.digest) ||
    value.platforms?.join("\n") !== EXTERNAL_PUBLICATION_PLATFORMS.join("\n") ||
    !SHA256.test(value.contextSha256) ||
    !validBuildkitAttestations(value.buildkitAttestations) ||
    value.anonymousPullAndExecution !== true ||
    !validHashEvidence(value.remoteIndex, [
      "sha256",
      "byteCount",
      "attestationDescriptorCount",
    ]) ||
    !validHashEvidence(value.anonymousPlatforms, ["sha256", "platformCount"]) ||
    !validCosign(value.cosign) ||
    !validExternalAttestation(value.externalAttestation) ||
    !validFalseRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("external publication receipt shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("external publication receipt content hash is invalid");
  }
  return errors;
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validBuildkitAttestations(value) {
  return (
    isRecord(value) &&
    SHA256.test(value.sha256) &&
    Number.isSafeInteger(value.predicateCount) &&
    value.predicateCount >= 2 &&
    value.sbomPredicateVerified === true &&
    value.provenancePredicateVerified === true
  );
}

function validHashEvidence(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n") &&
    SHA256.test(value.sha256) &&
    keys
      .filter((key) => key !== "sha256")
      .every((key) => Number.isSafeInteger(value[key]) && value[key] > 0)
  );
}

function validCosign(value) {
  return (
    isRecord(value) &&
    value.algorithm === "keyless-oidc" &&
    value.verified === true &&
    value.transparencyLogVerified === true &&
    SHA256.test(value.bundleSha256) &&
    SHA256.test(value.verificationSha256) &&
    Number.isSafeInteger(value.transparencyEntryCount) &&
    value.transparencyEntryCount > 0
  );
}

function validExternalAttestation(value) {
  return (
    isRecord(value) &&
    value.predicateType === EXTERNAL_PUBLICATION_PREDICATE_TYPE &&
    value.verified === true &&
    value.registryStored === true &&
    value.transparencyLogVerified === true &&
    SHA256.test(value.predicateSha256) &&
    SHA256.test(value.bundleSha256) &&
    SHA256.test(value.verificationSha256) &&
    Number.isSafeInteger(value.verificationCount) &&
    value.verificationCount > 0 &&
    Number.isSafeInteger(value.transparencyEntryCount) &&
    value.transparencyEntryCount > 0
  );
}

function validFalseRetention(value) {
  const fields = [
    "credentialValues",
    "rawWorkflowLog",
    "rawDockerOutput",
    "imageBytes",
    "workspacePaths",
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
    value.externalRegistryPublished === true &&
    value.releaseSigningIdentity === true &&
    value.transparencyLogRecorded === true &&
    value.externalAttestation === true &&
    value.windowsHostProductAcceptance === false &&
    value.s1Complete === false
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
