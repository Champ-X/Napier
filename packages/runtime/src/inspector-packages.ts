import { createPublicKey } from "node:crypto";

import {
  NAPIER_API_VERSION,
  NAPIER_DEFAULT_INSPECTOR_PANEL_ID,
  NAPIER_INSPECTOR_PANELS,
  type ExtensionPublisherTrustAnchor,
  type InspectorPackageManifest,
  type InspectorPackageManifestPanel,
  type InspectorPackageQualification,
  type InspectorPackageVerification,
  type SignedInspectorPackageEnvelope,
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

export const MAX_SIGNED_INSPECTOR_PACKAGE_BYTES = 128 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY = /^[a-z][a-z0-9_-]{1,60}$/;
const PANEL_IDS = new Set(NAPIER_INSPECTOR_PANELS.map((panel) => panel.id));

interface InspectorPackageSignatureStatement {
  kind: "napier.inspector-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export interface InspectorCatalogFingerprint {
  defaultPanelId: InspectorPackageManifest["defaultPanelId"];
  panels: InspectorPackageManifestPanel[];
  inspectorCatalogSha256: string;
}

export function createInspectorCatalogFingerprint(): InspectorCatalogFingerprint {
  const panels = NAPIER_INSPECTOR_PANELS.map((panel) =>
    normalizeInspectorPanel(panel),
  );
  const defaultPanelId = NAPIER_DEFAULT_INSPECTOR_PANEL_ID;
  return {
    defaultPanelId,
    panels,
    inspectorCatalogSha256: hashInspectorCatalog(panels, defaultPanelId),
  };
}

export function hashInspectorCatalog(
  panels: InspectorPackageManifestPanel[],
  defaultPanelId: InspectorPackageManifest["defaultPanelId"],
): string {
  return sha256(canonicalJson({ defaultPanelId, panels }));
}

export function createInspectorPackageManifest(
  publisher: string,
  options: { createdAt?: string; expiresAt?: string } = {},
): InspectorPackageManifest {
  const createdAt = options.createdAt ?? nowIso();
  if (!validTimestamp(createdAt)) {
    throw new Error("Inspector package manifest time is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(options.expiresAt, createdAt);
  const catalog = createInspectorCatalogFingerprint();
  const content = {
    kind: "napier.inspector-package-manifest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    publisher: normalizePublisher(publisher),
    defaultPanelId: catalog.defaultPanelId,
    inspectorCatalogSha256: catalog.inspectorCatalogSha256,
    panels: catalog.panels,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return validateInspectorPackageManifest({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function signInspectorPackage(
  publisher: string,
  anchorInput: ExtensionPublisherTrustAnchor,
  options: {
    expiresAt?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): SignedInspectorPackageEnvelope {
  const anchor = validateExtensionPublisherTrustAnchor(anchorInput);
  if (anchor.status !== "trusted") {
    throw new Error(`Inspector package publisher key is revoked: ${anchor.id}`);
  }
  if (!anchor.signingSource) {
    throw new Error(
      `Inspector package publisher key is verify-only: ${anchor.id}`,
    );
  }
  const environment = options.environment ?? process.env;
  const privateValue = environment[anchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Inspector package signing key is unavailable: ${anchor.signingSource.variable}`,
    );
  }
  const privateKey = parseEd25519PrivateKey(
    privateValue,
    "Inspector package signing key",
  );
  if (
    exportEd25519PublicKeySpki(createPublicKey(privateKey)) !==
    anchor.publicKeySpki
  ) {
    throw new Error(
      "Inspector package signing key does not match the trust anchor",
    );
  }
  const manifest = createInspectorPackageManifest(publisher, {
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  });
  const manifestArtifactSha256 = sha256(canonicalJson(manifest));
  const signedAt = nowIso();
  const statement = createInspectorPackageSignatureStatement(
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
    kind: "napier.signed-inspector-package" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    manifest,
    signature,
  };
  return validateSignedInspectorPackageEnvelope({
    ...content,
    contentSha256: hashSignedInspectorPackageEnvelope(content),
  });
}

export function hashSignedInspectorPackageEnvelope(
  input: Omit<SignedInspectorPackageEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateInspectorPackageManifest(
  value: unknown,
): InspectorPackageManifest {
  const manifest = assertExactRecord(
    value,
    "Inspector package manifest",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "publisher",
      "defaultPanelId",
      "inspectorCatalogSha256",
      "panels",
      "createdAt",
      "contentSha256",
    ],
    ["expiresAt"],
  ) as unknown as InspectorPackageManifest;
  const panels = validateInspectorPanels(manifest.panels);
  if (
    manifest.kind !== "napier.inspector-package-manifest" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== NAPIER_API_VERSION ||
    normalizePublisher(manifest.publisher) !== manifest.publisher ||
    !PANEL_IDS.has(manifest.defaultPanelId) ||
    !panels.some((panel) => panel.id === manifest.defaultPanelId) ||
    !SHA256.test(manifest.inspectorCatalogSha256) ||
    !validTimestamp(manifest.createdAt) ||
    !SHA256.test(manifest.contentSha256)
  ) {
    throw new Error("Inspector package manifest header is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(
    manifest.expiresAt,
    manifest.createdAt,
  );
  const normalized: InspectorPackageManifest = {
    ...structuredClone(manifest),
    panels,
    ...(expiresAt ? { expiresAt } : {}),
  };
  if (
    hashInspectorCatalog(panels, normalized.defaultPanelId) !==
    normalized.inspectorCatalogSha256
  ) {
    throw new Error("Inspector package catalog hash mismatch");
  }
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (sha256(canonicalJson(content)) !== manifest.contentSha256) {
    throw new Error("Inspector package manifest hash mismatch");
  }
  return normalized;
}

export function validateSignedInspectorPackageEnvelope(
  value: unknown,
): SignedInspectorPackageEnvelope {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error("Signed Inspector package must be serializable JSON");
  }
  if (bytes > MAX_SIGNED_INSPECTOR_PACKAGE_BYTES) {
    throw new Error(
      `Signed Inspector package exceeds ${MAX_SIGNED_INSPECTOR_PACKAGE_BYTES} bytes`,
    );
  }
  const envelope = assertExactRecord(value, "Signed Inspector package", [
    "kind",
    "schemaVersion",
    "apiVersion",
    "manifest",
    "signature",
    "contentSha256",
  ]) as unknown as SignedInspectorPackageEnvelope;
  if (
    envelope.kind !== "napier.signed-inspector-package" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !SHA256.test(envelope.contentSha256)
  ) {
    throw new Error("Signed Inspector package header is invalid");
  }
  const manifest = validateInspectorPackageManifest(envelope.manifest);
  const signature = assertExactRecord(
    envelope.signature,
    "Inspector package signature",
    [
      "algorithm",
      "keyId",
      "signedAt",
      "manifestArtifactSha256",
      "statementSha256",
      "value",
    ],
  ) as unknown as SignedInspectorPackageEnvelope["signature"];
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
    throw new Error("Inspector package signature evidence is invalid");
  }
  const statement = createInspectorPackageSignatureStatement(
    manifest.contentSha256,
    signature.manifestArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error("Inspector package signature statement hash mismatch");
  }
  if (sha256(canonicalJson(manifest)) !== signature.manifestArtifactSha256) {
    throw new Error("Inspector package manifest artifact hash mismatch");
  }
  const normalized: SignedInspectorPackageEnvelope = {
    ...structuredClone(envelope),
    manifest,
    signature: structuredClone(signature),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (
    hashSignedInspectorPackageEnvelope(content) !== normalized.contentSha256
  ) {
    throw new Error("Signed Inspector package envelope hash mismatch");
  }
  return normalized;
}

export function verifySignedInspectorPackageEnvelope(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): InspectorPackageVerification {
  const verificationTime = Number.isFinite(now.getTime()) ? now : new Date();
  const verifiedAt = verificationTime.toISOString();
  try {
    const envelope = validateSignedInspectorPackageEnvelope(value);
    const manifest = envelope.manifest;
    if (
      manifest.expiresAt !== undefined &&
      Date.parse(manifest.expiresAt) <= verificationTime.getTime()
    ) {
      return {
        status: "expired",
        verifiedAt,
        panelCount: manifest.panels.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Inspector package is expired",
      };
    }
    const anchor = anchors
      .map(validateExtensionPublisherTrustAnchor)
      .find((candidate) => candidate.keyId === envelope.signature.keyId);
    if (!anchor) {
      return {
        status: "unknown_key",
        verifiedAt,
        panelCount: manifest.panels.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Inspector package signer is unknown",
      };
    }
    const publicKey = parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Inspector package trust anchor",
    );
    const statement = createInspectorPackageSignatureStatement(
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
        panelCount: manifest.panels.length,
        manifestSha256: manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Inspector package signature verification failed",
      };
    }
    return {
      status: anchor.status === "trusted" ? "trusted" : "revoked",
      verifiedAt,
      panelCount: manifest.panels.length,
      manifestSha256: manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      keyId: envelope.signature.keyId,
      reason:
        anchor.status === "trusted"
          ? "Inspector package is trusted"
          : "Inspector package signer is revoked",
    };
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      panelCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function qualifyInspectorPackage(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
  observed = createInspectorCatalogFingerprint(),
): InspectorPackageQualification {
  const verification = verifySignedInspectorPackageEnvelope(
    value,
    anchors,
    now,
  );
  const qualifiedAt = verification.verifiedAt;
  if (verification.status !== "trusted") {
    return {
      status: verification.status,
      qualifiedAt,
      verificationStatus: verification.status,
      panelCount: verification.panelCount,
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
  const envelope = validateSignedInspectorPackageEnvelope(value);
  const manifest = envelope.manifest;
  const base = {
    qualifiedAt,
    verificationStatus: verification.status,
    panelCount: manifest.panels.length,
    manifestSha256: manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    inspectorCatalogSha256: manifest.inspectorCatalogSha256,
    observedInspectorCatalogSha256: observed.inspectorCatalogSha256,
    keyId: envelope.signature.keyId,
  };
  const observedPanelIds = new Set(observed.panels.map((panel) => panel.id));
  if (manifest.panels.some((panel) => !observedPanelIds.has(panel.id))) {
    return {
      ...base,
      status: "missing_inspector",
      reason: "Current Workbench is missing signed Inspector panels",
    };
  }
  if (observed.inspectorCatalogSha256 !== manifest.inspectorCatalogSha256) {
    return {
      ...base,
      status: "inspector_drift",
      reason:
        "Current Workbench Inspector catalog differs from the signed package",
    };
  }
  return {
    ...base,
    status: "qualified",
    reason: "Current Workbench Inspector catalog matches the signed package",
  };
}

function createInspectorPackageSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): InspectorPackageSignatureStatement {
  return {
    kind: "napier.inspector-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

function validateInspectorPanels(
  value: unknown,
): InspectorPackageManifestPanel[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error("Inspector package panels are invalid");
  }
  const seen = new Set<string>();
  return value.map((panel) => {
    const normalized = normalizeInspectorPanel(panel);
    if (seen.has(normalized.id)) {
      throw new Error("Inspector package panel IDs must be unique");
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function normalizeInspectorPanel(
  value: unknown,
): InspectorPackageManifestPanel {
  const panel = assertExactRecord(value, "Inspector package panel", [
    "id",
    "label",
    "surface",
    "capabilities",
  ]) as unknown as InspectorPackageManifestPanel;
  if (
    !PANEL_IDS.has(panel.id) ||
    (panel.surface !== "core" && panel.surface !== "lazy")
  ) {
    throw new Error("Inspector package panel header is invalid");
  }
  const label = visibleText(panel.label, "Inspector package panel label", 80);
  if (
    !Array.isArray(panel.capabilities) ||
    panel.capabilities.length < 1 ||
    panel.capabilities.length > 32 ||
    panel.capabilities.some(
      (capability) =>
        typeof capability !== "string" || !CAPABILITY.test(capability),
    )
  ) {
    throw new Error("Inspector package panel capabilities are invalid");
  }
  const capabilities = [...new Set(panel.capabilities)].sort();
  if (capabilities.length !== panel.capabilities.length) {
    throw new Error("Inspector package panel capabilities must be unique");
  }
  return {
    id: panel.id,
    label,
    surface: panel.surface,
    capabilities,
  };
}

function normalizePublisher(value: string): string {
  return visibleText(value, "Inspector package publisher", 120);
}

function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!validTimestamp(value) || value <= createdAt) {
    throw new Error("Inspector package expiry is invalid");
  }
  return value;
}

function visibleText(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
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
