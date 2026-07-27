import type {
  CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  DiscoverReceiptTrustAnchorDirectoryRequest,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
} from "@napier/contracts";

export const DISCOVERED_DIRECTORY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type QualifiedReceiptTrustAnchorDirectoryDiscoveryRequest =
  DiscoverReceiptTrustAnchorDirectoryRequest & {
    policy: ReceiptTrustAnchorDirectoryVerificationPolicy;
  };

export type QualifiedReceiptTrustAnchorDirectorySubscriptionRequest =
  CreateReceiptTrustAnchorDirectorySubscriptionRequest;

export type ReceiptTrustDirectoryBaselineSourceStatus =
  | "aligned"
  | "directory_drift"
  | "anchor_set_drift"
  | "no_last_good"
  | "missing_subscription";

export interface ReceiptTrustDirectoryBaselineSourceProjection {
  sourceOriginSha256: string;
  status: ReceiptTrustDirectoryBaselineSourceStatus;
  subscriptionId?: string;
  subscriptionLabel?: string;
  currentAnchorSetSha256?: string;
  currentDirectorySha256?: string;
}

export interface ReceiptTrustDirectoryBaselineActivationProjection {
  baselineCount: number;
  latestBaseline?: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  selectedSourceOriginSha256s: string[];
  metadataPublisherSha256s: string[];
  metadataSignerKeyIds: string[];
  alignedSourceCount: number;
  driftedSourceCount: number;
  missingSourceCount: number;
  sourceProjections: ReceiptTrustDirectoryBaselineSourceProjection[];
}

export function qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
  sourceUrl: string,
  expectedAnchorSetSha256: string,
): QualifiedReceiptTrustAnchorDirectoryDiscoveryRequest | undefined {
  const normalizedSourceUrl = normalizeDirectorySourceUrl(sourceUrl);
  const normalizedAnchorSetSha256 = expectedAnchorSetSha256
    .trim()
    .toLowerCase();
  if (
    !normalizedSourceUrl ||
    (normalizedAnchorSetSha256 &&
      !/^[a-f0-9]{64}$/.test(normalizedAnchorSetSha256))
  ) {
    return undefined;
  }
  return {
    sourceUrl: normalizedSourceUrl,
    policy: {
      maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
      minimumTrustedCount: 1,
      ...(normalizedAnchorSetSha256
        ? { expectedAnchorSetSha256: normalizedAnchorSetSha256 }
        : {}),
    },
  };
}

export function qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
  threadId: string,
  label: string,
  sourceUrl: string,
  expectedAnchorSetSha256: string,
): QualifiedReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const discovery = qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
    sourceUrl,
    expectedAnchorSetSha256,
  );
  const normalizedLabel = label.trim();
  if (
    !discovery ||
    !/^thread_[a-z0-9]{8,80}$/.test(threadId) ||
    normalizedLabel.length < 1 ||
    normalizedLabel.length > 100
  ) {
    return undefined;
  }
  return {
    threadId,
    label: normalizedLabel,
    sourceUrl: discovery.sourceUrl,
    refreshIntervalMs: DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
    policy: discovery.policy,
  };
}

export function projectReceiptTrustDirectoryBaselineActivation(
  baselines: readonly ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[],
  subscriptions: readonly ReceiptTrustAnchorDirectorySubscription[],
): ReceiptTrustDirectoryBaselineActivationProjection {
  const sortedBaselines = [...baselines].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const latestBaseline = sortedBaselines.at(-1);
  if (!latestBaseline) {
    return {
      baselineCount: baselines.length,
      selectedSourceOriginSha256s: [],
      metadataPublisherSha256s: [],
      metadataSignerKeyIds: [],
      alignedSourceCount: 0,
      driftedSourceCount: 0,
      missingSourceCount: 0,
      sourceProjections: [],
    };
  }
  const selectedSources = latestBaseline.envelope.receipt.quorum.sources.filter(
    (source) => source.anchorSetSha256 === latestBaseline.selectedAnchorSetSha256,
  );
  const selectedSourceOriginSha256s = sortedUnique(
    selectedSources.map((source) => source.sourceOriginSha256),
  );
  const sourceProjections = selectedSourceOriginSha256s.map((origin) =>
    projectBaselineSource(
      origin,
      latestBaseline,
      subscriptions.find(
        (subscription) =>
          subscription.status === "active" &&
          subscription.sourceOriginSha256 === origin,
      ),
    ),
  );
  const driftedSourceCount = sourceProjections.filter(
    (source) =>
      source.status === "directory_drift" ||
      source.status === "anchor_set_drift",
  ).length;
  const missingSourceCount = sourceProjections.filter(
    (source) =>
      source.status === "missing_subscription" ||
      source.status === "no_last_good",
  ).length;
  return {
    baselineCount: baselines.length,
    latestBaseline,
    selectedSourceOriginSha256s,
    metadataPublisherSha256s: sortedUnique(
      latestBaseline.envelope.receipt.selectedMetadata.flatMap((metadata) =>
        metadata.publisherSha256 ? [metadata.publisherSha256] : [],
      ),
    ),
    metadataSignerKeyIds: sortedUnique(
      latestBaseline.envelope.receipt.selectedMetadata.flatMap((metadata) =>
        metadata.signerKeyId ? [metadata.signerKeyId] : [],
      ),
    ),
    alignedSourceCount: sourceProjections.filter(
      (source) => source.status === "aligned",
    ).length,
    driftedSourceCount,
    missingSourceCount,
    sourceProjections,
  };
}

export function buildReceiptTrustDirectoryBaselineImportPolicy(
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  subscriptions: readonly ReceiptTrustAnchorDirectorySubscription[],
  currentDirectory?: ReceiptTrustAnchorDirectory,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy {
  const projection = projectReceiptTrustDirectoryBaselineActivation(
    [baseline],
    subscriptions,
  );
  const alignedSourceOrigins = projection.sourceProjections
    .filter((source) => source.status === "aligned")
    .map((source) => source.sourceOriginSha256);
  return {
    maxBaselineAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
    maxReceiptAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
    maxSourceObservedAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
    minimumAgreementCount: baseline.envelope.receipt.quorum.policy
      .minimumAgreementCount,
    minimumAgreementWeight: baseline.envelope.receipt.quorum.policy
      .minimumAgreementWeight,
    minimumDistinctSourceOrigins:
      baseline.envelope.receipt.quorum.policy.minimumDistinctSourceOrigins,
    minimumMetadataPublisherCount:
      baseline.envelope.receipt.quorum.policy.minimumMetadataPublisherCount,
    minimumSelectedMetadataCount:
      baseline.envelope.receipt.selectedMetadataCount > 0 ? 1 : 0,
    expectedAnchorSetSha256:
      currentDirectory?.anchorSetSha256 ?? baseline.selectedAnchorSetSha256,
    expectedDirectorySha256:
      currentDirectory?.contentSha256 ?? baseline.selectedDirectorySha256,
    requiredSourceOriginSha256s:
      alignedSourceOrigins.length > 0
        ? sortedUnique(alignedSourceOrigins)
        : projection.selectedSourceOriginSha256s,
    requiredMetadataPublisherSha256s: projection.metadataPublisherSha256s,
    requiredMetadataSignerKeyIds: projection.metadataSignerKeyIds,
  };
}

function normalizeDirectorySourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function projectBaselineSource(
  sourceOriginSha256: string,
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  subscription: ReceiptTrustAnchorDirectorySubscription | undefined,
): ReceiptTrustDirectoryBaselineSourceProjection {
  if (!subscription) {
    return {
      sourceOriginSha256,
      status: "missing_subscription",
    };
  }
  const currentDirectory = subscription.lastGoodDiscovery?.directory;
  if (!currentDirectory) {
    return {
      sourceOriginSha256,
      status: "no_last_good",
      subscriptionId: subscription.id,
      subscriptionLabel: subscription.label,
    };
  }
  const status: ReceiptTrustDirectoryBaselineSourceStatus =
    currentDirectory.anchorSetSha256 !== baseline.selectedAnchorSetSha256
      ? "anchor_set_drift"
      : currentDirectory.contentSha256 !== baseline.selectedDirectorySha256
        ? "directory_drift"
        : "aligned";
  return {
    sourceOriginSha256,
    status,
    subscriptionId: subscription.id,
    subscriptionLabel: subscription.label,
    currentAnchorSetSha256: currentDirectory.anchorSetSha256,
    currentDirectorySha256: currentDirectory.contentSha256,
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}
