import { createPublicKey } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type AgentProfile,
  type AgentProfileRevision,
  type ExtensionPublisherTrustAnchor,
  type PromptPackageManifest,
  type PromptPackageQualification,
  type PromptPackageVerification,
  type SignedPromptPackageEnvelope,
} from "@napier/contracts";

import {
  canonicalJson,
  decodeEd25519Signature,
  exportEd25519PublicKeySpki,
  parseEd25519PrivateKey,
  parseEd25519PublicKeySpki,
  sha256,
  signEd25519Statement,
  verifyEd25519Statement,
} from "./ed25519.js";
import { validateExtensionPublisherTrustAnchor } from "./extension-packages.js";
import { nowIso } from "./ids.js";

export const MAX_SIGNED_PROMPT_PACKAGE_BYTES = 128 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;

interface PromptPackageSignatureStatement {
  kind: "napier.prompt-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export function createPromptPackageManifest(
  profile: AgentProfile,
  revision: AgentProfileRevision,
  publisher: string,
  options: { createdAt?: string; expiresAt?: string } = {},
): PromptPackageManifest {
  if (
    revision.agentId !== profile.id ||
    revision.revision !== profile.revision ||
    revision.systemPromptSha256 !== sha256(profile.systemPrompt)
  ) {
    throw new Error("Prompt package Agent revision does not match profile");
  }
  const createdAt = options.createdAt ?? nowIso();
  if (!validTimestamp(createdAt)) {
    throw new Error("Prompt package manifest time is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(options.expiresAt, createdAt);
  const content = {
    kind: "napier.prompt-package-manifest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    publisher: normalizePublisher(publisher),
    sourceAgentId: profile.id,
    agentName: normalizeAgentName(profile.name),
    agentRevision: profile.revision,
    agentRevisionSha256: revision.contentSha256,
    systemPromptSha256: revision.systemPromptSha256,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return validatePromptPackageManifest({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function signPromptPackage(
  profile: AgentProfile,
  revision: AgentProfileRevision,
  publisher: string,
  anchorInput: ExtensionPublisherTrustAnchor,
  options: {
    expiresAt?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): SignedPromptPackageEnvelope {
  const anchor = validateExtensionPublisherTrustAnchor(anchorInput);
  if (anchor.status !== "trusted") {
    throw new Error(`Prompt package publisher key is revoked: ${anchor.id}`);
  }
  if (!anchor.signingSource) {
    throw new Error(
      `Prompt package publisher key is verify-only: ${anchor.id}`,
    );
  }
  const environment = options.environment ?? process.env;
  const privateValue = environment[anchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Prompt package signing key is unavailable: ${anchor.signingSource.variable}`,
    );
  }
  const privateKey = parseEd25519PrivateKey(
    privateValue,
    "Prompt package signing key",
  );
  if (
    exportEd25519PublicKeySpki(createPublicKey(privateKey)) !==
    anchor.publicKeySpki
  ) {
    throw new Error(
      "Prompt package signing key does not match the trust anchor",
    );
  }
  const manifest = createPromptPackageManifest(profile, revision, publisher, {
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  });
  const manifestArtifactSha256 = sha256(canonicalJson(manifest));
  const signedAt = nowIso();
  const statement = createPromptPackageSignatureStatement(
    manifest.contentSha256,
    manifestArtifactSha256,
    anchor.keyId,
    signedAt,
  );
  const signature = {
    algorithm: "Ed25519" as const,
    keyId: anchor.keyId,
    signedAt,
    manifestArtifactSha256,
    statementSha256: sha256(canonicalJson(statement)),
    value: signEd25519Statement(statement, privateKey),
  };
  const content = {
    kind: "napier.signed-prompt-package" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    manifest,
    signature,
  };
  return validateSignedPromptPackageEnvelope({
    ...content,
    contentSha256: hashSignedPromptPackageEnvelope(content),
  });
}

export function hashSignedPromptPackageEnvelope(
  input: Omit<SignedPromptPackageEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validatePromptPackageManifest(
  value: unknown,
): PromptPackageManifest {
  const manifest = assertExactRecord(
    value,
    "Prompt package manifest",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "publisher",
      "sourceAgentId",
      "agentName",
      "agentRevision",
      "agentRevisionSha256",
      "systemPromptSha256",
      "createdAt",
      "contentSha256",
    ],
    ["expiresAt"],
  ) as unknown as PromptPackageManifest;
  if (
    manifest.kind !== "napier.prompt-package-manifest" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== NAPIER_API_VERSION ||
    normalizePublisher(manifest.publisher) !== manifest.publisher ||
    !RESOURCE_ID.test(manifest.sourceAgentId) ||
    normalizeAgentName(manifest.agentName) !== manifest.agentName ||
    !Number.isSafeInteger(manifest.agentRevision) ||
    manifest.agentRevision < 1 ||
    !SHA256.test(manifest.agentRevisionSha256) ||
    !SHA256.test(manifest.systemPromptSha256) ||
    !validTimestamp(manifest.createdAt) ||
    !SHA256.test(manifest.contentSha256)
  ) {
    throw new Error("Prompt package manifest header is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(
    manifest.expiresAt,
    manifest.createdAt,
  );
  const normalized: PromptPackageManifest = {
    ...structuredClone(manifest),
    ...(expiresAt ? { expiresAt } : {}),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (sha256(canonicalJson(content)) !== manifest.contentSha256) {
    throw new Error("Prompt package manifest hash mismatch");
  }
  return normalized;
}

export function validateSignedPromptPackageEnvelope(
  value: unknown,
): SignedPromptPackageEnvelope {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error("Signed Prompt package must be serializable JSON");
  }
  if (bytes > MAX_SIGNED_PROMPT_PACKAGE_BYTES) {
    throw new Error(
      `Signed Prompt package exceeds ${MAX_SIGNED_PROMPT_PACKAGE_BYTES} bytes`,
    );
  }
  const envelope = assertExactRecord(value, "Signed Prompt package", [
    "kind",
    "schemaVersion",
    "apiVersion",
    "manifest",
    "signature",
    "contentSha256",
  ]) as unknown as SignedPromptPackageEnvelope;
  if (
    envelope.kind !== "napier.signed-prompt-package" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !SHA256.test(envelope.contentSha256)
  ) {
    throw new Error("Signed Prompt package header is invalid");
  }
  const manifest = validatePromptPackageManifest(envelope.manifest);
  const signature = assertExactRecord(
    envelope.signature,
    "Prompt package signature",
    [
      "algorithm",
      "keyId",
      "signedAt",
      "manifestArtifactSha256",
      "statementSha256",
      "value",
    ],
  ) as unknown as SignedPromptPackageEnvelope["signature"];
  decodeEd25519Signature(signature.value);
  if (
    signature.algorithm !== "Ed25519" ||
    !SHA256.test(signature.keyId) ||
    !validTimestamp(signature.signedAt) ||
    signature.signedAt < manifest.createdAt ||
    (manifest.expiresAt !== undefined &&
      signature.signedAt >= manifest.expiresAt) ||
    !SHA256.test(signature.manifestArtifactSha256) ||
    !SHA256.test(signature.statementSha256)
  ) {
    throw new Error("Prompt package signature evidence is invalid");
  }
  const statement = createPromptPackageSignatureStatement(
    manifest.contentSha256,
    signature.manifestArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error("Prompt package signature statement hash mismatch");
  }
  if (sha256(canonicalJson(manifest)) !== signature.manifestArtifactSha256) {
    throw new Error("Prompt package manifest artifact hash mismatch");
  }
  const normalized: SignedPromptPackageEnvelope = {
    ...structuredClone(envelope),
    manifest,
    signature: structuredClone(signature),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashSignedPromptPackageEnvelope(content) !== normalized.contentSha256) {
    throw new Error("Signed Prompt package envelope hash mismatch");
  }
  return normalized;
}

export function verifySignedPromptPackageEnvelope(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): PromptPackageVerification {
  const verificationTime = Number.isFinite(now.getTime()) ? now : new Date();
  const verifiedAt = verificationTime.toISOString();
  try {
    const envelope = validateSignedPromptPackageEnvelope(value);
    const manifest = envelope.manifest;
    if (
      manifest.expiresAt !== undefined &&
      Date.parse(manifest.expiresAt) <= verificationTime.getTime()
    ) {
      return {
        status: "expired",
        verifiedAt,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Prompt package is expired",
      };
    }
    const anchor = anchors
      .map(validateExtensionPublisherTrustAnchor)
      .find((candidate) => candidate.keyId === envelope.signature.keyId);
    if (!anchor) {
      return {
        status: "unknown_key",
        verifiedAt,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Prompt package signer is unknown",
      };
    }
    const publicKey = parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Prompt package trust anchor",
    );
    const statement = createPromptPackageSignatureStatement(
      manifest.contentSha256,
      envelope.signature.manifestArtifactSha256,
      envelope.signature.keyId,
      envelope.signature.signedAt,
    );
    if (
      !verifyEd25519Statement(statement, envelope.signature.value, publicKey)
    ) {
      return {
        status: "invalid",
        verifiedAt,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Prompt package signature verification failed",
      };
    }
    return {
      status: anchor.status === "trusted" ? "trusted" : "revoked",
      verifiedAt,
      manifestSha256: manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      keyId: envelope.signature.keyId,
      reason:
        anchor.status === "trusted"
          ? "Prompt package is trusted"
          : "Prompt package signer is revoked",
    };
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function qualifyAgentPromptPackage(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  profile: AgentProfile | undefined,
  now = new Date(),
): PromptPackageQualification {
  const verification = verifySignedPromptPackageEnvelope(value, anchors, now);
  const qualifiedAt = verification.verifiedAt;
  if (verification.status !== "trusted") {
    return {
      status: verification.status,
      qualifiedAt,
      verificationStatus: verification.status,
      ...(verification.manifestSha256
        ? { manifestSha256: verification.manifestSha256 }
        : {}),
      ...(verification.envelopeSha256
        ? { envelopeSha256: verification.envelopeSha256 }
        : {}),
      ...(verification.keyId ? { keyId: verification.keyId } : {}),
      reason: verification.reason,
    };
  }
  const envelope = validateSignedPromptPackageEnvelope(value);
  const manifest = envelope.manifest;
  const base = {
    qualifiedAt,
    verificationStatus: verification.status,
    manifestSha256: manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    systemPromptSha256: manifest.systemPromptSha256,
    sourceAgentId: manifest.sourceAgentId,
    keyId: envelope.signature.keyId,
  };
  if (!profile) {
    return {
      ...base,
      status: "agent_missing",
      reason: "Prompt package target Agent was not found",
    };
  }
  const observedSystemPromptSha256 = sha256(profile.systemPrompt);
  if (observedSystemPromptSha256 !== manifest.systemPromptSha256) {
    return {
      ...base,
      status: "prompt_drift",
      observedSystemPromptSha256,
      observedAgentId: profile.id,
      observedAgentRevision: profile.revision,
      reason: "Agent system prompt differs from the signed Prompt package",
    };
  }
  return {
    ...base,
    status: "qualified",
    observedSystemPromptSha256,
    observedAgentId: profile.id,
    observedAgentRevision: profile.revision,
    reason: "Agent system prompt matches the signed Prompt package",
  };
}

function createPromptPackageSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): PromptPackageSignatureStatement {
  return {
    kind: "napier.prompt-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

function normalizePublisher(value: string): string {
  return visibleText(value, "Prompt package publisher", 120, true);
}

function normalizeAgentName(value: string): string {
  return visibleText(value, "Prompt package Agent name", 80, true);
}

function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!validTimestamp(value) || value <= createdAt) {
    throw new Error("Prompt package expiry is invalid");
  }
  return value;
}

function visibleText(
  value: string,
  label: string,
  maxLength: number,
  required: boolean,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (required && !normalized) throw new Error(`${label} is required`);
  if (
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f<>]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function validTimestamp(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function assertExactRecord(
  value: unknown,
  label: string,
  requiredKeys: string[],
  optionalKeys: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) {
    if (!(key in record)) throw new Error(`${label} is missing ${key}`);
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} has unsupported field`);
  }
  return record;
}
