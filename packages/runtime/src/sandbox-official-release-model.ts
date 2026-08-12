import { canonicalJson, sha256 } from "./ed25519.js";

export const OFFICIAL_SANDBOX_RELEASE_IMAGE =
  "ghcr.io/champ-x/napier-sandbox";
export const OFFICIAL_SANDBOX_RELEASE_PLATFORMS = [
  "linux/amd64",
  "linux/arm64",
] as const;

const WORKFLOW = ".github/workflows/publish-sandbox.yml";
const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const RECEIPT_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "repository",
  "workflow",
  "workflowRunId",
  "workflowRunAttempt",
  "sourceSha",
  "image",
  "version",
  "digest",
  "platforms",
  "contextSha256",
  "remoteIndex",
  "buildkitAttestations",
  "anonymousPullAndExecution",
  "anonymousPlatforms",
  "cosign",
  "externalAttestation",
  "retention",
  "scope",
  "contentSha256",
];

export interface OfficialSandboxRelease {
  image: typeof OFFICIAL_SANDBOX_RELEASE_IMAGE;
  version: "0.1.0";
  digest: string;
  reference: string;
  sourceSha: string;
  contextSha256: string;
  receiptSha256: string;
  platforms: readonly ["linux/amd64", "linux/arm64"];
}

export function validateOfficialSandboxRelease(
  value: unknown,
  expectedContextSha256: string,
  receiptSha256: string,
): OfficialSandboxRelease {
  if (
    !record(value) ||
    !exactKeys(value, RECEIPT_KEYS) ||
    !validReleaseMetadata(value, expectedContextSha256, receiptSha256) ||
    !validReleaseEvidence(value) ||
    !validReleaseRetention(value.retention) ||
    !validReleaseScope(value.scope)
  ) {
    throw new Error("Official Sandbox release receipt is invalid");
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error("Official Sandbox release receipt hash mismatch");
  }
  const digest = String(value.digest);
  return {
    image: OFFICIAL_SANDBOX_RELEASE_IMAGE,
    version: "0.1.0",
    digest,
    reference: `${OFFICIAL_SANDBOX_RELEASE_IMAGE}@${digest}`,
    sourceSha: String(value.sourceSha),
    contextSha256: expectedContextSha256,
    receiptSha256,
    platforms: OFFICIAL_SANDBOX_RELEASE_PLATFORMS,
  };
}

function validReleaseMetadata(
  value: Record<string, unknown>,
  expectedContextSha256: string,
  receiptSha256: string,
): boolean {
  return (
    value.kind === "napier.sandbox-external-publication" &&
    value.schemaVersion === 1 &&
    isoDate(value.generatedAt) &&
    value.repository === "Champ-X/Napier" &&
    value.workflow === WORKFLOW &&
    positiveDecimal(value.workflowRunId) &&
    positiveDecimal(value.workflowRunAttempt) &&
    SOURCE_SHA.test(String(value.sourceSha ?? "")) &&
    value.image === OFFICIAL_SANDBOX_RELEASE_IMAGE &&
    value.version === "0.1.0" &&
    DIGEST.test(String(value.digest ?? "")) &&
    arrayText(value.platforms) ===
      OFFICIAL_SANDBOX_RELEASE_PLATFORMS.join("\n") &&
    value.contextSha256 === expectedContextSha256 &&
    SHA256.test(expectedContextSha256) &&
    SHA256.test(receiptSha256) &&
    SHA256.test(String(value.contentSha256 ?? ""))
  );
}

function validReleaseEvidence(value: Record<string, unknown>): boolean {
  return (
    value.anonymousPullAndExecution === true &&
    hashCountEvidence(value.remoteIndex, [
      "sha256",
      "byteCount",
      "attestationDescriptorCount",
    ]) &&
    buildkitEvidence(value.buildkitAttestations) &&
    hashCountEvidence(value.anonymousPlatforms, [
      "sha256",
      "platformCount",
    ]) &&
    cosignEvidence(value.cosign) &&
    attestationEvidence(value.externalAttestation)
  );
}

function buildkitEvidence(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "sha256",
      "predicateCount",
      "sbomPredicateVerified",
      "provenancePredicateVerified",
    ]) &&
    SHA256.test(String(value.sha256 ?? "")) &&
    positiveInteger(value.predicateCount) &&
    value.sbomPredicateVerified === true &&
    value.provenancePredicateVerified === true
  );
}

function cosignEvidence(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "algorithm",
      "verified",
      "transparencyLogVerified",
      "bundleSha256",
      "verificationSha256",
      "transparencyEntryCount",
    ]) &&
    value.algorithm === "keyless-oidc" &&
    value.verified === true &&
    value.transparencyLogVerified === true &&
    SHA256.test(String(value.bundleSha256 ?? "")) &&
    SHA256.test(String(value.verificationSha256 ?? "")) &&
    positiveInteger(value.transparencyEntryCount)
  );
}

function attestationEvidence(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "predicateType",
      "verified",
      "registryStored",
      "transparencyLogVerified",
      "predicateSha256",
      "bundleSha256",
      "verificationSha256",
      "verificationCount",
      "transparencyEntryCount",
    ]) &&
    value.predicateType === "https://slsa.dev/provenance/v1" &&
    value.verified === true &&
    value.registryStored === true &&
    value.transparencyLogVerified === true &&
    SHA256.test(String(value.predicateSha256 ?? "")) &&
    SHA256.test(String(value.bundleSha256 ?? "")) &&
    SHA256.test(String(value.verificationSha256 ?? "")) &&
    positiveInteger(value.verificationCount) &&
    positiveInteger(value.transparencyEntryCount)
  );
}

function hashCountEvidence(value: unknown, keys: string[]): boolean {
  return (
    record(value) &&
    exactKeys(value, keys) &&
    SHA256.test(String(value.sha256 ?? "")) &&
    keys
      .filter((key) => key !== "sha256")
      .every((key) => positiveInteger(value[key]))
  );
}

function validReleaseRetention(value: unknown): boolean {
  return falseFields(value, [
    "credentialValues",
    "rawWorkflowLog",
    "rawDockerOutput",
    "imageBytes",
    "workspacePaths",
  ]);
}

function validReleaseScope(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "externalRegistryPublished",
      "releaseSigningIdentity",
      "transparencyLogRecorded",
      "externalAttestation",
      "windowsHostProductAcceptance",
      "s1Complete",
    ]) &&
    value.externalRegistryPublished === true &&
    value.releaseSigningIdentity === true &&
    value.transparencyLogRecorded === true &&
    value.externalAttestation === true &&
    value.windowsHostProductAcceptance === false &&
    value.s1Complete === false
  );
}

function falseFields(value: unknown, keys: string[]): boolean {
  return (
    record(value) &&
    exactKeys(value, keys) &&
    keys.every((key) => value[key] === false)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n")
  );
}

function isoDate(value: unknown): boolean {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function positiveDecimal(value: unknown): boolean {
  return /^[1-9][0-9]*$/u.test(String(value ?? ""));
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function arrayText(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : "";
}
