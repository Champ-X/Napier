import type {
  CreateExtensionPublisherTrustAnchorSource,
  ExtensionPackageDependency,
  ExtensionPackageChannelIndexVerificationStatus,
  ExtensionPackageLockfileVerificationStatus,
  ExtensionPackageVerificationStatus,
} from "@napier/contracts";

export interface ExtensionPublisherDraft {
  label: string;
  source: CreateExtensionPublisherTrustAnchorSource;
}

export interface ExtensionPackageSignDraft {
  trustAnchorId: string;
  publisher: string;
  dependencies?: ExtensionPackageDependency[];
  expiresAt?: string;
}

export interface ExtensionPackageReceipt {
  action:
    | "signed"
    | "verified"
    | "imported"
    | "updated"
    | "deployed"
    | "rollout_published"
    | "rollout_applied"
    | "lockfile_verified"
    | "lockfile_exported"
    | "channel_index_signed"
    | "channel_index_verified";
  status:
    | ExtensionPackageVerificationStatus
    | ExtensionPackageLockfileVerificationStatus
    | ExtensionPackageChannelIndexVerificationStatus;
  reason: string;
  extensionId?: string;
  packageName?: string;
  packageVersion?: string;
  keyId?: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  indexSha256?: string;
  channelCount?: number;
}

export interface ExtensionPackageUpdateConfirmation {
  publisherChange: boolean;
  versionOverride: boolean;
}

export interface ExtensionPackageDeploymentConfirmation {
  publisherChanges: boolean;
  versionOverrides: boolean;
}
