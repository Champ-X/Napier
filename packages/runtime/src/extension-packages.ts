import { createHash, createPublicKey } from "node:crypto";
import {
  constants as fsConstants,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import {
  NAPIER_API_VERSION,
  type ApplyExtensionPackageDeploymentResult,
  type ApplyExtensionPackageUpdateResult,
  type CreateExtensionPublisherTrustAnchorRequest,
  type ExtensionPackageBinding,
  type ExtensionPackageChange,
  type ExtensionPackageChannelIndex,
  type ExtensionPackageChannelIndexEntry,
  type ExtensionPackageChannelIndexVerification,
  type ExtensionPackageDependency,
  type ExtensionPackageDependencyChanges,
  type ExtensionPackageDependencyResolution,
  type ExtensionPackageDeploymentItem,
  type ExtensionPackageDeploymentPreview,
  type ExtensionPackageHistoryEntry,
  type ExtensionPackageLockfile,
  type ExtensionPackageLockfileEntry,
  type ExtensionPackageLockfileVerification,
  type ExtensionPackageManifest,
  type ExtensionPackageManifestTool,
  type ExtensionPackageRolloutChannel,
  type ExtensionPackageRolloutPolicy,
  type ExtensionPackageRolloutPreview,
  type ExtensionPackageToolChanges,
  type ExtensionPackageUpdatePreview,
  type ExtensionPackageVersionDirection,
  type ExtensionPackageVerification,
  type ExtensionPublisherTrustAnchor,
  type ExtensionRecord,
  type PublishExtensionPackageRolloutChannelRequest,
  type SignedExtensionPackageChannelIndexEnvelope,
  type SignedExtensionPackageEnvelope,
} from "@napier/contracts";

import {
  canonicalJson,
  decodeEd25519Signature,
  ed25519KeyId,
  exportEd25519PublicKeySpki,
  parseEd25519PrivateKey,
  parseEd25519PublicKeySpki,
  sha256,
  signEd25519Statement,
  verifyEd25519Statement,
} from "./ed25519.js";
import { createMcpExtension, normalizeMcpName } from "./extensions.js";
import { createId, nowIso } from "./ids.js";

export const MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS = 32;
export const MAX_SIGNED_EXTENSION_PACKAGE_BYTES = 4 * 1024 * 1024;
export const MAX_EXTENSION_PACKAGE_EXECUTABLE_BYTES = 256 * 1024 * 1024;
export const MAX_EXTENSION_PACKAGE_HISTORY = 20;
export const MAX_EXTENSION_PACKAGE_DEPENDENCIES = 32;
export const MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES = 8;
export const MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES = 16 * 1024 * 1024;
export const MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES =
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES + 256 * 1024;
export const MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS = 8;
export const MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES = 1 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{1,127}$/;
const MAX_LOCKFILE_LOCATOR_LENGTH = 500;
const MAX_MANIFEST_TOOLS = 500;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

interface ExtensionPackageSignatureStatement {
  kind: "napier.extension-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

interface ExtensionPackageChannelIndexSignatureStatement {
  kind: "napier.extension-package-channel-index-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  indexContentSha256: string;
  indexArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

interface ExecutableEvidence {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export function createExtensionPublisherTrustAnchor(
  request: CreateExtensionPublisherTrustAnchorRequest,
  environment: NodeJS.ProcessEnv = process.env,
): ExtensionPublisherTrustAnchor {
  const label = normalizeLabel(request.label);
  const timestamp = nowIso();
  let publicKeySpki: string;
  let signingSource: ExtensionPublisherTrustAnchor["signingSource"];
  if (request.source.type === "environment") {
    const variable = normalizeEnvironmentName(request.source.variable);
    const value = environment[variable];
    if (!value) {
      throw new Error(
        `Extension publisher signing key is unavailable: ${variable}`,
      );
    }
    const privateKey = parseEd25519PrivateKey(
      value,
      "Extension publisher signing key",
    );
    publicKeySpki = exportEd25519PublicKeySpki(createPublicKey(privateKey));
    signingSource = { type: "environment", variable };
  } else {
    publicKeySpki = exportEd25519PublicKeySpki(
      parseEd25519PublicKeySpki(
        request.source.publicKeySpki,
        "Extension publisher trust anchor",
      ),
    );
  }
  const content = {
    id: createId("publisherkey"),
    label,
    algorithm: "Ed25519" as const,
    keyId: ed25519KeyId(publicKeySpki),
    publicKeySpki,
    ...(signingSource ? { signingSource } : {}),
    status: "trusted" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...content,
    contentSha256: hashExtensionPublisherTrustAnchor(content),
  };
}

export function revokeExtensionPublisherTrustAnchor(
  input: ExtensionPublisherTrustAnchor,
): ExtensionPublisherTrustAnchor {
  const anchor = validateExtensionPublisherTrustAnchor(input);
  if (anchor.status === "revoked") return anchor;
  const timestamp = nowIso();
  const content = {
    ...anchor,
    status: "revoked" as const,
    updatedAt: timestamp,
    revokedAt: timestamp,
  };
  const { contentSha256: _contentSha256, ...hashInput } = content;
  return {
    ...content,
    contentSha256: hashExtensionPublisherTrustAnchor(hashInput),
  };
}

export function hashExtensionPublisherTrustAnchor(
  input: Omit<ExtensionPublisherTrustAnchor, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPublisherTrustAnchor(
  value: unknown,
): ExtensionPublisherTrustAnchor {
  const anchor = assertExactRecord(
    value,
    "Extension publisher trust anchor",
    [
      "id",
      "label",
      "algorithm",
      "keyId",
      "publicKeySpki",
      "status",
      "createdAt",
      "updatedAt",
      "contentSha256",
    ],
    ["signingSource", "revokedAt"],
  ) as unknown as ExtensionPublisherTrustAnchor;
  if (
    !RESOURCE_ID.test(anchor.id) ||
    normalizeLabel(anchor.label) !== anchor.label ||
    anchor.algorithm !== "Ed25519" ||
    !SHA256.test(anchor.keyId) ||
    (anchor.status !== "trusted" && anchor.status !== "revoked") ||
    !validTimestamp(anchor.createdAt) ||
    !validTimestamp(anchor.updatedAt) ||
    anchor.updatedAt < anchor.createdAt ||
    !SHA256.test(anchor.contentSha256)
  ) {
    throw new Error("Extension publisher trust anchor is invalid");
  }
  if (anchor.signingSource) {
    const source = assertExactRecord(
      anchor.signingSource,
      "Extension publisher signing source",
      ["type", "variable"],
    );
    if (
      source["type"] !== "environment" ||
      normalizeEnvironmentName(String(source["variable"])) !==
        source["variable"]
    ) {
      throw new Error(
        "Extension publisher trust anchor signing source is invalid",
      );
    }
  }
  if (
    (anchor.status === "revoked" && !validTimestamp(anchor.revokedAt)) ||
    (anchor.status === "trusted" && anchor.revokedAt !== undefined) ||
    (anchor.revokedAt !== undefined &&
      (anchor.revokedAt < anchor.createdAt ||
        anchor.revokedAt !== anchor.updatedAt))
  ) {
    throw new Error(
      "Extension publisher trust anchor revocation evidence is invalid",
    );
  }
  const publicKeySpki = exportEd25519PublicKeySpki(
    parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Extension publisher trust anchor",
    ),
  );
  if (
    publicKeySpki !== anchor.publicKeySpki ||
    ed25519KeyId(publicKeySpki) !== anchor.keyId
  ) {
    throw new Error(
      "Extension publisher trust anchor key fingerprint mismatch",
    );
  }
  const { contentSha256: _contentSha256, ...content } = anchor;
  if (hashExtensionPublisherTrustAnchor(content) !== anchor.contentSha256) {
    throw new Error("Extension publisher trust anchor content hash mismatch");
  }
  return structuredClone(anchor);
}

export async function createExtensionPackageManifest(
  extension: ExtensionRecord,
  publisher: string,
  options: {
    createdAt?: Date;
    expiresAt?: string;
    dependencies?: ExtensionPackageDependency[];
  } = {},
): Promise<ExtensionPackageManifest> {
  if (
    extension.connection.status !== "ready" ||
    extension.tools.length === 0 ||
    extension.tools.some(
      (tool) =>
        tool.reviewStatus !== "approved" ||
        (tool.effect !== "read" && tool.effect !== "write"),
    )
  ) {
    throw new Error(
      "Extension package signing requires a ready catalog with every tool effect approved",
    );
  }
  const createdAt = options.createdAt ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error("Extension package creation time is invalid");
  }
  const createdAtIso = createdAt.toISOString();
  const expiresAt = normalizeOptionalExpiry(options.expiresAt, createdAtIso);
  const tools = extension.tools
    .map(
      (tool): ExtensionPackageManifestTool => ({
        name: tool.name,
        normalizedName: tool.normalizedName,
        description: tool.description,
        ...(tool.routingHint ? { routingHint: tool.routingHint } : {}),
        inputSchema: structuredClone(tool.inputSchema),
        schemaSha256: tool.schemaSha256,
        effect: tool.effect as "read" | "write",
      }),
    )
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    );
  const executable =
    extension.transport.type === "stdio"
      ? await hashExtensionExecutable(extension.transport.command)
      : undefined;
  const dependencies = normalizeExtensionPackageDependencies(
    options.dependencies,
    extension.normalizedName,
  );
  const content = {
    kind: "napier.extension-package-manifest" as const,
    schemaVersion: dependencies.length > 0 ? (2 as const) : (1 as const),
    apiVersion: NAPIER_API_VERSION,
    publisher: normalizePublisher(publisher),
    name: extension.name,
    normalizedName: extension.normalizedName,
    description: extension.description,
    version: extension.version,
    extensionKind: "mcp" as const,
    transport: structuredClone(extension.transport),
    transportSha256: hashExtensionTransport(extension.transport),
    requestedCapabilities: [...extension.requestedCapabilities],
    tools,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(executable ? { executable } : {}),
    createdAt: createdAtIso,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return validateExtensionPackageManifest({
    ...content,
    contentSha256: hashExtensionPackageManifest(content),
  });
}

export function hashExtensionPackageManifest(
  input: Omit<ExtensionPackageManifest, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPackageManifest(
  value: unknown,
): ExtensionPackageManifest {
  const manifest = assertExactRecord(
    value,
    "Extension package manifest",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "publisher",
      "name",
      "normalizedName",
      "description",
      "version",
      "extensionKind",
      "transport",
      "transportSha256",
      "requestedCapabilities",
      "tools",
      "createdAt",
      "contentSha256",
    ],
    ["dependencies", "executable", "expiresAt"],
  ) as unknown as ExtensionPackageManifest;
  if (
    manifest.kind !== "napier.extension-package-manifest" ||
    (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) ||
    manifest.apiVersion !== NAPIER_API_VERSION ||
    manifest.extensionKind !== "mcp" ||
    normalizePublisher(manifest.publisher) !== manifest.publisher ||
    !validTimestamp(manifest.createdAt) ||
    !SHA256.test(manifest.transportSha256) ||
    !SHA256.test(manifest.contentSha256)
  ) {
    throw new Error("Extension package manifest header is invalid");
  }
  const normalized = createMcpExtension({
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    transport: manifest.transport,
    requestedCapabilities: manifest.requestedCapabilities,
  });
  if (
    normalized.name !== manifest.name ||
    normalized.normalizedName !== manifest.normalizedName ||
    normalized.description !== manifest.description ||
    normalized.version !== manifest.version ||
    canonicalJson(normalized.transport) !== canonicalJson(manifest.transport) ||
    canonicalJson(normalized.requestedCapabilities) !==
      canonicalJson(manifest.requestedCapabilities) ||
    hashExtensionTransport(manifest.transport) !== manifest.transportSha256
  ) {
    throw new Error(
      "Extension package manifest configuration is not canonical",
    );
  }
  if (
    !Array.isArray(manifest.tools) ||
    manifest.tools.length === 0 ||
    manifest.tools.length > MAX_MANIFEST_TOOLS
  ) {
    throw new Error("Extension package manifest tool catalog is invalid");
  }
  const tools = manifest.tools.map(validateManifestTool);
  if (
    canonicalJson(tools) !== canonicalJson(manifest.tools) ||
    tools.some((tool, index) => {
      const previous = tools[index - 1];
      return (
        previous !== undefined && previous.normalizedName >= tool.normalizedName
      );
    })
  ) {
    throw new Error("Extension package manifest tools are not canonical");
  }
  const dependencies = normalizeExtensionPackageDependencies(
    manifest.dependencies,
    manifest.normalizedName,
  );
  if (
    (manifest.dependencies === undefined && dependencies.length > 0) ||
    (manifest.dependencies !== undefined &&
      (dependencies.length === 0 ||
        canonicalJson(dependencies) !==
          canonicalJson(manifest.dependencies))) ||
    (manifest.schemaVersion === 1 && dependencies.length > 0) ||
    (manifest.schemaVersion === 2 && dependencies.length === 0)
  ) {
    throw new Error(
      "Extension package manifest dependencies are not canonical",
    );
  }
  const expiresAt = normalizeOptionalExpiry(
    manifest.expiresAt,
    manifest.createdAt,
  );
  const executable =
    manifest.executable === undefined
      ? undefined
      : validateExecutableEvidence(manifest.executable);
  if (
    (manifest.transport.type === "stdio" && !executable) ||
    (manifest.transport.type === "streamable_http" && executable) ||
    (manifest.transport.type === "stdio" &&
      executable &&
      (executable.path !== manifest.transport.command ||
        !path.isAbsolute(executable.path)))
  ) {
    throw new Error(
      "Extension package executable evidence does not match its transport",
    );
  }
  const normalizedManifest: ExtensionPackageManifest = {
    ...structuredClone(manifest),
    transport: structuredClone(normalized.transport),
    requestedCapabilities: [...normalized.requestedCapabilities],
    tools,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(executable ? { executable } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
  const { contentSha256: _contentSha256, ...content } = normalizedManifest;
  if (
    hashExtensionPackageManifest(content) !== normalizedManifest.contentSha256
  ) {
    throw new Error("Extension package manifest hash mismatch");
  }
  return normalizedManifest;
}

export async function signExtensionPackage(
  extension: ExtensionRecord,
  publisher: string,
  anchorInput: ExtensionPublisherTrustAnchor,
  options: {
    expiresAt?: string;
    dependencies?: ExtensionPackageDependency[];
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<SignedExtensionPackageEnvelope> {
  const anchor = validateExtensionPublisherTrustAnchor(anchorInput);
  if (anchor.status !== "trusted") {
    throw new Error(
      `Extension publisher trust anchor is revoked: ${anchor.id}`,
    );
  }
  if (!anchor.signingSource) {
    throw new Error(
      `Extension publisher trust anchor is verify-only: ${anchor.id}`,
    );
  }
  const environment = options.environment ?? process.env;
  const privateValue = environment[anchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Extension publisher signing key is unavailable: ${anchor.signingSource.variable}`,
    );
  }
  const privateKey = parseEd25519PrivateKey(
    privateValue,
    "Extension publisher signing key",
  );
  if (
    exportEd25519PublicKeySpki(createPublicKey(privateKey)) !==
    anchor.publicKeySpki
  ) {
    throw new Error(
      "Extension publisher signing key does not match the trust anchor",
    );
  }
  const manifest = await createExtensionPackageManifest(extension, publisher, {
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
  });
  const manifestArtifactSha256 = sha256(canonicalJson(manifest));
  const signedAt = nowIso();
  const statement = createSignatureStatement(
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
    kind: "napier.signed-extension-package" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    manifest,
    signature,
  };
  return validateSignedExtensionPackageEnvelope({
    ...content,
    contentSha256: hashSignedExtensionPackageEnvelope(content),
  });
}

export function hashSignedExtensionPackageEnvelope(
  input: Omit<SignedExtensionPackageEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateSignedExtensionPackageEnvelope(
  value: unknown,
): SignedExtensionPackageEnvelope {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error("Signed extension package must be serializable JSON");
  }
  if (bytes > MAX_SIGNED_EXTENSION_PACKAGE_BYTES) {
    throw new Error(
      `Signed extension package exceeds ${MAX_SIGNED_EXTENSION_PACKAGE_BYTES} bytes`,
    );
  }
  const envelope = assertExactRecord(value, "Signed extension package", [
    "kind",
    "schemaVersion",
    "apiVersion",
    "manifest",
    "signature",
    "contentSha256",
  ]) as unknown as SignedExtensionPackageEnvelope;
  if (
    envelope.kind !== "napier.signed-extension-package" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !SHA256.test(envelope.contentSha256)
  ) {
    throw new Error("Signed extension package header is invalid");
  }
  const manifest = validateExtensionPackageManifest(envelope.manifest);
  const signature = assertExactRecord(
    envelope.signature,
    "Extension package signature",
    [
      "algorithm",
      "keyId",
      "signedAt",
      "manifestArtifactSha256",
      "statementSha256",
      "value",
    ],
  ) as unknown as SignedExtensionPackageEnvelope["signature"];
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
    throw new Error("Extension package signature evidence is invalid");
  }
  const statement = createSignatureStatement(
    manifest.contentSha256,
    signature.manifestArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error("Extension package signature statement hash mismatch");
  }
  if (sha256(canonicalJson(manifest)) !== signature.manifestArtifactSha256) {
    throw new Error("Extension package manifest artifact hash mismatch");
  }
  const normalized: SignedExtensionPackageEnvelope = {
    ...structuredClone(envelope),
    manifest,
    signature: structuredClone(signature),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (
    hashSignedExtensionPackageEnvelope(content) !== normalized.contentSha256
  ) {
    throw new Error("Signed extension package envelope hash mismatch");
  }
  return normalized;
}

export function verifySignedExtensionPackageEnvelope(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): ExtensionPackageVerification {
  const verificationTime = Number.isFinite(now.getTime()) ? now : new Date();
  const verifiedAt = verificationTime.toISOString();
  let envelope: SignedExtensionPackageEnvelope;
  try {
    envelope = validateSignedExtensionPackageEnvelope(value);
  } catch (error) {
    return invalidVerification(verifiedAt, safeError(error));
  }
  const base = verificationEvidence(envelope, verifiedAt);
  const anchor = anchors
    .map(validateExtensionPublisherTrustAnchor)
    .find((candidate) => candidate.keyId === envelope.signature.keyId);
  if (!anchor) {
    return {
      ...base,
      status: "unknown_key",
      signatureValid: false,
      integrityValid: true,
      configurationValid: true,
      reason: "No trusted publisher public key matches the package signature",
    };
  }
  const statement = createSignatureStatement(
    envelope.manifest.contentSha256,
    envelope.signature.manifestArtifactSha256,
    envelope.signature.keyId,
    envelope.signature.signedAt,
  );
  const signatureValid = verifyEd25519Statement(
    statement,
    envelope.signature.value,
    parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Extension publisher trust anchor",
    ),
  );
  if (!signatureValid) {
    return {
      ...base,
      status: "invalid",
      signatureValid: false,
      integrityValid: true,
      configurationValid: true,
      reason: "Extension package signature verification failed",
    };
  }
  if (
    Date.parse(envelope.manifest.createdAt) >
      verificationTime.getTime() + MAX_CLOCK_SKEW_MS ||
    Date.parse(envelope.signature.signedAt) >
      verificationTime.getTime() + MAX_CLOCK_SKEW_MS
  ) {
    return {
      ...base,
      status: "invalid",
      signatureValid: true,
      integrityValid: true,
      configurationValid: true,
      reason: "Extension package signing time is in the future",
    };
  }
  if (
    envelope.manifest.expiresAt &&
    Date.parse(envelope.manifest.expiresAt) <= verificationTime.getTime()
  ) {
    return {
      ...base,
      status: "expired",
      signatureValid: true,
      integrityValid: true,
      configurationValid: true,
      reason: "Extension package signature is valid, but the manifest expired",
    };
  }
  return {
    ...base,
    status: anchor.status,
    signatureValid: true,
    integrityValid: true,
    configurationValid: true,
    reason:
      anchor.status === "trusted"
        ? "Extension package signature and manifest are trusted"
        : "Extension package signature is valid, but its publisher key is revoked",
  };
}

export function createExtensionPackageBinding(
  value: unknown,
  importedAt = nowIso(),
): ExtensionPackageBinding {
  const envelope = validateSignedExtensionPackageEnvelope(value);
  if (!validTimestamp(importedAt)) {
    throw new Error("Extension package import time is invalid");
  }
  const content = { envelope, importedAt };
  return {
    ...content,
    contentSha256: hashExtensionPackageBinding(content),
  };
}

export function createMcpExtensionFromSignedPackage(
  value: unknown,
  importedAt = nowIso(),
): ExtensionRecord {
  const binding = createExtensionPackageBinding(value, importedAt);
  const { manifest, signature } = binding.envelope;
  const extension = createMcpExtension({
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    transport: manifest.transport,
    requestedCapabilities: manifest.requestedCapabilities,
  });
  return {
    ...extension,
    provenance: {
      source: "signed_package",
      locator: `${manifest.publisher}/${manifest.normalizedName}@${manifest.version}`,
      digestSha256: manifest.contentSha256,
      manifestSha256: manifest.contentSha256,
      envelopeSha256: binding.envelope.contentSha256,
      publisherKeyId: signature.keyId,
    },
    packageBinding: binding,
    packageHistory: [],
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}

export function hashExtensionPackageBinding(
  input: Omit<ExtensionPackageBinding, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPackageBinding(
  value: unknown,
): ExtensionPackageBinding {
  const binding = assertExactRecord(value, "Extension package binding", [
    "envelope",
    "importedAt",
    "contentSha256",
  ]) as unknown as ExtensionPackageBinding;
  const envelope = validateSignedExtensionPackageEnvelope(binding.envelope);
  if (
    !validTimestamp(binding.importedAt) ||
    !SHA256.test(binding.contentSha256)
  ) {
    throw new Error("Extension package binding is invalid");
  }
  const normalized = {
    envelope,
    importedAt: binding.importedAt,
    contentSha256: binding.contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashExtensionPackageBinding(content) !== normalized.contentSha256) {
    throw new Error("Extension package binding hash mismatch");
  }
  return structuredClone(normalized);
}

export function hashExtensionPackageHistoryEntry(
  input: Omit<ExtensionPackageHistoryEntry, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function createExtensionPackageHistoryEntry(
  sequence: number,
  bindingInput: ExtensionPackageBinding,
  supersededByEnvelopeSha256: string,
  supersededAt: string,
): ExtensionPackageHistoryEntry {
  const binding = validateExtensionPackageBinding(bindingInput);
  const content = {
    sequence,
    binding,
    supersededAt,
    supersededByEnvelopeSha256,
  };
  return validateExtensionPackageHistoryEntry({
    ...content,
    contentSha256: hashExtensionPackageHistoryEntry(content),
  });
}

export function validateExtensionPackageHistoryEntry(
  value: unknown,
): ExtensionPackageHistoryEntry {
  const entry = assertExactRecord(value, "Extension package history entry", [
    "sequence",
    "binding",
    "supersededAt",
    "supersededByEnvelopeSha256",
    "contentSha256",
  ]) as unknown as ExtensionPackageHistoryEntry;
  const binding = validateExtensionPackageBinding(entry.binding);
  if (
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    !validTimestamp(entry.supersededAt) ||
    entry.supersededAt < binding.importedAt ||
    !SHA256.test(entry.supersededByEnvelopeSha256) ||
    !SHA256.test(entry.contentSha256)
  ) {
    throw new Error("Extension package history entry is invalid");
  }
  const normalized = {
    sequence: entry.sequence,
    binding,
    supersededAt: entry.supersededAt,
    supersededByEnvelopeSha256: entry.supersededByEnvelopeSha256,
    contentSha256: entry.contentSha256,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashExtensionPackageHistoryEntry(content) !== normalized.contentSha256) {
    throw new Error("Extension package history entry hash mismatch");
  }
  return structuredClone(normalized);
}

export function validateExtensionPackageHistory(
  extension: ExtensionRecord,
  anchors: ExtensionPublisherTrustAnchor[],
): ExtensionPackageHistoryEntry[] {
  const currentBinding = extension.packageBinding;
  const history = extension.packageHistory ?? [];
  if (!currentBinding) {
    if (history.length > 0) {
      throw new Error(
        "Extension package history requires a current package binding",
      );
    }
    return [];
  }
  const current = validateExtensionPackageBinding(currentBinding);
  if (history.length > MAX_EXTENSION_PACKAGE_HISTORY) {
    throw new Error(
      `Extension package history exceeds ${MAX_EXTENSION_PACKAGE_HISTORY} entries`,
    );
  }
  const normalized = history.map(validateExtensionPackageHistoryEntry);
  const envelopeHashes = new Set<string>();
  for (const [index, entry] of normalized.entries()) {
    const successor =
      normalized[index + 1]?.binding.envelope ?? current.envelope;
    const verification = verifySignedExtensionPackageEnvelope(
      entry.binding.envelope,
      anchors,
    );
    if (
      entry.sequence !== index + 1 ||
      entry.binding.envelope.manifest.normalizedName !==
        current.envelope.manifest.normalizedName ||
      envelopeHashes.has(entry.binding.envelope.contentSha256) ||
      entry.supersededByEnvelopeSha256 !== successor.contentSha256 ||
      entry.supersededAt !==
        (normalized[index + 1]?.binding.importedAt ?? current.importedAt) ||
      (verification.status !== "trusted" &&
        verification.status !== "revoked" &&
        verification.status !== "expired")
    ) {
      throw new Error(
        `Extension package history chain is invalid at sequence ${entry.sequence}`,
      );
    }
    envelopeHashes.add(entry.binding.envelope.contentSha256);
  }
  if (envelopeHashes.has(current.envelope.contentSha256)) {
    throw new Error("Extension package history repeats the current envelope");
  }
  return normalized;
}

export function hashExtensionPackageUpdatePreview(
  input: Omit<ExtensionPackageUpdatePreview, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function createExtensionPackageUpdatePreview(
  extension: ExtensionRecord,
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  generatedAt = nowIso(),
): ExtensionPackageUpdatePreview {
  if (!validTimestamp(generatedAt)) {
    throw new Error("Extension package update preview time is invalid");
  }
  const currentBinding = extension.packageBinding;
  if (!currentBinding || extension.provenance.source !== "signed_package") {
    throw new Error(
      "Only an installed signed Extension package can be updated",
    );
  }
  const current = validateExtensionPackageBinding(currentBinding);
  if (!extensionMatchesManifest(extension, current.envelope.manifest)) {
    throw new Error(
      "Current Extension configuration differs from its installed package",
    );
  }
  const currentVerification = verifySignedExtensionPackageEnvelope(
    current.envelope,
    anchors,
    new Date(generatedAt),
  );
  if (
    currentVerification.status !== "trusted" &&
    currentVerification.status !== "revoked" &&
    currentVerification.status !== "expired"
  ) {
    throw new Error(
      `Current installed Extension package is invalid: ${currentVerification.reason}`,
    );
  }
  const history = validateExtensionPackageHistory(extension, anchors);
  const next = validateSignedExtensionPackageEnvelope(value);
  const verification = verifySignedExtensionPackageEnvelope(
    next,
    anchors,
    new Date(generatedAt),
  );
  if (verification.status !== "trusted") {
    throw new Error(
      `Signed Extension package update is not trusted: ${verification.reason}`,
    );
  }
  if (
    next.manifest.normalizedName !== current.envelope.manifest.normalizedName
  ) {
    throw new Error(
      "Signed Extension package update targets a different normalized name",
    );
  }
  if (
    history.some(
      (entry) => entry.binding.envelope.contentSha256 === next.contentSha256,
    )
  ) {
    throw new Error(
      "Signed Extension package update replays a historical envelope",
    );
  }
  if (
    history.length >= MAX_EXTENSION_PACKAGE_HISTORY &&
    current.envelope.contentSha256 !== next.contentSha256
  ) {
    throw new Error(
      `Extension package history reached ${MAX_EXTENSION_PACKAGE_HISTORY} updates`,
    );
  }

  const currentManifest = current.envelope.manifest;
  const nextManifest = next.manifest;
  const versionDirection = compareExtensionPackageVersions(
    currentManifest.version,
    nextManifest.version,
  );
  const publisherChanged =
    currentManifest.publisher !== nextManifest.publisher ||
    current.envelope.signature.keyId !== next.signature.keyId;
  const transportChanged =
    currentManifest.transportSha256 !== nextManifest.transportSha256;
  const executableChanged =
    canonicalJson(currentManifest.executable ?? null) !==
    canonicalJson(nextManifest.executable ?? null);
  const metadataChanged =
    currentManifest.name !== nextManifest.name ||
    currentManifest.description !== nextManifest.description;
  const capabilitiesAdded = setDifference(
    nextManifest.requestedCapabilities,
    currentManifest.requestedCapabilities,
  );
  const capabilitiesRemoved = setDifference(
    currentManifest.requestedCapabilities,
    nextManifest.requestedCapabilities,
  );
  const tools = compareManifestTools(currentManifest.tools, nextManifest.tools);
  const dependencies = compareManifestDependencies(
    currentManifest.dependencies ?? [],
    nextManifest.dependencies ?? [],
  );
  const lifecycleChanged =
    currentManifest.createdAt !== nextManifest.createdAt ||
    currentManifest.expiresAt !== nextManifest.expiresAt;
  const signatureChanged =
    canonicalJson(current.envelope.signature) !== canonicalJson(next.signature);
  const changes: ExtensionPackageChange[] = [];
  if (publisherChanged) changes.push("publisher");
  if (currentManifest.version !== nextManifest.version) changes.push("version");
  if (metadataChanged) changes.push("metadata");
  if (transportChanged) changes.push("transport");
  if (capabilitiesAdded.length > 0 || capabilitiesRemoved.length > 0) {
    changes.push("capabilities");
  }
  if (
    tools.added.length > 0 ||
    tools.removed.length > 0 ||
    tools.schemaChanged.length > 0 ||
    tools.descriptionChanged.length > 0 ||
    tools.routingHintChanged.length > 0
  ) {
    changes.push("tools");
  }
  if (tools.effectChanged.length > 0) changes.push("effects");
  if (
    dependencies.added.length > 0 ||
    dependencies.removed.length > 0 ||
    dependencies.changed.length > 0
  ) {
    changes.push("dependencies");
  }
  if (executableChanged) changes.push("executable");
  if (lifecycleChanged) changes.push("lifecycle");
  if (signatureChanged) changes.push("signature");

  const content = {
    kind: "napier.extension-package-update-preview" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    extensionId: extension.id,
    expectedPackageBindingSha256: current.contentSha256,
    current: packageUpdateIdentity(current.envelope),
    next: packageUpdateIdentity(next),
    versionDirection,
    publisherChanged,
    requiresPublisherConfirmation: publisherChanged,
    requiresVersionOverride:
      versionDirection === "regression" || versionDirection === "unknown",
    transportChanged,
    executableChanged,
    metadataChanged,
    capabilitiesAdded,
    capabilitiesRemoved,
    tools,
    dependencies,
    changes,
    noChanges: current.envelope.contentSha256 === next.contentSha256,
    resetsLocalReview: true as const,
  };
  return {
    ...content,
    generatedAt,
    contentSha256: hashExtensionPackageUpdatePreview(content),
  };
}

export function applyExtensionPackageUpdateRecord(
  extension: ExtensionRecord,
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  options: {
    expectedPackageBindingSha256: string;
    confirmPublisherChange?: boolean;
    confirmVersionOverride?: boolean;
    updatedAt?: string;
  },
): ApplyExtensionPackageUpdateResult {
  const updatedAt = options.updatedAt ?? nowIso();
  const preview = createExtensionPackageUpdatePreview(
    extension,
    value,
    anchors,
    updatedAt,
  );
  if (
    !SHA256.test(options.expectedPackageBindingSha256) ||
    options.expectedPackageBindingSha256 !==
      preview.expectedPackageBindingSha256
  ) {
    throw new Error(
      "Installed Extension package changed since the update preview",
    );
  }
  if (preview.noChanges) {
    return {
      extension: structuredClone(extension),
      preview,
      updated: false,
    };
  }
  if (
    preview.requiresPublisherConfirmation &&
    options.confirmPublisherChange !== true
  ) {
    throw new Error(
      "Extension package publisher change requires explicit confirmation",
    );
  }
  if (
    preview.requiresVersionOverride &&
    options.confirmVersionOverride !== true
  ) {
    throw new Error(
      "Extension package version direction requires explicit override",
    );
  }
  const currentBinding = validateExtensionPackageBinding(
    extension.packageBinding,
  );
  const history = validateExtensionPackageHistory(extension, anchors);
  if (history.length >= MAX_EXTENSION_PACKAGE_HISTORY) {
    throw new Error(
      `Extension package history reached ${MAX_EXTENSION_PACKAGE_HISTORY} updates`,
    );
  }
  const next = createMcpExtensionFromSignedPackage(value, updatedAt);
  const nextBinding = validateExtensionPackageBinding(next.packageBinding);
  const historyEntry = createExtensionPackageHistoryEntry(
    history.length + 1,
    currentBinding,
    nextBinding.envelope.contentSha256,
    updatedAt,
  );
  const updated: ExtensionRecord = {
    ...next,
    id: extension.id,
    packageHistory: [...history, historyEntry],
    connection: {
      status: "disconnected",
      toolCount: 0,
      error: "Signed package updated; source and tools require local review.",
    },
    revision: extension.revision + 1,
    createdAt: extension.createdAt,
    updatedAt,
  };
  validateExtensionPackageHistory(updated, anchors);
  return {
    extension: updated,
    preview,
    updated: true,
  };
}

export function hashExtensionPackageDeploymentPreview(
  input: Omit<
    ExtensionPackageDeploymentPreview,
    "generatedAt" | "contentSha256"
  >,
): string {
  return sha256(
    canonicalJson({
      ...input,
      items: input.items.map((item) => {
        const { updatePreview, ...content } = item;
        return {
          ...content,
          ...(updatePreview
            ? { updatePreviewSha256: updatePreview.contentSha256 }
            : {}),
        };
      }),
    }),
  );
}

export function createExtensionPackageDeploymentPreview(
  extensions: ExtensionRecord[],
  values: unknown[],
  anchors: ExtensionPublisherTrustAnchor[],
  generatedAt = nowIso(),
): ExtensionPackageDeploymentPreview {
  if (!validTimestamp(generatedAt)) {
    throw new Error("Extension package deployment preview time is invalid");
  }
  const envelopes = validateDeploymentEnvelopes(
    values,
    anchors,
    new Date(generatedAt),
  );
  const currentByName = new Map(
    extensions.map((extension) => [extension.normalizedName, extension]),
  );
  if (currentByName.size !== extensions.length) {
    throw new Error(
      "Extension package deployment found duplicate package names",
    );
  }
  const candidateNames = new Set(
    envelopes.map((envelope) => envelope.manifest.normalizedName),
  );
  const provisional = structuredClone(extensions);
  const items: ExtensionPackageDeploymentItem[] = [];

  for (const envelope of envelopes) {
    const normalizedName = envelope.manifest.normalizedName;
    const current = currentByName.get(normalizedName);
    if (!current) {
      const installed = createMcpExtensionFromSignedPackage(
        envelope,
        generatedAt,
      );
      installed.id = `ext_deploy_${envelope.contentSha256.slice(0, 16)}`;
      provisional.push(installed);
      items.push({
        action: "install",
        normalizedName,
        next: packageUpdateIdentity(envelope),
        versionDirection: "install",
        publisherChanged: false,
        requiresPublisherConfirmation: false,
        requiresVersionOverride: false,
        dependencies: structuredClone(envelope.manifest.dependencies ?? []),
        changes: [],
        noChanges: false,
      });
      continue;
    }
    if (
      !current.packageBinding ||
      current.provenance.source !== "signed_package"
    ) {
      throw new Error(
        `Signed package deployment collides with an unsigned Extension: ${normalizedName}`,
      );
    }
    const updatePreview = createExtensionPackageUpdatePreview(
      current,
      envelope,
      anchors,
      generatedAt,
    );
    const result = applyExtensionPackageUpdateRecord(
      current,
      envelope,
      anchors,
      {
        expectedPackageBindingSha256:
          updatePreview.expectedPackageBindingSha256,
        confirmPublisherChange: true,
        confirmVersionOverride: true,
        updatedAt: generatedAt,
      },
    );
    const index = provisional.findIndex(
      (extension) => extension.id === current.id,
    );
    if (index < 0) {
      throw new Error(
        `Extension package deployment target disappeared: ${current.id}`,
      );
    }
    provisional[index] = result.extension;
    items.push({
      action: "update",
      normalizedName,
      extensionId: current.id,
      current: updatePreview.current,
      next: updatePreview.next,
      expectedPackageBindingSha256: updatePreview.expectedPackageBindingSha256,
      versionDirection: updatePreview.versionDirection,
      publisherChanged: updatePreview.publisherChanged,
      requiresPublisherConfirmation:
        updatePreview.requiresPublisherConfirmation,
      requiresVersionOverride: updatePreview.requiresVersionOverride,
      dependencies: structuredClone(envelope.manifest.dependencies ?? []),
      changes: [...updatePreview.changes],
      noChanges: updatePreview.noChanges,
      updatePreview,
    });
  }

  const resolutions = validateExtensionPackageDependencyGraph(
    provisional,
    anchors,
    { requireTrusted: true, now: new Date(generatedAt) },
  ).map((resolution) => ({
    ...resolution,
    source: candidateNames.has(resolution.dependencyName)
      ? ("candidate" as const)
      : ("installed" as const),
  }));
  const applyOrder = deploymentApplyOrder(envelopes);
  const content = {
    kind: "napier.extension-package-deployment-preview" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    candidateCount: items.length,
    installCount: items.filter((item) => item.action === "install").length,
    updateCount: items.filter((item) => item.action === "update").length,
    items,
    applyOrder,
    resolutions,
    requiresPublisherConfirmation: items.some(
      (item) => item.requiresPublisherConfirmation,
    ),
    requiresVersionOverride: items.some((item) => item.requiresVersionOverride),
    noChanges: items.every((item) => item.noChanges),
    resetsLocalReview: true as const,
  };
  return {
    ...content,
    generatedAt,
    contentSha256: hashExtensionPackageDeploymentPreview(content),
  };
}

export function applyExtensionPackageDeploymentRecords(
  extensions: ExtensionRecord[],
  values: unknown[],
  anchors: ExtensionPublisherTrustAnchor[],
  options: {
    expectedDeploymentSha256: string;
    confirmPublisherChanges?: boolean;
    confirmVersionOverrides?: boolean;
    updatedAt?: string;
  },
): ApplyExtensionPackageDeploymentResult {
  const updatedAt = options.updatedAt ?? nowIso();
  const preview = createExtensionPackageDeploymentPreview(
    extensions,
    values,
    anchors,
    updatedAt,
  );
  if (
    !SHA256.test(options.expectedDeploymentSha256) ||
    preview.contentSha256 !== options.expectedDeploymentSha256
  ) {
    throw new Error(
      "Extension package workspace changed since the deployment preview",
    );
  }
  if (
    preview.requiresPublisherConfirmation &&
    options.confirmPublisherChanges !== true
  ) {
    throw new Error(
      "Extension package deployment publisher changes require explicit confirmation",
    );
  }
  if (
    preview.requiresVersionOverride &&
    options.confirmVersionOverrides !== true
  ) {
    throw new Error(
      "Extension package deployment version overrides require explicit confirmation",
    );
  }

  const envelopes = validateDeploymentEnvelopes(
    values,
    anchors,
    new Date(updatedAt),
  );
  const envelopeByName = new Map(
    envelopes.map((envelope) => [envelope.manifest.normalizedName, envelope]),
  );
  const next = structuredClone(extensions);
  const changed: ExtensionRecord[] = [];
  const installedExtensionIds: string[] = [];
  const updatedExtensionIds: string[] = [];

  for (const normalizedName of preview.applyOrder) {
    const envelope = envelopeByName.get(normalizedName);
    const item = preview.items.find(
      (candidate) => candidate.normalizedName === normalizedName,
    );
    if (!envelope || !item) {
      throw new Error(
        `Extension package deployment plan is incomplete: ${normalizedName}`,
      );
    }
    if (item.action === "install") {
      const installed = createMcpExtensionFromSignedPackage(
        envelope,
        updatedAt,
      );
      if (
        next.some(
          (extension) =>
            extension.id === installed.id ||
            extension.normalizedName === installed.normalizedName,
        )
      ) {
        throw new Error(
          `Extension package deployment install target already exists: ${normalizedName}`,
        );
      }
      next.push(installed);
      changed.push(installed);
      installedExtensionIds.push(installed.id);
      continue;
    }
    if (!item.extensionId || !item.expectedPackageBindingSha256) {
      throw new Error(
        `Extension package deployment update target is invalid: ${normalizedName}`,
      );
    }
    const index = next.findIndex(
      (extension) => extension.id === item.extensionId,
    );
    const current = next[index];
    if (!current) {
      throw new Error(
        `Extension package deployment target disappeared: ${item.extensionId}`,
      );
    }
    const result = applyExtensionPackageUpdateRecord(
      current,
      envelope,
      anchors,
      {
        expectedPackageBindingSha256: item.expectedPackageBindingSha256,
        ...(options.confirmPublisherChanges === true
          ? { confirmPublisherChange: true }
          : {}),
        ...(options.confirmVersionOverrides === true
          ? { confirmVersionOverride: true }
          : {}),
        updatedAt,
      },
    );
    next[index] = result.extension;
    if (result.updated) {
      changed.push(result.extension);
      updatedExtensionIds.push(result.extension.id);
    }
  }

  validateExtensionPackageDependencyGraph(next, anchors, {
    requireTrusted: true,
    now: new Date(updatedAt),
  });
  return {
    extensions: changed,
    preview,
    installedExtensionIds,
    updatedExtensionIds,
  };
}

export function validateExtensionPackageDependencyGraph(
  extensions: ExtensionRecord[],
  anchors: ExtensionPublisherTrustAnchor[],
  options: { requireTrusted?: boolean; now?: Date } = {},
): ExtensionPackageDependencyResolution[] {
  const byName = new Map<string, ExtensionRecord>();
  for (const extension of extensions) {
    if (byName.has(extension.normalizedName)) {
      throw new Error(
        `Duplicate Extension dependency target: ${extension.normalizedName}`,
      );
    }
    byName.set(extension.normalizedName, extension);
  }

  const edges = new Map<string, string[]>();
  const resolutions: ExtensionPackageDependencyResolution[] = [];
  for (const extension of extensions) {
    const binding = extension.packageBinding;
    if (!binding) continue;
    const manifest = validateExtensionPackageBinding(binding).envelope.manifest;
    const dependencyNames: string[] = [];
    for (const dependency of manifest.dependencies ?? []) {
      const target = byName.get(dependency.normalizedName);
      const targetBinding = target?.packageBinding;
      if (!target || !targetBinding) {
        throw new Error(
          `Extension package dependency is missing: ${manifest.normalizedName} requires ${dependency.normalizedName} ${dependency.versionRange}`,
        );
      }
      const targetManifest =
        validateExtensionPackageBinding(targetBinding).envelope.manifest;
      if (
        !satisfiesExtensionPackageVersionRange(
          targetManifest.version,
          dependency.versionRange,
        )
      ) {
        throw new Error(
          `Extension package dependency version is incompatible: ${manifest.normalizedName} requires ${dependency.normalizedName} ${dependency.versionRange}, found ${targetManifest.version}`,
        );
      }
      if (options.requireTrusted) {
        const verification = verifyBoundExtensionPackageTrust(
          target,
          anchors,
          options.now,
        );
        if (!verification || verification.status !== "trusted") {
          throw new Error(
            `Extension package dependency is not trusted: ${dependency.normalizedName}`,
          );
        }
      }
      dependencyNames.push(dependency.normalizedName);
      resolutions.push({
        dependentName: manifest.normalizedName,
        dependencyName: dependency.normalizedName,
        versionRange: dependency.versionRange,
        resolvedVersion: targetManifest.version,
        resolvedExtensionId: target.id,
        source: "installed",
      });
    }
    edges.set(manifest.normalizedName, dependencyNames);
  }
  assertAcyclicPackageDependencies(edges);
  return resolutions.sort(
    (left, right) =>
      left.dependentName.localeCompare(right.dependentName) ||
      left.dependencyName.localeCompare(right.dependencyName),
  );
}

export function extensionPackageDependencyFailure(
  extension: ExtensionRecord,
  extensions: ExtensionRecord[],
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): string | undefined {
  if (!extension.packageBinding) return undefined;
  const byName = new Map(
    extensions.map((candidate) => [candidate.normalizedName, candidate]),
  );
  const visiting = new Set<string>();
  const checked = new Set<string>();
  const inspect = (current: ExtensionRecord): string | undefined => {
    if (checked.has(current.normalizedName)) return undefined;
    if (visiting.has(current.normalizedName)) {
      return `Signed Extension dependency cycle includes ${current.normalizedName}`;
    }
    const binding = current.packageBinding;
    if (!binding) {
      return `Signed Extension dependency is not a package: ${current.normalizedName}`;
    }
    visiting.add(current.normalizedName);
    const manifest = validateExtensionPackageBinding(binding).envelope.manifest;
    for (const dependency of manifest.dependencies ?? []) {
      const target = byName.get(dependency.normalizedName);
      if (!target?.packageBinding) {
        return `Signed Extension dependency is missing: ${dependency.normalizedName}`;
      }
      const targetManifest = validateExtensionPackageBinding(
        target.packageBinding,
      ).envelope.manifest;
      if (
        !satisfiesExtensionPackageVersionRange(
          targetManifest.version,
          dependency.versionRange,
        )
      ) {
        return `Signed Extension dependency ${dependency.normalizedName} requires ${dependency.versionRange}, found ${targetManifest.version}`;
      }
      const verification = verifyBoundExtensionPackageTrust(
        target,
        anchors,
        now,
      );
      if (!verification || verification.status !== "trusted") {
        return `Signed Extension dependency is not trusted: ${dependency.normalizedName}`;
      }
      const nested = inspect(target);
      if (nested) return nested;
    }
    visiting.delete(current.normalizedName);
    checked.add(current.normalizedName);
    return undefined;
  };
  try {
    return inspect(extension);
  } catch (error) {
    return safeError(error);
  }
}

export function createExtensionPackageLockfile(
  extensions: ExtensionRecord[],
  anchors: ExtensionPublisherTrustAnchor[],
  options: { extensionIds?: string[]; generatedAt?: string } = {},
): ExtensionPackageLockfile {
  const generatedAt = options.generatedAt ?? nowIso();
  if (!validTimestamp(generatedAt)) {
    throw new Error("Extension package lockfile time is invalid");
  }
  const selectedIds =
    options.extensionIds === undefined
      ? undefined
      : new Set(options.extensionIds);
  if (selectedIds && selectedIds.size !== options.extensionIds?.length) {
    throw new Error("Extension package lockfile contains duplicate targets");
  }
  const selected = extensions
    .filter((extension) =>
      selectedIds
        ? selectedIds.has(extension.id)
        : Boolean(extension.packageBinding),
    )
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    );
  if (selectedIds && selected.length !== selectedIds.size) {
    throw new Error("Extension package lockfile target was not found");
  }
  const entries = selected.map((extension) => {
    if (!extension.packageBinding) {
      throw new Error(
        `Extension package lockfile target is not signed: ${extension.id}`,
      );
    }
    const verification = verifyBoundExtensionPackageTrust(
      extension,
      anchors,
      new Date(generatedAt),
    );
    if (!verification || verification.status !== "trusted") {
      throw new Error(
        `Extension package lockfile target is not trusted: ${extension.normalizedName}`,
      );
    }
    return createExtensionPackageLockfileEntry(
      validateExtensionPackageBinding(extension.packageBinding).envelope,
    );
  });
  if (
    entries.length < 1 ||
    entries.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES
  ) {
    throw new Error(
      `Extension package lockfile must contain 1-${MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES} packages`,
    );
  }
  validateLockfileDependencyClosure(entries, anchors, new Date(generatedAt));
  const content = {
    kind: "napier.extension-package-lockfile" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    packages: entries,
  };
  return validateExtensionPackageLockfile({
    ...content,
    generatedAt,
    contentSha256: hashExtensionPackageLockfile(content),
  });
}

export function hashExtensionPackageLockfile(
  input: Omit<ExtensionPackageLockfile, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPackageLockfile(
  value: unknown,
): ExtensionPackageLockfile {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error("Extension package lockfile must be serializable JSON");
  }
  if (bytes > MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES) {
    throw new Error(
      `Extension package lockfile exceeds ${MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES} bytes`,
    );
  }
  const lockfile = assertExactRecord(value, "Extension package lockfile", [
    "kind",
    "schemaVersion",
    "apiVersion",
    "packages",
    "generatedAt",
    "contentSha256",
  ]) as unknown as ExtensionPackageLockfile;
  if (
    lockfile.kind !== "napier.extension-package-lockfile" ||
    lockfile.schemaVersion !== 1 ||
    lockfile.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(lockfile.generatedAt) ||
    !SHA256.test(lockfile.contentSha256) ||
    !Array.isArray(lockfile.packages) ||
    lockfile.packages.length < 1 ||
    lockfile.packages.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES
  ) {
    throw new Error("Extension package lockfile header is invalid");
  }
  const packages = lockfile.packages.map(validateExtensionPackageLockfileEntry);
  if (
    canonicalJson(packages) !== canonicalJson(lockfile.packages) ||
    packages.some((entry, index) => {
      const previous = packages[index - 1];
      return (
        previous !== undefined &&
        previous.normalizedName >= entry.normalizedName
      );
    })
  ) {
    throw new Error("Extension package lockfile packages are not canonical");
  }
  const normalized: ExtensionPackageLockfile = {
    ...structuredClone(lockfile),
    packages,
  };
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = normalized;
  if (hashExtensionPackageLockfile(content) !== normalized.contentSha256) {
    throw new Error("Extension package lockfile hash mismatch");
  }
  return normalized;
}

export function verifyExtensionPackageLockfile(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): ExtensionPackageLockfileVerification {
  const verifiedAt = (
    Number.isFinite(now.getTime()) ? now : new Date()
  ).toISOString();
  try {
    const lockfile = validateExtensionPackageLockfile(value);
    const envelopes = extensionPackageLockfileEnvelopes(lockfile);
    const envelopeHashes = envelopes.map((envelope) => envelope.contentSha256);
    for (const envelope of envelopes) {
      const verification = verifySignedExtensionPackageEnvelope(
        envelope,
        anchors,
        now,
      );
      if (verification.status !== "trusted") {
        const status =
          verification.status === "revoked" ||
          verification.status === "unknown_key" ||
          verification.status === "expired"
            ? verification.status
            : "invalid";
        return {
          status,
          verifiedAt,
          packageCount: lockfile.packages.length,
          lockfileSha256: lockfile.contentSha256,
          packageEnvelopeSha256es: envelopeHashes,
          reason: verification.reason,
        };
      }
    }
    validateLockfileDependencyClosure(lockfile.packages, anchors, now);
    return {
      status: "trusted",
      verifiedAt,
      packageCount: lockfile.packages.length,
      lockfileSha256: lockfile.contentSha256,
      packageEnvelopeSha256es: envelopeHashes,
      reason: "Extension package lockfile is trusted",
    };
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      packageCount: 0,
      packageEnvelopeSha256es: [],
      reason: safeError(error),
    };
  }
}

export function extensionPackageLockfileEnvelopes(
  value: unknown,
): SignedExtensionPackageEnvelope[] {
  return validateExtensionPackageLockfile(value).packages.map(
    (entry) => entry.envelope,
  );
}

export function createExtensionPackageRolloutChannel(input: {
  existing?: ExtensionPackageRolloutChannel;
  extensions: ExtensionRecord[];
  anchors: ExtensionPublisherTrustAnchor[];
  request: PublishExtensionPackageRolloutChannelRequest;
  generatedAt?: string;
}): ExtensionPackageRolloutChannel {
  const generatedAt = input.generatedAt ?? nowIso();
  if (!validTimestamp(generatedAt)) {
    throw new Error("Extension package rollout channel time is invalid");
  }
  const name = normalizeRolloutChannelName(input.request.name);
  const normalizedName = normalizeMcpName(name);
  const existing = input.existing
    ? validateExtensionPackageRolloutChannel(input.existing, input.anchors)
    : undefined;
  if (existing && existing.normalizedName !== normalizedName) {
    throw new Error("Extension package rollout channel name changed");
  }
  if (
    input.request.expectedRevision !== undefined &&
    (!Number.isSafeInteger(input.request.expectedRevision) ||
      input.request.expectedRevision < 1 ||
      existing?.revision !== input.request.expectedRevision)
  ) {
    throw new Error("Extension package rollout channel revision changed");
  }
  const lockfile = createExtensionPackageLockfile(
    input.extensions,
    input.anchors,
    {
      ...(input.request.extensionIds
        ? { extensionIds: input.request.extensionIds }
        : {}),
      generatedAt,
    },
  );
  const policy = createExtensionPackageRolloutPolicy(
    lockfile,
    input.request.policy,
    existing?.policy,
  );
  validateRolloutPolicyAllowsLockfile(policy, lockfile);
  const dependencyCount = lockfile.packages.reduce(
    (total, entry) => total + entry.dependencies.length,
    0,
  );
  const content = {
    id: existing?.id ?? createId("rollout"),
    name,
    normalizedName,
    description: normalizeRolloutDescription(input.request.description ?? ""),
    status: "active" as const,
    policy,
    lockfile,
    lockfileSha256: lockfile.contentSha256,
    packageCount: lockfile.packages.length,
    dependencyCount,
    packageEnvelopeIdsSha256: hashStringSet(
      lockfile.packages.map((entry) => entry.envelopeSha256),
    ),
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing?.createdAt ?? generatedAt,
    updatedAt: generatedAt,
  };
  return validateExtensionPackageRolloutChannel(
    {
      ...content,
      contentSha256: hashExtensionPackageRolloutChannel(content),
    },
    input.anchors,
  );
}

export function hashExtensionPackageRolloutChannel(
  input: Omit<ExtensionPackageRolloutChannel, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPackageRolloutChannel(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[] = [],
): ExtensionPackageRolloutChannel {
  const channel = assertExactRecord(
    value,
    "Extension package rollout channel",
    [
      "id",
      "name",
      "normalizedName",
      "description",
      "status",
      "policy",
      "lockfile",
      "lockfileSha256",
      "packageCount",
      "dependencyCount",
      "packageEnvelopeIdsSha256",
      "revision",
      "createdAt",
      "updatedAt",
      "contentSha256",
    ],
  ) as unknown as ExtensionPackageRolloutChannel;
  const lockfile = validateExtensionPackageLockfile(channel.lockfile);
  const policy = validateExtensionPackageRolloutPolicy(channel.policy);
  if (
    !RESOURCE_ID.test(channel.id) ||
    normalizeRolloutChannelName(channel.name) !== channel.name ||
    normalizeMcpName(channel.name) !== channel.normalizedName ||
    normalizeRolloutDescription(channel.description) !== channel.description ||
    channel.status !== "active" ||
    channel.lockfileSha256 !== lockfile.contentSha256 ||
    channel.packageCount !== lockfile.packages.length ||
    channel.dependencyCount !==
      lockfile.packages.reduce(
        (total, entry) => total + entry.dependencies.length,
        0,
      ) ||
    channel.packageEnvelopeIdsSha256 !==
      hashStringSet(lockfile.packages.map((entry) => entry.envelopeSha256)) ||
    !Number.isSafeInteger(channel.revision) ||
    channel.revision < 1 ||
    !validTimestamp(channel.createdAt) ||
    !validTimestamp(channel.updatedAt) ||
    channel.updatedAt < channel.createdAt ||
    !SHA256.test(channel.contentSha256)
  ) {
    throw new Error("Extension package rollout channel is invalid");
  }
  validateRolloutPolicyAllowsLockfile(policy, lockfile);
  if (anchors.length > 0) {
    const verification = verifyExtensionPackageLockfile(lockfile, anchors);
    if (verification.status !== "trusted") {
      throw new Error(
        `Extension package rollout channel lockfile is not trusted: ${verification.reason}`,
      );
    }
  }
  const normalized: ExtensionPackageRolloutChannel = {
    ...structuredClone(channel),
    policy,
    lockfile,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashExtensionPackageRolloutChannel(content) !== channel.contentSha256) {
    throw new Error("Extension package rollout channel hash mismatch");
  }
  return normalized;
}

export function validateExtensionPackageRolloutPolicy(
  value: unknown,
): ExtensionPackageRolloutPolicy {
  const policy = assertExactRecord(value, "Extension package rollout policy", [
    "kind",
    "schemaVersion",
    "maxPackages",
    "requireTrustedPublishers",
    "requireDependencyClosure",
    "allowedPublisherKeyIds",
    "allowedPackageNames",
  ]) as unknown as ExtensionPackageRolloutPolicy;
  if (
    policy.kind !== "napier.extension-package-rollout-policy" ||
    policy.schemaVersion !== 1 ||
    !Number.isSafeInteger(policy.maxPackages) ||
    policy.maxPackages < 1 ||
    policy.maxPackages > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
    policy.requireTrustedPublishers !== true ||
    policy.requireDependencyClosure !== true ||
    !Array.isArray(policy.allowedPublisherKeyIds) ||
    policy.allowedPublisherKeyIds.length < 1 ||
    policy.allowedPublisherKeyIds.length >
      MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS ||
    !Array.isArray(policy.allowedPackageNames) ||
    policy.allowedPackageNames.length < 1 ||
    policy.allowedPackageNames.length >
      MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES
  ) {
    throw new Error("Extension package rollout policy is invalid");
  }
  const allowedPublisherKeyIds = [...policy.allowedPublisherKeyIds].sort();
  const allowedPackageNames = [...policy.allowedPackageNames].sort();
  if (
    canonicalJson(allowedPublisherKeyIds) !==
      canonicalJson(policy.allowedPublisherKeyIds) ||
    canonicalJson(allowedPackageNames) !==
      canonicalJson(policy.allowedPackageNames) ||
    new Set(allowedPublisherKeyIds).size !== allowedPublisherKeyIds.length ||
    new Set(allowedPackageNames).size !== allowedPackageNames.length ||
    allowedPublisherKeyIds.some((keyId) => !SHA256.test(keyId)) ||
    allowedPackageNames.some((name) => normalizeMcpName(name) !== name)
  ) {
    throw new Error("Extension package rollout policy is not canonical");
  }
  return {
    kind: policy.kind,
    schemaVersion: 1,
    maxPackages: policy.maxPackages,
    requireTrustedPublishers: true,
    requireDependencyClosure: true,
    allowedPublisherKeyIds,
    allowedPackageNames,
  };
}

export function createExtensionPackageRolloutPreview(
  channelValue: unknown,
  extensions: ExtensionRecord[],
  anchors: ExtensionPublisherTrustAnchor[],
  generatedAt = nowIso(),
): ExtensionPackageRolloutPreview {
  if (!validTimestamp(generatedAt)) {
    throw new Error("Extension package rollout preview time is invalid");
  }
  const channel = validateExtensionPackageRolloutChannel(channelValue, anchors);
  const verification = verifyExtensionPackageLockfile(
    channel.lockfile,
    anchors,
    new Date(generatedAt),
  );
  if (verification.status !== "trusted") {
    throw new Error(
      `Extension package rollout channel is not trusted: ${verification.reason}`,
    );
  }
  validateRolloutPolicyAllowsLockfile(channel.policy, channel.lockfile);
  const deploymentPreview = createExtensionPackageDeploymentPreview(
    extensions,
    extensionPackageLockfileEnvelopes(channel.lockfile),
    anchors,
    generatedAt,
  );
  const content = {
    kind: "napier.extension-package-rollout-preview" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    channelId: channel.id,
    channelName: channel.name,
    channelRevision: channel.revision,
    policy: channel.policy,
    lockfileSha256: channel.lockfileSha256,
    verification,
    deploymentPreview,
  };
  return {
    ...content,
    generatedAt,
    contentSha256: hashExtensionPackageRolloutPreview(content),
  };
}

export function hashExtensionPackageRolloutPreview(
  input: Omit<ExtensionPackageRolloutPreview, "generatedAt" | "contentSha256">,
): string {
  return sha256(
    canonicalJson({
      ...input,
      verification: {
        status: input.verification.status,
        packageCount: input.verification.packageCount,
        lockfileSha256: input.verification.lockfileSha256 ?? "",
        packageEnvelopeSha256es: input.verification.packageEnvelopeSha256es,
      },
      deploymentPreviewSha256: input.deploymentPreview.contentSha256,
      deploymentPreview: undefined,
    }),
  );
}

export function applyExtensionPackageRolloutChannelRecords(
  channelValue: unknown,
  extensions: ExtensionRecord[],
  anchors: ExtensionPublisherTrustAnchor[],
  options: {
    expectedRolloutSha256: string;
    expectedDeploymentSha256: string;
    confirmPublisherChanges?: boolean;
    confirmVersionOverrides?: boolean;
    updatedAt?: string;
  },
): {
  channel: ExtensionPackageRolloutChannel;
  rolloutPreview: ExtensionPackageRolloutPreview;
  deployment: ApplyExtensionPackageDeploymentResult;
} {
  const updatedAt = options.updatedAt ?? nowIso();
  const channel = validateExtensionPackageRolloutChannel(channelValue, anchors);
  const rolloutPreview = createExtensionPackageRolloutPreview(
    channel,
    extensions,
    anchors,
    updatedAt,
  );
  if (
    !SHA256.test(options.expectedRolloutSha256) ||
    rolloutPreview.contentSha256 !== options.expectedRolloutSha256
  ) {
    throw new Error(
      "Extension package rollout channel changed since the preview",
    );
  }
  const deployment = applyExtensionPackageDeploymentRecords(
    extensions,
    extensionPackageLockfileEnvelopes(channel.lockfile),
    anchors,
    {
      expectedDeploymentSha256: options.expectedDeploymentSha256,
      ...(options.confirmPublisherChanges === true
        ? { confirmPublisherChanges: true }
        : {}),
      ...(options.confirmVersionOverrides === true
        ? { confirmVersionOverrides: true }
        : {}),
      updatedAt,
    },
  );
  return { channel, rolloutPreview, deployment };
}

export function createExtensionPackageChannelIndex(
  channels: ExtensionPackageRolloutChannel[],
  publisher: string,
  options: {
    channelIds?: string[];
    createdAt?: string;
    expiresAt?: string;
    lockfileBaseUrl?: string;
  } = {},
): ExtensionPackageChannelIndex {
  const createdAt = options.createdAt ?? nowIso();
  if (!validTimestamp(createdAt)) {
    throw new Error("Extension package channel index time is invalid");
  }
  const selectedIds =
    options.channelIds === undefined ? undefined : new Set(options.channelIds);
  if (selectedIds && selectedIds.size !== options.channelIds?.length) {
    throw new Error(
      "Extension package channel index contains duplicate targets",
    );
  }
  const selected = channels
    .filter((channel) =>
      selectedIds ? selectedIds.has(channel.id) : channel.status === "active",
    )
    .map((channel) => validateExtensionPackageRolloutChannel(channel))
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    );
  if (selectedIds && selected.length !== selectedIds.size) {
    throw new Error("Extension package channel index target was not found");
  }
  if (
    selected.length < 1 ||
    selected.length > MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS
  ) {
    throw new Error(
      `Extension package channel index must contain 1-${MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS} channels`,
    );
  }
  const expiresAt = normalizeOptionalExpiry(options.expiresAt, createdAt);
  const content = {
    kind: "napier.extension-package-channel-index" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    publisher: normalizePublisher(publisher),
    channels: selected.map((channel) =>
      createExtensionPackageChannelIndexEntry(channel, options.lockfileBaseUrl),
    ),
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return validateExtensionPackageChannelIndex({
    ...content,
    contentSha256: hashExtensionPackageChannelIndex(content),
  });
}

export function hashExtensionPackageChannelIndex(
  input: Omit<ExtensionPackageChannelIndex, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export async function signExtensionPackageChannelIndex(
  channels: ExtensionPackageRolloutChannel[],
  publisher: string,
  anchorInput: ExtensionPublisherTrustAnchor,
  options: {
    channelIds?: string[];
    expiresAt?: string;
    lockfileBaseUrl?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<SignedExtensionPackageChannelIndexEnvelope> {
  const anchor = validateExtensionPublisherTrustAnchor(anchorInput);
  if (anchor.status !== "trusted") {
    throw new Error(
      `Extension publisher trust anchor is revoked: ${anchor.id}`,
    );
  }
  if (!anchor.signingSource) {
    throw new Error(
      `Extension publisher trust anchor is verify-only: ${anchor.id}`,
    );
  }
  const environment = options.environment ?? process.env;
  const privateValue = environment[anchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Extension publisher signing key is unavailable: ${anchor.signingSource.variable}`,
    );
  }
  const privateKey = parseEd25519PrivateKey(
    privateValue,
    "Extension publisher signing key",
  );
  if (
    exportEd25519PublicKeySpki(createPublicKey(privateKey)) !==
    anchor.publicKeySpki
  ) {
    throw new Error(
      "Extension publisher signing key does not match the trust anchor",
    );
  }
  const index = createExtensionPackageChannelIndex(channels, publisher, {
    ...(options.channelIds ? { channelIds: options.channelIds } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.lockfileBaseUrl
      ? { lockfileBaseUrl: options.lockfileBaseUrl }
      : {}),
  });
  const indexArtifactSha256 = sha256(canonicalJson(index));
  const signedAt = nowIso();
  const statement = createChannelIndexSignatureStatement(
    index.contentSha256,
    indexArtifactSha256,
    anchor.keyId,
    signedAt,
  );
  const signature = {
    algorithm: "Ed25519" as const,
    keyId: anchor.keyId,
    signedAt,
    indexArtifactSha256,
    statementSha256: sha256(canonicalJson(statement)),
    value: signEd25519Statement(statement, privateKey),
  };
  const content = {
    kind: "napier.signed-extension-package-channel-index" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    index,
    signature,
  };
  return validateSignedExtensionPackageChannelIndexEnvelope({
    ...content,
    contentSha256: hashSignedExtensionPackageChannelIndexEnvelope(content),
  });
}

export function hashSignedExtensionPackageChannelIndexEnvelope(
  input: Omit<SignedExtensionPackageChannelIndexEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(input));
}

export function validateExtensionPackageChannelIndex(
  value: unknown,
): ExtensionPackageChannelIndex {
  const index = assertExactRecord(
    value,
    "Extension package channel index",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "publisher",
      "channels",
      "createdAt",
      "contentSha256",
    ],
    ["expiresAt"],
  ) as unknown as ExtensionPackageChannelIndex;
  if (
    index.kind !== "napier.extension-package-channel-index" ||
    index.schemaVersion !== 1 ||
    index.apiVersion !== NAPIER_API_VERSION ||
    normalizePublisher(index.publisher) !== index.publisher ||
    !Array.isArray(index.channels) ||
    index.channels.length < 1 ||
    index.channels.length > MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS ||
    !validTimestamp(index.createdAt) ||
    !SHA256.test(index.contentSha256)
  ) {
    throw new Error("Extension package channel index header is invalid");
  }
  const expiresAt = normalizeOptionalExpiry(index.expiresAt, index.createdAt);
  const channels = index.channels.map(
    validateExtensionPackageChannelIndexEntry,
  );
  if (
    canonicalJson(channels) !== canonicalJson(index.channels) ||
    channels.some((entry, index) => {
      const previous = channels[index - 1];
      return (
        previous !== undefined &&
        previous.normalizedName >= entry.normalizedName
      );
    })
  ) {
    throw new Error(
      "Extension package channel index channels are not canonical",
    );
  }
  const normalized: ExtensionPackageChannelIndex = {
    ...structuredClone(index),
    channels,
    ...(expiresAt ? { expiresAt } : {}),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (hashExtensionPackageChannelIndex(content) !== index.contentSha256) {
    throw new Error("Extension package channel index hash mismatch");
  }
  return normalized;
}

export function validateSignedExtensionPackageChannelIndexEnvelope(
  value: unknown,
): SignedExtensionPackageChannelIndexEnvelope {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new Error(
      "Signed Extension package channel index must be serializable JSON",
    );
  }
  if (bytes > MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES) {
    throw new Error(
      `Signed Extension package channel index exceeds ${MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES} bytes`,
    );
  }
  const envelope = assertExactRecord(
    value,
    "Signed Extension package channel index",
    [
      "kind",
      "schemaVersion",
      "apiVersion",
      "index",
      "signature",
      "contentSha256",
    ],
  ) as unknown as SignedExtensionPackageChannelIndexEnvelope;
  if (
    envelope.kind !== "napier.signed-extension-package-channel-index" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !SHA256.test(envelope.contentSha256)
  ) {
    throw new Error("Signed Extension package channel index header is invalid");
  }
  const index = validateExtensionPackageChannelIndex(envelope.index);
  const signature = assertExactRecord(
    envelope.signature,
    "Extension package channel index signature",
    [
      "algorithm",
      "keyId",
      "signedAt",
      "indexArtifactSha256",
      "statementSha256",
      "value",
    ],
  ) as unknown as SignedExtensionPackageChannelIndexEnvelope["signature"];
  decodeEd25519Signature(signature.value);
  if (
    signature.algorithm !== "Ed25519" ||
    !SHA256.test(signature.keyId) ||
    !validTimestamp(signature.signedAt) ||
    signature.signedAt < index.createdAt ||
    (index.expiresAt !== undefined && signature.signedAt >= index.expiresAt) ||
    !SHA256.test(signature.indexArtifactSha256) ||
    !SHA256.test(signature.statementSha256)
  ) {
    throw new Error(
      "Extension package channel index signature evidence is invalid",
    );
  }
  const statement = createChannelIndexSignatureStatement(
    index.contentSha256,
    signature.indexArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error(
      "Extension package channel index signature statement hash mismatch",
    );
  }
  if (sha256(canonicalJson(index)) !== signature.indexArtifactSha256) {
    throw new Error("Extension package channel index artifact hash mismatch");
  }
  const normalized: SignedExtensionPackageChannelIndexEnvelope = {
    ...structuredClone(envelope),
    index,
    signature: structuredClone(signature),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (
    hashSignedExtensionPackageChannelIndexEnvelope(content) !==
    normalized.contentSha256
  ) {
    throw new Error(
      "Signed Extension package channel index envelope hash mismatch",
    );
  }
  return normalized;
}

export function verifySignedExtensionPackageChannelIndexEnvelope(
  value: unknown,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): ExtensionPackageChannelIndexVerification {
  const verificationTime = Number.isFinite(now.getTime()) ? now : new Date();
  const verifiedAt = verificationTime.toISOString();
  try {
    const envelope = validateSignedExtensionPackageChannelIndexEnvelope(value);
    const index = envelope.index;
    if (
      index.expiresAt !== undefined &&
      Date.parse(index.expiresAt) <= verificationTime.getTime()
    ) {
      return {
        status: "expired",
        verifiedAt,
        channelCount: index.channels.length,
        indexSha256: index.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Extension package channel index is expired",
      };
    }
    const anchor = anchors
      .map(validateExtensionPublisherTrustAnchor)
      .find((candidate) => candidate.keyId === envelope.signature.keyId);
    if (!anchor) {
      return {
        status: "unknown_key",
        verifiedAt,
        channelCount: index.channels.length,
        indexSha256: index.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Extension package channel index signer is unknown",
      };
    }
    const publicKey = parseEd25519PublicKeySpki(
      anchor.publicKeySpki,
      "Extension package channel index trust anchor",
    );
    const statement = createChannelIndexSignatureStatement(
      index.contentSha256,
      envelope.signature.indexArtifactSha256,
      envelope.signature.keyId,
      envelope.signature.signedAt,
    );
    if (
      !verifyEd25519Statement(statement, envelope.signature.value, publicKey)
    ) {
      return {
        status: "invalid",
        verifiedAt,
        channelCount: index.channels.length,
        indexSha256: index.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: envelope.signature.keyId,
        reason: "Extension package channel index signature verification failed",
      };
    }
    return {
      status: anchor.status === "trusted" ? "trusted" : "revoked",
      verifiedAt,
      channelCount: index.channels.length,
      indexSha256: index.contentSha256,
      envelopeSha256: envelope.contentSha256,
      keyId: envelope.signature.keyId,
      reason:
        anchor.status === "trusted"
          ? "Extension package channel index is trusted"
          : "Extension package channel index signer is revoked",
    };
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      channelCount: 0,
      reason: safeError(error),
    };
  }
}

export async function verifyBoundExtensionPackage(
  extension: ExtensionRecord,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): Promise<ExtensionPackageVerification | undefined> {
  const packageBinding = extension.packageBinding;
  if (!packageBinding) return undefined;
  const verification = verifyBoundExtensionPackageTrust(
    extension,
    anchors,
    now,
  );
  if (!verification || verification.status !== "trusted") {
    return verification;
  }
  const binding = validateExtensionPackageBinding(packageBinding);
  if (binding.envelope.manifest.executable) {
    try {
      const executable = await hashExtensionExecutable(
        binding.envelope.manifest.executable.path,
      );
      if (
        canonicalJson(executable) !==
        canonicalJson(binding.envelope.manifest.executable)
      ) {
        return {
          ...verification,
          status: "executable_mismatch",
          executableValid: false,
          reason: "Current stdio executable does not match the signed manifest",
        };
      }
    } catch (error) {
      return {
        ...verification,
        status: "executable_mismatch",
        executableValid: false,
        reason: safeError(error),
      };
    }
  }
  return {
    ...verification,
    ...(binding.envelope.manifest.executable ? { executableValid: true } : {}),
  };
}

export function verifyBoundExtensionPackageTrust(
  extension: ExtensionRecord,
  anchors: ExtensionPublisherTrustAnchor[],
  now = new Date(),
): ExtensionPackageVerification | undefined {
  if (!extension.packageBinding) return undefined;
  let binding: ExtensionPackageBinding;
  try {
    binding = validateExtensionPackageBinding(extension.packageBinding);
  } catch (error) {
    return invalidVerification(
      Number.isFinite(now.getTime()) ? now.toISOString() : nowIso(),
      safeError(error),
    );
  }
  const verification = verifySignedExtensionPackageEnvelope(
    binding.envelope,
    anchors,
    now,
  );
  if (verification.status !== "trusted") return verification;
  if (!extensionMatchesManifest(extension, binding.envelope.manifest)) {
    return {
      ...verification,
      status: "configuration_drift",
      configurationValid: false,
      reason:
        "Current Extension configuration differs from the signed manifest",
    };
  }
  return verification;
}

export function assertDiscoveredToolsMatchPackage(
  extension: ExtensionRecord,
): void {
  if (!extension.packageBinding) return;
  const manifest = validateExtensionPackageBinding(extension.packageBinding)
    .envelope.manifest;
  const observed = extension.tools
    .map((tool) => ({
      name: tool.name,
      normalizedName: tool.normalizedName,
      schemaSha256: tool.schemaSha256,
    }))
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    );
  const expected = manifest.tools.map((tool) => ({
    name: tool.name,
    normalizedName: tool.normalizedName,
    schemaSha256: tool.schemaSha256,
  }));
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(
      "Discovered MCP tool catalog differs from the signed package manifest",
    );
  }
}

export function expectedSignedToolEffect(
  extension: ExtensionRecord,
  toolName: string,
): "read" | "write" | undefined {
  if (!extension.packageBinding) return undefined;
  return validateExtensionPackageBinding(
    extension.packageBinding,
  ).envelope.manifest.tools.find(
    (tool) => tool.name === toolName || tool.normalizedName === toolName,
  )?.effect;
}

export function hashExtensionTransport(
  transport: ExtensionRecord["transport"],
): string {
  return sha256(canonicalJson(transport));
}

export async function hashExtensionExecutable(
  command: string,
): Promise<ExecutableEvidence> {
  if (!path.isAbsolute(command)) {
    throw new Error(
      "Signed stdio package requires an absolute executable path",
    );
  }
  const fileInfo = await lstat(command);
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
    throw new Error(
      "Signed stdio package executable must be a regular non-symlink file",
    );
  }
  const canonicalPath = await realpath(command);
  if (canonicalPath !== command) {
    throw new Error(
      "Signed stdio package executable path must already be canonical",
    );
  }
  const handle = await open(
    command,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== fileInfo.dev ||
      stat.ino !== fileInfo.ino ||
      stat.size < 1 ||
      stat.size > MAX_EXTENSION_PACKAGE_EXECUTABLE_BYTES
    ) {
      throw new Error(
        `Signed stdio package executable must be 1-${MAX_EXTENSION_PACKAGE_EXECUTABLE_BYTES} bytes`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const length = Math.min(buffer.byteLength, stat.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new Error(
          "Signed stdio package executable changed while hashing",
        );
      }
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    const pathAfter = await lstat(command);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.dev !== stat.dev ||
      pathAfter.ino !== stat.ino ||
      pathAfter.size !== stat.size ||
      pathAfter.mtimeMs !== stat.mtimeMs
    ) {
      throw new Error("Signed stdio package executable changed while hashing");
    }
    return {
      path: command,
      sizeBytes: stat.size,
      sha256: digest.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

function validateManifestTool(value: unknown): ExtensionPackageManifestTool {
  const tool = assertExactRecord(
    value,
    "Extension package manifest tool",
    [
      "name",
      "normalizedName",
      "description",
      "inputSchema",
      "schemaSha256",
      "effect",
    ],
    ["routingHint"],
  ) as unknown as ExtensionPackageManifestTool;
  const name = visibleText(tool.name, "Manifest tool name", 160, true);
  const normalizedName = normalizeMcpName(name, 28);
  const description = visibleText(
    tool.description,
    "Manifest tool description",
    1_000,
    false,
  );
  const routingHint =
    tool.routingHint === undefined
      ? undefined
      : visibleText(tool.routingHint, "Manifest tool routing hint", 500, false);
  assertJsonValue(tool.inputSchema, "Manifest tool input schema");
  if (
    normalizedName !== tool.normalizedName ||
    !SHA256.test(tool.schemaSha256) ||
    sha256(canonicalJson(tool.inputSchema)) !== tool.schemaSha256 ||
    (tool.effect !== "read" && tool.effect !== "write")
  ) {
    throw new Error("Extension package manifest tool is invalid");
  }
  return {
    name,
    normalizedName,
    description,
    ...(routingHint ? { routingHint } : {}),
    inputSchema: structuredClone(tool.inputSchema),
    schemaSha256: tool.schemaSha256,
    effect: tool.effect,
  };
}

function validateExecutableEvidence(value: unknown): ExecutableEvidence {
  const evidence = assertExactRecord(
    value,
    "Extension package executable evidence",
    ["path", "sizeBytes", "sha256"],
  );
  if (
    typeof evidence["path"] !== "string" ||
    !path.isAbsolute(evidence["path"]) ||
    typeof evidence["sizeBytes"] !== "number" ||
    !Number.isSafeInteger(evidence["sizeBytes"]) ||
    evidence["sizeBytes"] < 1 ||
    evidence["sizeBytes"] > MAX_EXTENSION_PACKAGE_EXECUTABLE_BYTES ||
    typeof evidence["sha256"] !== "string" ||
    !SHA256.test(evidence["sha256"])
  ) {
    throw new Error("Extension package executable evidence is invalid");
  }
  return {
    path: evidence["path"],
    sizeBytes: evidence["sizeBytes"],
    sha256: evidence["sha256"],
  };
}

export function compareExtensionPackageVersions(
  current: string,
  next: string,
): ExtensionPackageVersionDirection {
  if (current === next) return "same";
  const currentVersion = parseSemVer(current);
  const nextVersion = parseSemVer(next);
  if (!currentVersion || !nextVersion) return "unknown";
  const comparison = compareSemVer(currentVersion, nextVersion);
  return comparison === 0 ? "same" : comparison < 0 ? "upgrade" : "regression";
}

function packageUpdateIdentity(envelope: SignedExtensionPackageEnvelope) {
  return {
    publisher: envelope.manifest.publisher,
    keyId: envelope.signature.keyId,
    version: envelope.manifest.version,
    manifestSha256: envelope.manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
  };
}

function setDifference<T extends string>(left: T[], right: T[]): T[] {
  const rightValues = new Set(right);
  return left
    .filter((value) => !rightValues.has(value))
    .sort((first, second) => first.localeCompare(second));
}

function compareManifestTools(
  current: ExtensionPackageManifestTool[],
  next: ExtensionPackageManifestTool[],
): ExtensionPackageToolChanges {
  const currentByName = new Map(
    current.map((tool) => [tool.normalizedName, tool]),
  );
  const nextByName = new Map(next.map((tool) => [tool.normalizedName, tool]));
  const added = next
    .filter((tool) => !currentByName.has(tool.normalizedName))
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));
  const removed = current
    .filter((tool) => !nextByName.has(tool.normalizedName))
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));
  const schemaChanged: string[] = [];
  const effectChanged: string[] = [];
  const descriptionChanged: string[] = [];
  const routingHintChanged: string[] = [];
  for (const currentTool of current) {
    const nextTool = nextByName.get(currentTool.normalizedName);
    if (!nextTool) continue;
    if (currentTool.schemaSha256 !== nextTool.schemaSha256) {
      schemaChanged.push(nextTool.name);
    }
    if (currentTool.effect !== nextTool.effect) {
      effectChanged.push(nextTool.name);
    }
    if (
      currentTool.name !== nextTool.name ||
      currentTool.description !== nextTool.description
    ) {
      descriptionChanged.push(nextTool.name);
    }
    if ((currentTool.routingHint ?? "") !== (nextTool.routingHint ?? "")) {
      routingHintChanged.push(nextTool.name);
    }
  }
  for (const values of [
    schemaChanged,
    effectChanged,
    descriptionChanged,
    routingHintChanged,
  ]) {
    values.sort((left, right) => left.localeCompare(right));
  }
  return {
    added,
    removed,
    schemaChanged,
    effectChanged,
    descriptionChanged,
    routingHintChanged,
  };
}

function compareManifestDependencies(
  current: ExtensionPackageDependency[],
  next: ExtensionPackageDependency[],
): ExtensionPackageDependencyChanges {
  const currentByName = new Map(
    current.map((dependency) => [dependency.normalizedName, dependency]),
  );
  const nextByName = new Map(
    next.map((dependency) => [dependency.normalizedName, dependency]),
  );
  return {
    added: next
      .filter((dependency) => !currentByName.has(dependency.normalizedName))
      .map((dependency) => structuredClone(dependency)),
    removed: current
      .filter((dependency) => !nextByName.has(dependency.normalizedName))
      .map((dependency) => structuredClone(dependency)),
    changed: next
      .flatMap((dependency) => {
        const previous = currentByName.get(dependency.normalizedName);
        return previous && previous.versionRange !== dependency.versionRange
          ? [
              {
                normalizedName: dependency.normalizedName,
                currentVersionRange: previous.versionRange,
                nextVersionRange: dependency.versionRange,
              },
            ]
          : [];
      })
      .sort((left, right) =>
        left.normalizedName.localeCompare(right.normalizedName),
      ),
  };
}

function createExtensionPackageLockfileEntry(
  input: SignedExtensionPackageEnvelope,
): ExtensionPackageLockfileEntry {
  const envelope = validateSignedExtensionPackageEnvelope(input);
  return validateExtensionPackageLockfileEntry({
    normalizedName: envelope.manifest.normalizedName,
    version: envelope.manifest.version,
    publisher: envelope.manifest.publisher,
    keyId: envelope.signature.keyId,
    manifestSha256: envelope.manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    dependencies: structuredClone(envelope.manifest.dependencies ?? []),
    envelope,
  });
}

function validateExtensionPackageLockfileEntry(
  value: unknown,
): ExtensionPackageLockfileEntry {
  const entry = assertExactRecord(value, "Extension package lockfile entry", [
    "normalizedName",
    "version",
    "publisher",
    "keyId",
    "manifestSha256",
    "envelopeSha256",
    "dependencies",
    "envelope",
  ]) as unknown as ExtensionPackageLockfileEntry;
  const envelope = validateSignedExtensionPackageEnvelope(entry.envelope);
  const dependencies = structuredClone(envelope.manifest.dependencies ?? []);
  if (
    entry.normalizedName !== envelope.manifest.normalizedName ||
    entry.version !== envelope.manifest.version ||
    entry.publisher !== envelope.manifest.publisher ||
    entry.keyId !== envelope.signature.keyId ||
    entry.manifestSha256 !== envelope.manifest.contentSha256 ||
    entry.envelopeSha256 !== envelope.contentSha256 ||
    canonicalJson(entry.dependencies) !== canonicalJson(dependencies)
  ) {
    throw new Error("Extension package lockfile entry does not match envelope");
  }
  return {
    normalizedName: entry.normalizedName,
    version: entry.version,
    publisher: entry.publisher,
    keyId: entry.keyId,
    manifestSha256: entry.manifestSha256,
    envelopeSha256: entry.envelopeSha256,
    dependencies,
    envelope,
  };
}

function createExtensionPackageChannelIndexEntry(
  channel: ExtensionPackageRolloutChannel,
  lockfileBaseUrl?: string,
): ExtensionPackageChannelIndexEntry {
  const current = validateExtensionPackageRolloutChannel(channel);
  return validateExtensionPackageChannelIndexEntry({
    name: current.name,
    normalizedName: current.normalizedName,
    channelRevision: current.revision,
    channelSha256: current.contentSha256,
    lockfileSha256: current.lockfileSha256,
    ...(lockfileBaseUrl
      ? {
          lockfileLocator: createLockfileLocator(
            lockfileBaseUrl,
            current.lockfileSha256,
          ),
        }
      : {}),
    packageCount: current.packageCount,
    dependencyCount: current.dependencyCount,
    packageEnvelopeIdsSha256: current.packageEnvelopeIdsSha256,
    policySha256: sha256(canonicalJson(current.policy)),
  });
}

function validateExtensionPackageChannelIndexEntry(
  value: unknown,
): ExtensionPackageChannelIndexEntry {
  const entry = assertExactRecord(
    value,
    "Extension package channel index entry",
    [
      "name",
      "normalizedName",
      "channelRevision",
      "channelSha256",
      "lockfileSha256",
      "packageCount",
      "dependencyCount",
      "packageEnvelopeIdsSha256",
      "policySha256",
    ],
    ["lockfileLocator"],
  ) as unknown as ExtensionPackageChannelIndexEntry;
  const lockfileLocator =
    entry.lockfileLocator === undefined
      ? undefined
      : normalizeLockfileLocator(entry.lockfileLocator);
  if (
    normalizeRolloutChannelName(entry.name) !== entry.name ||
    normalizeMcpName(entry.name) !== entry.normalizedName ||
    !Number.isSafeInteger(entry.channelRevision) ||
    entry.channelRevision < 1 ||
    !SHA256.test(entry.channelSha256) ||
    !SHA256.test(entry.lockfileSha256) ||
    !Number.isSafeInteger(entry.packageCount) ||
    entry.packageCount < 1 ||
    entry.packageCount > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
    !Number.isSafeInteger(entry.dependencyCount) ||
    entry.dependencyCount < 0 ||
    !SHA256.test(entry.packageEnvelopeIdsSha256) ||
    !SHA256.test(entry.policySha256) ||
    (entry.lockfileLocator !== undefined &&
      lockfileLocator !== entry.lockfileLocator)
  ) {
    throw new Error("Extension package channel index entry is invalid");
  }
  return {
    ...structuredClone(entry),
    ...(lockfileLocator ? { lockfileLocator } : {}),
  };
}

function createLockfileLocator(
  lockfileBaseUrl: string,
  lockfileSha256: string,
): string {
  if (!SHA256.test(lockfileSha256)) {
    throw new Error("Extension package lockfile locator hash is invalid");
  }
  const base = normalizeLockfileLocator(lockfileBaseUrl).replace(/\/+$/, "");
  return normalizeLockfileLocator(
    `${base}/api/extensions/packages/lockfiles/${lockfileSha256}`,
  );
}

function normalizeLockfileLocator(value: string): string {
  const normalized = visibleText(
    value,
    "Extension package lockfile locator",
    MAX_LOCKFILE_LOCATOR_LENGTH,
    true,
  );
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Extension package lockfile locator is invalid");
  }
  return url.toString();
}

function validateLockfileDependencyClosure(
  entries: ExtensionPackageLockfileEntry[],
  anchors: ExtensionPublisherTrustAnchor[],
  now: Date,
): void {
  const extensions = entries.map((entry) =>
    createMcpExtensionFromSignedPackage(entry.envelope, now.toISOString()),
  );
  validateExtensionPackageDependencyGraph(extensions, anchors, {
    requireTrusted: true,
    now,
  });
}

function createExtensionPackageRolloutPolicy(
  lockfile: ExtensionPackageLockfile,
  requestPolicy: PublishExtensionPackageRolloutChannelRequest["policy"],
  existingPolicy?: ExtensionPackageRolloutPolicy,
): ExtensionPackageRolloutPolicy {
  const defaultPublisherKeyIds =
    existingPolicy?.allowedPublisherKeyIds ??
    [...new Set(lockfile.packages.map((entry) => entry.keyId))].sort();
  const defaultPackageNames =
    existingPolicy?.allowedPackageNames ??
    lockfile.packages.map((entry) => entry.normalizedName).sort();
  const maxPackages =
    requestPolicy?.maxPackages ??
    existingPolicy?.maxPackages ??
    lockfile.packages.length;
  return validateExtensionPackageRolloutPolicy({
    kind: "napier.extension-package-rollout-policy",
    schemaVersion: 1,
    maxPackages,
    requireTrustedPublishers: true,
    requireDependencyClosure: true,
    allowedPublisherKeyIds:
      requestPolicy?.allowedPublisherKeyIds === undefined
        ? defaultPublisherKeyIds
        : [...new Set(requestPolicy.allowedPublisherKeyIds)].sort(),
    allowedPackageNames:
      requestPolicy?.allowedPackageNames === undefined
        ? defaultPackageNames
        : [
            ...new Set(
              requestPolicy.allowedPackageNames.map(normalizePackagePolicyName),
            ),
          ].sort(),
  });
}

function normalizePackagePolicyName(value: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,23}$/.test(value)
    ? value
    : normalizeMcpName(value);
}

function validateRolloutPolicyAllowsLockfile(
  policy: ExtensionPackageRolloutPolicy,
  lockfile: ExtensionPackageLockfile,
): void {
  const normalized = validateExtensionPackageRolloutPolicy(policy);
  if (lockfile.packages.length > normalized.maxPackages) {
    throw new Error(
      "Extension package rollout policy package limit is exceeded",
    );
  }
  const allowedPublisherKeyIds = new Set(normalized.allowedPublisherKeyIds);
  const allowedPackageNames = new Set(normalized.allowedPackageNames);
  for (const entry of lockfile.packages) {
    if (!allowedPackageNames.has(entry.normalizedName)) {
      throw new Error(
        `Extension package rollout policy rejects package: ${entry.normalizedName}`,
      );
    }
    if (!allowedPublisherKeyIds.has(entry.keyId)) {
      throw new Error(
        `Extension package rollout policy rejects publisher key: ${entry.keyId}`,
      );
    }
  }
}

export function normalizeExtensionPackageDependencies(
  value: unknown,
  selfName?: string,
): ExtensionPackageDependency[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_EXTENSION_PACKAGE_DEPENDENCIES
  ) {
    throw new Error(
      `Extension package dependencies must contain 1-${MAX_EXTENSION_PACKAGE_DEPENDENCIES} entries`,
    );
  }
  const dependencies = value.map((input): ExtensionPackageDependency => {
    const dependency = assertExactRecord(
      input,
      "Extension package dependency",
      ["normalizedName", "versionRange"],
    );
    const normalizedName = dependency["normalizedName"];
    const versionRange = dependency["versionRange"];
    if (
      typeof normalizedName !== "string" ||
      normalizeMcpName(normalizedName, 24) !== normalizedName
    ) {
      throw new Error("Extension package dependency name is not canonical");
    }
    if (normalizedName === selfName) {
      throw new Error("Extension package cannot depend on itself");
    }
    return {
      normalizedName,
      versionRange: normalizeExtensionPackageVersionRange(versionRange),
    };
  });
  dependencies.sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName),
  );
  if (
    dependencies.some(
      (dependency, index) =>
        dependencies[index - 1]?.normalizedName === dependency.normalizedName,
    )
  ) {
    throw new Error("Extension package dependencies contain duplicate names");
  }
  return dependencies;
}

export function normalizeExtensionPackageVersionRange(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Extension package dependency version range is invalid");
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) {
    throw new Error("Extension package dependency version range is invalid");
  }
  if (normalized === "*") return normalized;
  const prefix = normalized[0];
  if (prefix === "^" || prefix === "~") {
    const version = parseSemVer(normalized.slice(1));
    if (!version || !rangeUpperBound(prefix, version)) {
      throw new Error("Extension package dependency version range is invalid");
    }
    return normalized;
  }
  if (parseSemVer(normalized)) return normalized;
  const comparators = normalized.split(" ").map((comparator) => {
    const match = /^(>=|<=|>|<|=)(.+)$/.exec(comparator);
    const operator = match?.[1];
    const versionText = match?.[2];
    const version = versionText ? parseSemVer(versionText) : undefined;
    if (!operator || !versionText || !version) {
      throw new Error("Extension package dependency version range is invalid");
    }
    return {
      operator,
      version,
      versionText,
    };
  });
  const operatorOrder = new Map([
    [">=", 0],
    [">", 1],
    ["=", 2],
    ["<=", 3],
    ["<", 4],
  ]);
  return comparators
    .sort(
      (left, right) =>
        compareSemVer(left.version, right.version) ||
        (operatorOrder.get(left.operator) ?? 9) -
          (operatorOrder.get(right.operator) ?? 9) ||
        left.versionText.localeCompare(right.versionText),
    )
    .map((comparator) => `${comparator.operator}${comparator.versionText}`)
    .join(" ");
}

export function satisfiesExtensionPackageVersionRange(
  versionValue: string,
  rangeValue: string,
): boolean {
  const version = parseSemVer(versionValue);
  if (!version) return false;
  let range: string;
  try {
    range = normalizeExtensionPackageVersionRange(rangeValue);
  } catch {
    return false;
  }
  if (range === "*") return true;
  const prefix = range[0];
  if (prefix === "^" || prefix === "~") {
    const minimum = parseSemVer(range.slice(1));
    if (!minimum) return false;
    const maximum = rangeUpperBound(prefix, minimum);
    return (
      maximum !== undefined &&
      compareSemVer(version, minimum) >= 0 &&
      compareSemVer(version, maximum) < 0
    );
  }
  const exact = parseSemVer(range);
  if (exact) return compareSemVer(version, exact) === 0;
  return range.split(" ").every((comparator) => {
    const match = /^(>=|<=|>|<|=)(.+)$/.exec(comparator);
    const target = match ? parseSemVer(match[2]!) : undefined;
    if (!match || !target) return false;
    const comparison = compareSemVer(version, target);
    switch (match[1]) {
      case ">=":
        return comparison >= 0;
      case "<=":
        return comparison <= 0;
      case ">":
        return comparison > 0;
      case "<":
        return comparison < 0;
      default:
        return comparison === 0;
    }
  });
}

function rangeUpperBound(
  prefix: string,
  minimum: ParsedSemVer,
): ParsedSemVer | undefined {
  let major = minimum.major;
  let minor = minimum.minor;
  let patch = minimum.patch;
  if (prefix === "~") {
    minor += 1;
    patch = 0;
  } else if (major > 0) {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (minor > 0) {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return [major, minor, patch].every(Number.isSafeInteger)
    ? { major, minor, patch, prerelease: [] }
    : undefined;
}

function validateDeploymentEnvelopes(
  values: unknown[],
  anchors: ExtensionPublisherTrustAnchor[],
  now: Date,
): SignedExtensionPackageEnvelope[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES
  ) {
    throw new Error(
      `Extension package deployment must contain 1-${MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES} candidates`,
    );
  }
  let bytes = 0;
  const names = new Set<string>();
  const hashes = new Set<string>();
  const envelopes = values.map((value) => {
    const envelope = validateSignedExtensionPackageEnvelope(value);
    const verification = verifySignedExtensionPackageEnvelope(
      envelope,
      anchors,
      now,
    );
    if (verification.status !== "trusted") {
      throw new Error(
        `Extension package deployment candidate is not trusted: ${verification.reason}`,
      );
    }
    bytes += Buffer.byteLength(JSON.stringify(envelope));
    if (bytes > MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES) {
      throw new Error(
        `Extension package deployment exceeds ${MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES} bytes`,
      );
    }
    if (
      names.has(envelope.manifest.normalizedName) ||
      hashes.has(envelope.contentSha256)
    ) {
      throw new Error("Extension package deployment candidates must be unique");
    }
    names.add(envelope.manifest.normalizedName);
    hashes.add(envelope.contentSha256);
    return envelope;
  });
  return envelopes.sort((left, right) =>
    left.manifest.normalizedName.localeCompare(right.manifest.normalizedName),
  );
}

function deploymentApplyOrder(
  envelopes: SignedExtensionPackageEnvelope[],
): string[] {
  const byName = new Map(
    envelopes.map((envelope) => [envelope.manifest.normalizedName, envelope]),
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Extension package dependency cycle includes: ${name}`);
    }
    const envelope = byName.get(name);
    if (!envelope) return;
    visiting.add(name);
    for (const dependency of envelope.manifest.dependencies ?? []) {
      if (byName.has(dependency.normalizedName)) {
        visit(dependency.normalizedName);
      }
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };
  for (const name of [...byName.keys()].sort()) visit(name);
  return order;
}

function assertAcyclicPackageDependencies(edges: Map<string, string[]>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Extension package dependency cycle includes: ${name}`);
    }
    visiting.add(name);
    for (const dependency of edges.get(name) ?? []) {
      if (edges.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of [...edges.keys()].sort()) visit(name);
}

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemVer(value: string): ParsedSemVer | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return undefined;
  }
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) =>
        /^\d+$/.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    return undefined;
  }
  return { major, minor, patch, prerelease };
}

function compareSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const field of ["major", "minor", "patch"] as const) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return leftIdentifier.length === rightIdentifier.length
        ? leftIdentifier.localeCompare(rightIdentifier)
        : leftIdentifier.length - rightIdentifier.length;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }
  return 0;
}

function extensionMatchesManifest(
  extension: ExtensionRecord,
  manifest: ExtensionPackageManifest,
): boolean {
  if (
    extension.name !== manifest.name ||
    extension.normalizedName !== manifest.normalizedName ||
    extension.description !== manifest.description ||
    extension.version !== manifest.version ||
    canonicalJson(extension.transport) !== canonicalJson(manifest.transport) ||
    canonicalJson(extension.requestedCapabilities) !==
      canonicalJson(manifest.requestedCapabilities) ||
    extension.provenance.source !== "signed_package" ||
    extension.provenance.manifestSha256 !== manifest.contentSha256 ||
    extension.provenance.envelopeSha256 !==
      extension.packageBinding?.envelope.contentSha256 ||
    extension.provenance.publisherKeyId !==
      extension.packageBinding?.envelope.signature.keyId
  ) {
    return false;
  }
  if (extension.connection.status !== "ready") return true;
  try {
    assertDiscoveredToolsMatchPackage(extension);
    return extension.tools.every((tool) => {
      if (tool.reviewStatus !== "approved") return true;
      return expectedSignedToolEffect(extension, tool.name) === tool.effect;
    });
  } catch {
    return false;
  }
}

function createSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): ExtensionPackageSignatureStatement {
  return {
    kind: "napier.extension-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

function createChannelIndexSignatureStatement(
  indexContentSha256: string,
  indexArtifactSha256: string,
  keyId: string,
  signedAt: string,
): ExtensionPackageChannelIndexSignatureStatement {
  return {
    kind: "napier.extension-package-channel-index-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    indexContentSha256,
    indexArtifactSha256,
    keyId,
    signedAt,
  };
}

function verificationEvidence(
  envelope: SignedExtensionPackageEnvelope,
  verifiedAt: string,
) {
  return {
    verifiedAt,
    publisher: envelope.manifest.publisher,
    packageName: envelope.manifest.name,
    packageVersion: envelope.manifest.version,
    keyId: envelope.signature.keyId,
    manifestSha256: envelope.manifest.contentSha256,
    envelopeSha256: envelope.contentSha256,
    transportSha256: envelope.manifest.transportSha256,
  };
}

function invalidVerification(
  verifiedAt: string,
  reason: string,
): ExtensionPackageVerification {
  return {
    status: "invalid",
    verifiedAt,
    signatureValid: false,
    integrityValid: false,
    configurationValid: false,
    reason,
  };
}

function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    !validTimestamp(value) ||
    Date.parse(value) <= Date.parse(createdAt) ||
    Date.parse(value) > Date.parse(createdAt) + 10 * 365 * 24 * 60 * 60 * 1_000
  ) {
    throw new Error(
      "Extension package expiry must be after creation and within ten years",
    );
  }
  return new Date(value).toISOString();
}

function normalizePublisher(value: string): string {
  return visibleText(value, "Extension package publisher", 120, true);
}

function normalizeLabel(value: string): string {
  return visibleText(
    value,
    "Extension publisher trust anchor label",
    100,
    true,
  );
}

function normalizeRolloutChannelName(value: string): string {
  return visibleText(value, "Extension package rollout channel name", 80, true);
}

function normalizeRolloutDescription(value: string): string {
  return visibleText(
    value,
    "Extension package rollout channel description",
    240,
    false,
  );
}

function hashStringSet(values: string[]): string {
  return sha256(canonicalJson([...values].sort()));
}

function normalizeEnvironmentName(value: string): string {
  const normalized = value?.trim().toUpperCase();
  if (!ENVIRONMENT_NAME.test(normalized)) {
    throw new Error(
      "Extension publisher signing environment variable is invalid",
    );
  }
  return normalized;
}

function visibleText(
  value: unknown,
  label: string,
  maximum: number,
  required: boolean,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    (required && !normalized) ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f<>]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function assertJsonValue(value: unknown, label: string): void {
  if (value === null) return;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertJsonValue(item, label);
    return;
  }
  throw new Error(`${label} must be JSON`);
}

function assertExactRecord(
  value: unknown,
  label: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
