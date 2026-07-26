import { createPublicKey } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type ExtensionPublisherTrustAnchor,
  type SignedSkillPackageEnvelope,
  type SkillPackageInstallation,
  type SkillPackageManifest,
  type SkillPackageManifestSkill,
  type SkillPackageQualification,
  type SkillPackageVerification,
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
import { loadWorkspaceSkills, type SkillCatalogFingerprint } from "./skills.js";

export const MAX_SIGNED_SKILL_PACKAGE_BYTES = 512 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;

interface SkillPackageSignatureStatement {
  kind: "napier.skill-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export async function createSkillPackageManifest(
  fingerprint: SkillCatalogFingerprint,
  publisher: string,
  options: { createdAt?: string; expiresAt?: string } = {},
): Promise<SkillPackageManifest> {
  const createdAt = options.createdAt ?? nowIso();
  if (!validTimestamp(createdAt)) {
    throw new Error("Skill package manifest time is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(options.expiresAt, createdAt);
  const normalizedFingerprint = validateSkillCatalogFingerprint(fingerprint);
  const content = {
    kind: "napier.skill-package-manifest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    publisher: normalizePublisher(publisher),
    requestedSkillNames: normalizedFingerprint.requestedSkillNames,
    loadedSkillNames: normalizedFingerprint.loadedSkillNames,
    missingSkillNames: normalizedFingerprint.missingSkillNames,
    diagnosticsSha256: normalizedFingerprint.diagnosticsSha256,
    skillCatalogSha256: normalizedFingerprint.contentSha256,
    skills: normalizedFingerprint.skills,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return validateSkillPackageManifest({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export async function signWorkspaceSkillPackage(
  workspaceRoot: string,
  publisher: string,
  anchorInput: ExtensionPublisherTrustAnchor,
  options: {
    skillNames?: string[];
    expiresAt?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<SignedSkillPackageEnvelope> {
  const anchor = validateExtensionPublisherTrustAnchor(anchorInput);
  if (anchor.status !== "trusted") {
    throw new Error(`Skill package publisher key is revoked: ${anchor.id}`);
  }
  if (!anchor.signingSource) {
    throw new Error(`Skill package publisher key is verify-only: ${anchor.id}`);
  }
  const environment = options.environment ?? process.env;
  const privateValue = environment[anchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Skill package signing key is unavailable: ${anchor.signingSource.variable}`,
    );
  }
  const privateKey = parseEd25519PrivateKey(
    privateValue,
    "Skill package signing key",
  );
  if (
    exportEd25519PublicKeySpki(createPublicKey(privateKey)) !==
    anchor.publicKeySpki
  ) {
    throw new Error(
      "Skill package signing key does not match the trust anchor",
    );
  }
  const catalog = await loadWorkspaceSkills(
    workspaceRoot,
    normalizeSkillNames(options.skillNames ?? []),
  );
  const manifest = await createSkillPackageManifest(
    catalog.fingerprint,
    publisher,
    {
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    },
  );
  const manifestArtifactSha256 = sha256(canonicalJson(manifest));
  const signedAt = nowIso();
  const statement = createSkillPackageSignatureStatement(
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
    kind: "napier.signed-skill-package" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    manifest,
    signature,
  };
  return validateSignedSkillPackageEnvelope({
    ...content,
    contentSha256: hashSignedSkillPackageEnvelope(content),
  });
}

export function hashSignedSkillPackageEnvelope(
  input: Omit<SignedSkillPackageEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateSkillPackageManifest(
  value: unknown,
): SkillPackageManifest {
  const manifest = assertExactRecord(
    value,
    "Skill package manifest",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "publisher",
      "requestedSkillNames",
      "loadedSkillNames",
      "missingSkillNames",
      "diagnosticsSha256",
      "skillCatalogSha256",
      "skills",
      "createdAt",
      "contentSha256",
    ],
    ["expiresAt"],
  ) as unknown as SkillPackageManifest;
  if (
    manifest.kind !== "napier.skill-package-manifest" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== NAPIER_API_VERSION ||
    normalizePublisher(manifest.publisher) !== manifest.publisher ||
    !validTimestamp(manifest.createdAt) ||
    !SHA256.test(manifest.diagnosticsSha256) ||
    !SHA256.test(manifest.skillCatalogSha256) ||
    !SHA256.test(manifest.contentSha256)
  ) {
    throw new Error("Skill package manifest header is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(
    manifest.expiresAt,
    manifest.createdAt,
  );
  const requestedSkillNames = normalizeSkillNames(manifest.requestedSkillNames);
  const loadedSkillNames = normalizeSkillNames(manifest.loadedSkillNames);
  const missingSkillNames = normalizeSkillNames(manifest.missingSkillNames);
  const skills = validateSkillPackageManifestSkills(manifest.skills);
  if (
    canonicalJson(skills.map((skill) => skill.name)) !==
      canonicalJson(loadedSkillNames) ||
    missingSkillNames.some((name) => loadedSkillNames.includes(name))
  ) {
    throw new Error("Skill package manifest skill names are invalid");
  }
  const normalized: SkillPackageManifest = {
    ...structuredClone(manifest),
    requestedSkillNames,
    loadedSkillNames,
    missingSkillNames,
    skills,
    ...(expiresAt ? { expiresAt } : {}),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (sha256(canonicalJson(content)) !== manifest.contentSha256) {
    throw new Error("Skill package manifest hash mismatch");
  }
  if (
    manifest.skillCatalogSha256 !== hashSkillCatalogFromManifest(normalized)
  ) {
    throw new Error("Skill package manifest catalog hash mismatch");
  }
  return normalized;
}

export function validateSignedSkillPackageEnvelope(
  value: unknown,
): SignedSkillPackageEnvelope {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error("Signed Skill package must be serializable JSON");
  }
  if (bytes > MAX_SIGNED_SKILL_PACKAGE_BYTES) {
    throw new Error(
      `Signed Skill package exceeds ${MAX_SIGNED_SKILL_PACKAGE_BYTES} bytes`,
    );
  }
  const envelope = assertExactRecord(value, "Signed Skill package", [
    "kind",
    "schemaVersion",
    "apiVersion",
    "manifest",
    "signature",
    "contentSha256",
  ]) as unknown as SignedSkillPackageEnvelope;
  if (
    envelope.kind !== "napier.signed-skill-package" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !SHA256.test(envelope.contentSha256)
  ) {
    throw new Error("Signed Skill package header is invalid");
  }
  const manifest = validateSkillPackageManifest(envelope.manifest);
  const signature = assertExactRecord(
    envelope.signature,
    "Skill package signature",
    [
      "algorithm",
      "keyId",
      "signedAt",
      "manifestArtifactSha256",
      "statementSha256",
      "value",
    ],
  ) as unknown as SignedSkillPackageEnvelope["signature"];
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
    throw new Error("Skill package signature evidence is invalid");
  }
  const statement = createSkillPackageSignatureStatement(
    manifest.contentSha256,
    signature.manifestArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error("Skill package signature statement hash mismatch");
  }
  if (sha256(canonicalJson(manifest)) !== signature.manifestArtifactSha256) {
    throw new Error("Skill package manifest artifact hash mismatch");
  }
  const normalized: SignedSkillPackageEnvelope = {
    ...structuredClone(envelope),
    manifest,
    signature: structuredClone(signature),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashSignedSkillPackageEnvelope(content) !== normalized.contentSha256) {
    throw new Error("Signed Skill package envelope hash mismatch");
  }
  return normalized;
}

export function verifySignedSkillPackageEnvelope(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): SkillPackageVerification {
  const verificationTime = Number.isFinite(now.getTime()) ? now : new Date();
  const verifiedAt = verificationTime.toISOString();
  try {
    const envelope = validateSignedSkillPackageEnvelope(value);
    const manifest = envelope.manifest;
    if (
      manifest.expiresAt !== undefined &&
      Date.parse(manifest.expiresAt) <= verificationTime.getTime()
    ) {
      return {
        status: "expired",
        verifiedAt,
        skillCount: manifest.skills.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Skill package is expired",
      };
    }
    const anchor = anchors
      .map(validateExtensionPublisherTrustAnchor)
      .find((candidate) => candidate.keyId === envelope.signature.keyId);
    if (!anchor) {
      return {
        status: "unknown_key",
        verifiedAt,
        skillCount: manifest.skills.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Skill package signer is unknown",
      };
    }
    const publicKey = parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Skill package trust anchor",
    );
    const statement = createSkillPackageSignatureStatement(
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
        skillCount: manifest.skills.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Skill package signature verification failed",
      };
    }
    return {
      status: anchor.status === "trusted" ? "trusted" : "revoked",
      verifiedAt,
      skillCount: manifest.skills.length,
      manifestSha256: manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      keyId: envelope.signature.keyId,
      reason:
        anchor.status === "trusted"
          ? "Skill package is trusted"
          : "Skill package signer is revoked",
    };
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      skillCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function qualifyWorkspaceSkillPackage(
  workspaceRoot: string,
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): Promise<SkillPackageQualification> {
  const verification = verifySignedSkillPackageEnvelope(value, anchors, now);
  const qualifiedAt = verification.verifiedAt;
  if (verification.status !== "trusted") {
    return {
      status: verification.status,
      qualifiedAt,
      verificationStatus: verification.status,
      skillCount: verification.skillCount,
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
  const envelope = validateSignedSkillPackageEnvelope(value);
  const manifest = envelope.manifest;
  const catalog = await loadWorkspaceSkills(
    workspaceRoot,
    manifest.requestedSkillNames,
  );
  const observed = catalog.fingerprint;
  const base = {
    qualifiedAt,
    verificationStatus: verification.status,
    skillCount: manifest.skills.length,
    manifestSha256: manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    skillCatalogSha256: manifest.skillCatalogSha256,
    observedSkillCatalogSha256: observed.contentSha256,
    keyId: envelope.signature.keyId,
  };
  if (observed.missingSkillNames.length > 0) {
    return {
      ...base,
      status: "missing_skill",
      reason: "Workspace Skill catalog is missing signed Skill names",
    };
  }
  if (observed.contentSha256 !== manifest.skillCatalogSha256) {
    return {
      ...base,
      status: "catalog_drift",
      reason: "Workspace Skill catalog differs from the signed Skill package",
    };
  }
  return {
    ...base,
    status: "qualified",
    reason: "Workspace Skill catalog matches the signed Skill package",
  };
}

export function hashSkillPackageInstallation(
  input: Omit<SkillPackageInstallation, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function createSkillPackageInstallation(input: {
  id: string;
  envelope: SignedSkillPackageEnvelope;
  installedByThreadId: string;
  installedAt?: string;
  replacesInstallationId?: string;
}): SkillPackageInstallation {
  const envelope = validateSignedSkillPackageEnvelope(input.envelope);
  const manifest = envelope.manifest;
  const installedAt = input.installedAt ?? nowIso();
  if (
    !RESOURCE_ID.test(input.id) ||
    !RESOURCE_ID.test(input.installedByThreadId) ||
    !validTimestamp(installedAt) ||
    (input.replacesInstallationId !== undefined &&
      !RESOURCE_ID.test(input.replacesInstallationId))
  ) {
    throw new Error("Skill package installation metadata is invalid");
  }
  const content = {
    id: input.id,
    status: "active" as const,
    publisher: manifest.publisher,
    keyId: envelope.signature.keyId,
    loadedSkillNames: manifest.loadedSkillNames,
    skillCatalogSha256: manifest.skillCatalogSha256,
    manifestSha256: manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    skillNamesSha256: sha256(canonicalJson(manifest.loadedSkillNames)),
    installedByThreadId: input.installedByThreadId,
    installedAt,
    ...(input.replacesInstallationId
      ? { replacesInstallationId: input.replacesInstallationId }
      : {}),
  };
  return validateSkillPackageInstallation({
    ...content,
    contentSha256: hashSkillPackageInstallation(content),
  });
}

export function markSkillPackageInstallationReplaced(
  installationInput: SkillPackageInstallation,
  replacedByInstallationId: string,
  replacedAt = nowIso(),
): SkillPackageInstallation {
  const installation = validateSkillPackageInstallation(installationInput);
  if (
    installation.status !== "active" ||
    !RESOURCE_ID.test(replacedByInstallationId) ||
    !validTimestamp(replacedAt)
  ) {
    throw new Error("Skill package replacement metadata is invalid");
  }
  const { contentSha256: _contentSha256, ...base } = installation;
  const content = {
    ...base,
    status: "replaced" as const,
    replacedByInstallationId,
    replacedAt,
  };
  return validateSkillPackageInstallation({
    ...content,
    contentSha256: hashSkillPackageInstallation(content),
  });
}

export function validateSkillPackageInstallation(
  value: unknown,
): SkillPackageInstallation {
  const installation = assertExactRecord(
    value,
    "Skill package installation",
    [
      "id",
      "status",
      "publisher",
      "keyId",
      "loadedSkillNames",
      "skillCatalogSha256",
      "manifestSha256",
      "envelopeSha256",
      "skillNamesSha256",
      "installedByThreadId",
      "installedAt",
      "contentSha256",
    ],
    ["replacesInstallationId", "replacedByInstallationId", "replacedAt"],
  ) as unknown as SkillPackageInstallation;
  const loadedSkillNames = normalizeSkillNames(installation.loadedSkillNames);
  const normalized: SkillPackageInstallation = {
    ...structuredClone(installation),
    loadedSkillNames,
  };
  if (
    !RESOURCE_ID.test(normalized.id) ||
    (normalized.status !== "active" && normalized.status !== "replaced") ||
    normalizePublisher(normalized.publisher) !== normalized.publisher ||
    !SHA256.test(normalized.keyId) ||
    !SHA256.test(normalized.skillCatalogSha256) ||
    !SHA256.test(normalized.manifestSha256) ||
    !SHA256.test(normalized.envelopeSha256) ||
    !SHA256.test(normalized.skillNamesSha256) ||
    normalized.skillNamesSha256 !== sha256(canonicalJson(loadedSkillNames)) ||
    !RESOURCE_ID.test(normalized.installedByThreadId) ||
    !validTimestamp(normalized.installedAt) ||
    !SHA256.test(normalized.contentSha256) ||
    (normalized.replacesInstallationId !== undefined &&
      !RESOURCE_ID.test(normalized.replacesInstallationId)) ||
    (normalized.replacedByInstallationId !== undefined &&
      !RESOURCE_ID.test(normalized.replacedByInstallationId)) ||
    (normalized.replacedAt !== undefined &&
      !validTimestamp(normalized.replacedAt)) ||
    (normalized.status === "active" &&
      (normalized.replacedByInstallationId !== undefined ||
        normalized.replacedAt !== undefined)) ||
    (normalized.status === "replaced" &&
      (!normalized.replacedByInstallationId || !normalized.replacedAt))
  ) {
    throw new Error("Skill package installation is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashSkillPackageInstallation(content) !== normalized.contentSha256) {
    throw new Error("Skill package installation hash mismatch");
  }
  return normalized;
}

function validateSkillCatalogFingerprint(
  value: SkillCatalogFingerprint,
): SkillCatalogFingerprint {
  const requestedSkillNames = normalizeSkillNames(value.requestedSkillNames);
  const loadedSkillNames = normalizeSkillNames(value.loadedSkillNames);
  const missingSkillNames = normalizeSkillNames(value.missingSkillNames);
  const skills = validateSkillPackageManifestSkills(value.skills);
  const normalized = {
    schemaVersion: 1 as const,
    requestedSkillNames,
    loadedSkillNames,
    missingSkillNames,
    diagnosticsSha256: value.diagnosticsSha256,
    skills,
  };
  if (
    value.schemaVersion !== 1 ||
    !SHA256.test(value.diagnosticsSha256) ||
    canonicalJson(skills.map((skill) => skill.name)) !==
      canonicalJson(loadedSkillNames) ||
    sha256(canonicalJson(normalized)) !== value.contentSha256
  ) {
    throw new Error("Skill catalog fingerprint is invalid");
  }
  return {
    ...normalized,
    contentSha256: value.contentSha256,
  };
}

function validateSkillPackageManifestSkills(
  value: unknown,
): SkillPackageManifestSkill[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("Skill package manifest skills are invalid");
  }
  const skills = value.map((item): SkillPackageManifestSkill => {
    const skill = assertExactRecord(item, "Skill package manifest skill", [
      "name",
      "relativePath",
      "sizeBytes",
      "contentSha256",
    ]) as unknown as SkillPackageManifestSkill;
    if (
      !SKILL_NAME.test(skill.name) ||
      typeof skill.relativePath !== "string" ||
      !skill.relativePath ||
      skill.relativePath.startsWith("/") ||
      skill.relativePath.split(/[\\/]/).includes("..") ||
      !Number.isSafeInteger(skill.sizeBytes) ||
      skill.sizeBytes < 0 ||
      skill.sizeBytes > 1024 * 1024 ||
      !SHA256.test(skill.contentSha256)
    ) {
      throw new Error("Skill package manifest skill is invalid");
    }
    return structuredClone(skill);
  });
  if (
    skills.some((skill, index) => {
      const previous = skills[index - 1];
      return previous !== undefined && previous.name >= skill.name;
    })
  ) {
    throw new Error("Skill package manifest skills are not canonical");
  }
  return skills;
}

function hashSkillCatalogFromManifest(manifest: SkillPackageManifest): string {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      requestedSkillNames: manifest.requestedSkillNames,
      loadedSkillNames: manifest.loadedSkillNames,
      missingSkillNames: manifest.missingSkillNames,
      diagnosticsSha256: manifest.diagnosticsSha256,
      skills: manifest.skills,
    }),
  );
}

function createSkillPackageSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): SkillPackageSignatureStatement {
  return {
    kind: "napier.skill-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

function normalizeSkillNames(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("Skill package skill names are invalid");
  }
  const names = [...new Set(value)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (names.some((name) => !SKILL_NAME.test(name))) {
    throw new Error("Skill package skill names are invalid");
  }
  return names;
}

function normalizePublisher(value: string): string {
  return visibleText(value, "Skill package publisher", 120, true);
}

function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!validTimestamp(value) || value <= createdAt) {
    throw new Error("Skill package expiry is invalid");
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
