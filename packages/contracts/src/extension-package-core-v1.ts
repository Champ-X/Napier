import type { JsonValue, McpToolEffect } from "./execution-core.js";

export type ExtensionCapability = "network.connect" | "network.listen" | "secrets.env" | "process.spawn" | "workspace.read" | "workspace.write" | "external.read" | "external.write";

export type ExtensionTrustStatus = "pending" | "approved" | "rejected";

export type McpToolReviewStatus = "pending" | "approved" | "rejected";

export type ExtensionConnectionStatus = "untested" | "connecting" | "ready" | "error" | "disconnected";

export interface McpHttpTransportConfig {
  type: "streamable_http";
  url: string;
  headerEnv?: Record<string, string>;
}

export interface McpStdioTransportConfig {
  type: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type McpTransportConfig = McpHttpTransportConfig | McpStdioTransportConfig;

export interface ExtensionProvenance {
  source: "manual" | "signed_package";
  locator: string;
  digestSha256: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  publisherKeyId?: string;
}

export interface McpToolRecord {
  name: string;
  normalizedName: string;
  directName: string;
  description: string;
  routingHint?: string;
  inputSchema: JsonValue;
  schemaSha256: string;
  reviewStatus: McpToolReviewStatus;
  effect: McpToolEffect;
  reviewNote?: string;
  reviewedAt?: string;
}

export interface ExtensionConnection {
  status: ExtensionConnectionStatus;
  toolCount: number;
  testedAt?: string;
  error?: string;
}

export type ExtensionPublisherTrustAnchorStatus = "trusted" | "revoked";

export type CreateExtensionPublisherTrustAnchorSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "public_key";
      publicKeySpki: string;
    };

export interface ExtensionPublisherTrustAnchor {
  id: string;
  label: string;
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  signingSource?: {
    type: "environment";
    variable: string;
  };
  status: ExtensionPublisherTrustAnchorStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  contentSha256: string;
}

export interface CreateExtensionPublisherTrustAnchorRequest {
  threadId: string;
  label: string;
  source: CreateExtensionPublisherTrustAnchorSource;
}

export interface RevokeExtensionPublisherTrustAnchorRequest {
  threadId: string;
}

export interface ExtensionPackageManifestTool {
  name: string;
  normalizedName: string;
  description: string;
  routingHint?: string;
  inputSchema: JsonValue;
  schemaSha256: string;
  effect: Exclude<McpToolEffect, "unknown">;
}

export interface ExtensionPackageDependency {
  normalizedName: string;
  versionRange: string;
}

export interface ExtensionPackageManifest {
  kind: "napier.extension-package-manifest";
  schemaVersion: 1 | 2;
  apiVersion: string;
  publisher: string;
  name: string;
  normalizedName: string;
  description: string;
  version: string;
  extensionKind: "mcp";
  transport: McpTransportConfig;
  transportSha256: string;
  requestedCapabilities: ExtensionCapability[];
  tools: ExtensionPackageManifestTool[];
  dependencies?: ExtensionPackageDependency[];
  executable?: {
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface ExtensionPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedExtensionPackageEnvelope {
  kind: "napier.signed-extension-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: ExtensionPackageManifest;
  signature: ExtensionPackageSignature;
  contentSha256: string;
}

export interface ExtensionPackageBinding {
  envelope: SignedExtensionPackageEnvelope;
  importedAt: string;
  contentSha256: string;
}

export interface ExtensionPackageHistoryEntry {
  sequence: number;
  binding: ExtensionPackageBinding;
  supersededAt: string;
  supersededByEnvelopeSha256: string;
  contentSha256: string;
}

export type ExtensionPackageVersionDirection = "upgrade" | "same" | "regression" | "unknown";

export type ExtensionPackageChange = "publisher" | "version" | "metadata" | "transport" | "capabilities" | "tools" | "effects" | "dependencies" | "executable" | "lifecycle" | "signature";

export interface ExtensionPackageUpdateIdentity {
  publisher: string;
  keyId: string;
  version: string;
  manifestSha256: string;
  envelopeSha256: string;
}

export interface ExtensionPackageToolChanges {
  added: string[];
  removed: string[];
  schemaChanged: string[];
  effectChanged: string[];
  descriptionChanged: string[];
  routingHintChanged: string[];
}

export interface ExtensionPackageDependencyChanges {
  added: ExtensionPackageDependency[];
  removed: ExtensionPackageDependency[];
  changed: Array<{
    normalizedName: string;
    currentVersionRange: string;
    nextVersionRange: string;
  }>;
}

export interface ExtensionPackageUpdatePreview {
  kind: "napier.extension-package-update-preview";
  schemaVersion: 1;
  apiVersion: string;
  extensionId: string;
  expectedPackageBindingSha256: string;
  current: ExtensionPackageUpdateIdentity;
  next: ExtensionPackageUpdateIdentity;
  versionDirection: ExtensionPackageVersionDirection;
  publisherChanged: boolean;
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  transportChanged: boolean;
  executableChanged: boolean;
  metadataChanged: boolean;
  capabilitiesAdded: ExtensionCapability[];
  capabilitiesRemoved: ExtensionCapability[];
  tools: ExtensionPackageToolChanges;
  dependencies: ExtensionPackageDependencyChanges;
  changes: ExtensionPackageChange[];
  noChanges: boolean;
  resetsLocalReview: true;
  generatedAt: string;
  contentSha256: string;
}

export interface ExtensionRecord {
  id: string;
  kind: "mcp";
  name: string;
  normalizedName: string;
  description: string;
  version: string;
  provenance: ExtensionProvenance;
  requestedCapabilities: ExtensionCapability[];
  approvedCapabilities: ExtensionCapability[];
  trustStatus: ExtensionTrustStatus;
  enabledAgentIds: string[];
  transport: McpTransportConfig;
  packageBinding?: ExtensionPackageBinding;
  packageHistory?: ExtensionPackageHistoryEntry[];
  connection: ExtensionConnection;
  tools: McpToolRecord[];
  reviewNote?: string;
  reviewedAt?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyExtensionPackageUpdateResult {
  extension: ExtensionRecord;
  preview: ExtensionPackageUpdatePreview;
  updated: boolean;
}
