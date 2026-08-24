import type { McpToolEffect } from "./execution-core.js";
import type { PromptVariableDefinition } from "./execution-runs.js";
import type { ExtensionCapability, ExtensionPackageChange, ExtensionPackageDependency, ExtensionPackageUpdateIdentity, ExtensionPackageUpdatePreview, ExtensionPackageVersionDirection, ExtensionRecord, McpTransportConfig, SignedExtensionPackageEnvelope } from "./extension-package-core-v1.js";

export type ExtensionPackageDeploymentAction = "install" | "update";

export interface ExtensionPackageDependencyResolution {
  dependentName: string;
  dependencyName: string;
  versionRange: string;
  resolvedVersion: string;
  resolvedExtensionId?: string;
  source: "candidate" | "installed";
}

export interface ExtensionPackageDeploymentItem {
  action: ExtensionPackageDeploymentAction;
  normalizedName: string;
  extensionId?: string;
  current?: ExtensionPackageUpdateIdentity;
  next: ExtensionPackageUpdateIdentity;
  expectedPackageBindingSha256?: string;
  versionDirection: ExtensionPackageVersionDirection | "install";
  publisherChanged: boolean;
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  dependencies: ExtensionPackageDependency[];
  changes: ExtensionPackageChange[];
  noChanges: boolean;
  updatePreview?: ExtensionPackageUpdatePreview;
}

export interface ExtensionPackageDeploymentPreview {
  kind: "napier.extension-package-deployment-preview";
  schemaVersion: 1;
  apiVersion: string;
  candidateCount: number;
  installCount: number;
  updateCount: number;
  items: ExtensionPackageDeploymentItem[];
  applyOrder: string[];
  resolutions: ExtensionPackageDependencyResolution[];
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  noChanges: boolean;
  resetsLocalReview: true;
  generatedAt: string;
  contentSha256: string;
}

export interface PreviewExtensionPackageDeploymentRequest {
  envelopes: unknown[];
}

export interface ApplyExtensionPackageDeploymentRequest {
  threadId: string;
  envelopes: unknown[];
  expectedDeploymentSha256: string;
  confirmPublisherChanges?: boolean;
  confirmVersionOverrides?: boolean;
}

export interface ApplyExtensionPackageDeploymentResult {
  extensions: ExtensionRecord[];
  preview: ExtensionPackageDeploymentPreview;
  installedExtensionIds: string[];
  updatedExtensionIds: string[];
}

export interface ExtensionPackageLockfileEntry {
  normalizedName: string;
  version: string;
  publisher: string;
  keyId: string;
  manifestSha256: string;
  envelopeSha256: string;
  dependencies: ExtensionPackageDependency[];
  envelope: SignedExtensionPackageEnvelope;
}

export interface ExtensionPackageLockfile {
  kind: "napier.extension-package-lockfile";
  schemaVersion: 1;
  apiVersion: string;
  packages: ExtensionPackageLockfileEntry[];
  generatedAt: string;
  contentSha256: string;
}

export type ExtensionPackageLockfileVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid";

export interface ExtensionPackageLockfileVerification {
  status: ExtensionPackageLockfileVerificationStatus;
  verifiedAt: string;
  packageCount: number;
  lockfileSha256?: string;
  packageEnvelopeSha256es: string[];
  reason: string;
}

export interface ExportExtensionPackageLockfileRequest {
  threadId: string;
  extensionIds?: string[];
}

export interface VerifyExtensionPackageLockfileRequest {
  lockfile: unknown;
}

export interface ExtensionPackageRolloutPolicy {
  kind: "napier.extension-package-rollout-policy";
  schemaVersion: 1;
  maxPackages: number;
  requireTrustedPublishers: true;
  requireDependencyClosure: true;
  allowedPublisherKeyIds: string[];
  allowedPackageNames: string[];
}

export interface ExtensionPackageRolloutChannel {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  status: "active";
  policy: ExtensionPackageRolloutPolicy;
  lockfile: ExtensionPackageLockfile;
  lockfileSha256: string;
  packageCount: number;
  dependencyCount: number;
  packageEnvelopeIdsSha256: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

export interface PublishExtensionPackageRolloutChannelRequest {
  threadId: string;
  name: string;
  description?: string;
  extensionIds?: string[];
  expectedRevision?: number;
  policy?: {
    maxPackages?: number;
    allowedPublisherKeyIds?: string[];
    allowedPackageNames?: string[];
  };
}

export interface ExtensionPackageRolloutPreview {
  kind: "napier.extension-package-rollout-preview";
  schemaVersion: 1;
  apiVersion: string;
  channelId: string;
  channelName: string;
  channelRevision: number;
  policy: ExtensionPackageRolloutPolicy;
  lockfileSha256: string;
  verification: ExtensionPackageLockfileVerification;
  deploymentPreview: ExtensionPackageDeploymentPreview;
  generatedAt: string;
  contentSha256: string;
}

export interface PreviewExtensionPackageRolloutChannelRequest {
  channelId: string;
}

export interface ApplyExtensionPackageRolloutChannelRequest {
  threadId: string;
  channelId: string;
  expectedRolloutSha256: string;
  expectedDeploymentSha256: string;
  confirmPublisherChanges?: boolean;
  confirmVersionOverrides?: boolean;
}

export interface ApplyExtensionPackageRolloutChannelResult {
  channel: ExtensionPackageRolloutChannel;
  rolloutPreview: ExtensionPackageRolloutPreview;
  deployment: ApplyExtensionPackageDeploymentResult;
}

export interface ExtensionPackageChannelIndexEntry {
  name: string;
  normalizedName: string;
  channelRevision: number;
  channelSha256: string;
  lockfileSha256: string;
  lockfileLocator?: string;
  packageCount: number;
  dependencyCount: number;
  packageEnvelopeIdsSha256: string;
  policySha256: string;
}

export interface ExtensionPackageChannelIndex {
  kind: "napier.extension-package-channel-index";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  channels: ExtensionPackageChannelIndexEntry[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface ExtensionPackageChannelIndexSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  indexArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedExtensionPackageChannelIndexEnvelope {
  kind: "napier.signed-extension-package-channel-index";
  schemaVersion: 1;
  apiVersion: string;
  index: ExtensionPackageChannelIndex;
  signature: ExtensionPackageChannelIndexSignature;
  contentSha256: string;
}

export type ExtensionPackageChannelIndexVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid";

export interface ExtensionPackageChannelIndexVerification {
  status: ExtensionPackageChannelIndexVerificationStatus;
  verifiedAt: string;
  channelCount: number;
  indexSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignExtensionPackageChannelIndexRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  channelIds?: string[];
  lockfileBaseUrl?: string;
  expiresAt?: string;
}

export interface VerifyExtensionPackageChannelIndexRequest {
  envelope: unknown;
}

export type ExtensionPackageVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid" | "configuration_drift" | "executable_mismatch";

export interface ExtensionPackageVerification {
  status: ExtensionPackageVerificationStatus;
  verifiedAt: string;
  signatureValid: boolean;
  integrityValid: boolean;
  configurationValid: boolean;
  executableValid?: boolean;
  publisher?: string;
  packageName?: string;
  packageVersion?: string;
  keyId?: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  transportSha256?: string;
  reason: string;
}

export interface CreateMcpExtensionRequest {
  name: string;
  description?: string;
  version?: string;
  transport: McpTransportConfig;
  requestedCapabilities?: ExtensionCapability[];
  threadId?: string;
}

export interface SignExtensionPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  dependencies?: ExtensionPackageDependency[];
  expiresAt?: string;
}

export interface VerifySignedExtensionPackageRequest {
  envelope: unknown;
}

export interface ImportSignedExtensionPackageRequest {
  threadId: string;
  envelope: unknown;
}

export interface PreviewExtensionPackageUpdateRequest {
  envelope: unknown;
}

export interface ApplyExtensionPackageUpdateRequest {
  threadId: string;
  envelope: unknown;
  expectedPackageBindingSha256: string;
  confirmPublisherChange?: boolean;
  confirmVersionOverride?: boolean;
}

export interface ReviewExtensionRequest {
  action: "approve" | "reject";
  approvedCapabilities?: ExtensionCapability[];
  note?: string;
  threadId?: string;
}

export interface SetExtensionEnabledRequest {
  agentId: string;
  enabled: boolean;
  threadId?: string;
}

export interface ReviewMcpToolRequest {
  action: "approve" | "reject";
  effect?: McpToolEffect;
  routingHint?: string;
  note?: string;
  threadId?: string;
}

export interface PromptVariableSnapshotEntry {
  name: string;
  type: PromptVariableDefinition["type"];
  valueBytes: number;
  valueSha256: string;
  referenceCount: number;
}

export interface PromptVariableSnapshot {
  kind: "napier.prompt-variable-snapshot";
  schemaVersion: 1;
  resolvedAt: string;
  definitionCount: number;
  referencedVariableCount: number;
  referenceCount: number;
  unresolvedReferenceCount: number;
  unresolvedNameSetSha256: string;
  catalogSha256: string;
  renderedSystemPromptSha256: string;
  skillCatalogInjected: boolean;
  entries: PromptVariableSnapshotEntry[];
  contentSha256: string;
}
