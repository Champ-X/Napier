import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectoryMetadataReceipt,
  type ReceiptTrustAnchorDirectoryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumCandidate,
  type ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  type ReceiptTrustAnchorDirectoryQuorumMetadataInput,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  type ReceiptTrustAnchorDirectoryQuorumPromotionMetadata,
  type ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  type ReceiptTrustAnchorDirectoryQuorumSource,
  type ReceiptTrustAnchorDirectoryQuorumSourceMetadata,
  type ReceiptTrustAnchorDirectoryQuorumSourceWeight,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyProjection,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshStatus,
  type ReceiptTrustAnchorDirectorySubscriptionStatus,
  type ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry,
  type ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus,
  type ReceiptTrustAnchorDirectoryVerification,
  type TrustedReceiptEnvelope,
} from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import {
  hashReceiptTrustAnchorDirectoryVerificationPolicy,
  normalizeReceiptTrustAnchorDirectoryVerificationPolicy,
  receiptTrustAnchorsFromDirectory,
  validateReceiptTrustAnchorDirectory,
  validateTrustedReceiptEnvelope,
  verifyTrustedReceiptEnvelope,
} from "./receipt-trust.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUBSCRIPTION_ID_PATTERN = /^trustdir_[a-f0-9]{20}$/;

export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTION_TRANSPARENCY_ENTRIES = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT = 10;
export const MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES = 20;
export const MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
export const MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS =
  30 * 24 * 60 * 60 * 1_000;

export interface ReceiptTrustAnchorDirectorySubscriptionClaimState {
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface PersistedReceiptTrustAnchorDirectorySubscription extends ReceiptTrustAnchorDirectorySubscription {
  sourceUrl: string;
  claim?: ReceiptTrustAnchorDirectorySubscriptionClaimState;
  claimTokenSha256?: string;
}

export interface ReceiptTrustAnchorDirectorySubscriptionClaim {
  subscription: ReceiptTrustAnchorDirectorySubscription;
  sourceUrl: string;
  token: string;
}

export function createReceiptTrustAnchorDirectorySubscription(
  request: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  discoveryInput: unknown,
  createdAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectorySubscription {
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    request.sourceUrl,
  );
  const label = normalizeLabel(request.label);
  const refreshIntervalMs = normalizeRefreshInterval(request.refreshIntervalMs);
  const policy = normalizeReceiptTrustAnchorDirectoryVerificationPolicy(
    request.policy,
  );
  if (!policy) {
    throw new Error(
      "Receipt trust anchor directory subscription policy is required",
    );
  }
  const policySha256 =
    hashReceiptTrustAnchorDirectoryVerificationPolicy(policy);
  const discovery =
    validateReceiptTrustAnchorDirectoryDiscovery(discoveryInput);
  assertDiscoveryBinding(discovery, sourceUrl, policySha256);
  if (discovery.status !== "valid" || !discovery.directory) {
    throw new Error(
      "Receipt trust anchor directory subscription requires a valid discovery",
    );
  }
  const now = requireTimestamp(createdAt, "subscription creation time");
  const transparencyEntry = createTransparencyEntry({
    discovery,
    status: "promoted",
    observedAt: now,
  });
  const content = {
    kind: "napier.receipt-trust-anchor-directory-subscription" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    id: createId("trustdir"),
    auditThreadId: request.threadId,
    label,
    status: "active" as const,
    revision: 1,
    sourceUrlSha256: sha256(sourceUrl.href),
    sourceOriginSha256: sha256(sourceUrl.origin),
    refreshIntervalMs,
    nextRefreshAt: new Date(Date.parse(now) + refreshIntervalMs).toISOString(),
    policy,
    policySha256,
    lastRefreshAt: now,
    lastRefreshStatus: "promoted" as const,
    lastDiscoverySha256: discovery.contentSha256,
    lastGoodDiscovery: discovery,
    transparencyEntryCount: transparencyEntry.sequence,
    transparencyTailSha256: transparencyEntry.contentSha256,
    transparencyHistory: [transparencyEntry],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...content,
    contentSha256: hashSubscriptionContent(content),
    sourceUrl: sourceUrl.href,
  };
}

export function updateReceiptTrustAnchorDirectorySubscriptionStatus(
  input: PersistedReceiptTrustAnchorDirectorySubscription,
  status: ReceiptTrustAnchorDirectorySubscriptionStatus,
  updatedAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectorySubscription {
  const current =
    validatePersistedReceiptTrustAnchorDirectorySubscription(input);
  if (status !== "active" && status !== "paused") {
    throw new Error(
      "Receipt trust anchor directory subscription status is invalid",
    );
  }
  if (current.status === status) return current;
  const content = {
    ...subscriptionContent(current),
    status,
    revision: current.revision + 1,
    updatedAt: requireTimestamp(updatedAt, "subscription update time"),
  };
  return {
    ...content,
    contentSha256: hashSubscriptionContent(content),
    sourceUrl: current.sourceUrl,
  };
}

export function settleReceiptTrustAnchorDirectorySubscriptionRefresh(
  input: PersistedReceiptTrustAnchorDirectorySubscription,
  outcome: { discovery: unknown } | { failureSha256: string },
  refreshedAt = new Date().toISOString(),
): {
  persisted: PersistedReceiptTrustAnchorDirectorySubscription;
  result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
} {
  const current =
    validatePersistedReceiptTrustAnchorDirectorySubscription(input);
  const refreshTime = requireTimestamp(
    refreshedAt,
    "subscription refresh time",
  );
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    current.sourceUrl,
  );
  let discovery: ReceiptTrustAnchorDirectoryDiscovery | undefined;
  let failureSha256: string | undefined;
  let status: ReceiptTrustAnchorDirectorySubscriptionRefreshStatus;
  let lastGoodDiscovery = current.lastGoodDiscovery;
  let transparencyHistory = current.transparencyHistory;
  let transparencyEntryCount = current.transparencyEntryCount;
  let transparencyTailSha256 = current.transparencyTailSha256;

  if ("discovery" in outcome) {
    discovery = validateReceiptTrustAnchorDirectoryDiscovery(outcome.discovery);
    assertDiscoveryBinding(discovery, sourceUrl, current.policySha256);
    if (discovery.status === "valid" && discovery.directory) {
      const directorySha256 = discovery.directory.contentSha256;
      const currentDirectorySha256 =
        current.lastGoodDiscovery?.directory?.contentSha256;
      const isKnownRollback =
        directorySha256 !== currentDirectorySha256 &&
        current.transparencyHistory.some(
          (entry) => entry.directorySha256 === directorySha256,
        );
      if (isKnownRollback) {
        status = "rollback_rejected";
      } else {
        const transparencyStatus: ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus =
          directorySha256 === currentDirectorySha256 ? "unchanged" : "promoted";
        status = transparencyStatus;
        lastGoodDiscovery = discovery;
        transparencyHistory = appendTransparencyEntry(
          current.transparencyHistory,
          createTransparencyEntry({
            discovery,
            status: transparencyStatus,
            observedAt: refreshTime,
            previousSequence: current.transparencyEntryCount,
            ...(current.transparencyTailSha256
              ? { previousEntrySha256: current.transparencyTailSha256 }
              : {}),
          }),
        );
        transparencyEntryCount =
          transparencyHistory.at(-1)?.sequence ??
          current.transparencyEntryCount;
        transparencyTailSha256 =
          transparencyHistory.at(-1)?.contentSha256 ??
          current.transparencyTailSha256;
      }
    } else {
      status = "rejected";
    }
  } else {
    if (!SHA256_PATTERN.test(outcome.failureSha256)) {
      throw new Error(
        "Receipt trust anchor directory subscription failure hash is invalid",
      );
    }
    status = "failed";
    failureSha256 = outcome.failureSha256;
  }

  const {
    lastDiscoverySha256: _lastDiscoverySha256,
    lastFailureSha256: _lastFailureSha256,
    ...currentContent
  } = subscriptionContent(current);
  const content = {
    ...currentContent,
    revision: current.revision + 1,
    nextRefreshAt: new Date(
      Date.parse(refreshTime) + current.refreshIntervalMs,
    ).toISOString(),
    lastRefreshAt: refreshTime,
    lastRefreshStatus: status,
    ...(discovery ? { lastDiscoverySha256: discovery.contentSha256 } : {}),
    ...(failureSha256 ? { lastFailureSha256: failureSha256 } : {}),
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyEntryCount,
    ...(transparencyTailSha256 ? { transparencyTailSha256 } : {}),
    transparencyHistory,
    updatedAt: refreshTime,
  };
  const persisted: PersistedReceiptTrustAnchorDirectorySubscription = {
    ...content,
    contentSha256: hashSubscriptionContent(content),
    sourceUrl: current.sourceUrl,
  };
  const subscription =
    stripReceiptTrustAnchorDirectorySubscriptionSecrets(persisted);
  const resultContent = {
    kind: "napier.receipt-trust-anchor-directory-subscription-refresh" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    subscription,
    ...(discovery ? { discovery } : {}),
    ...(failureSha256 ? { failureSha256 } : {}),
  };
  return {
    persisted,
    result: {
      ...resultContent,
      contentSha256: sha256(canonicalJson(resultContent)),
    },
  };
}

export function createReceiptTrustAnchorDirectorySubscriptionQuorum(
  subscriptions: ReceiptTrustAnchorDirectorySubscription[],
  policy?: ReceiptTrustAnchorDirectoryQuorumPolicy,
  metadataEvidence: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[] = [],
): ReceiptTrustAnchorDirectoryQuorum {
  const normalizedPolicy =
    normalizeReceiptTrustAnchorDirectoryQuorumPolicy(policy);
  const metadataBySubscriptionId =
    receiptTrustAnchorDirectoryQuorumMetadataEvidenceBySubscriptionId(
      metadataEvidence,
    );
  const sources = subscriptions
    .map(validateReceiptTrustAnchorDirectorySubscription)
    .filter(
      (subscription) =>
        subscription.status === "active" &&
        Boolean(subscription.lastGoodDiscovery?.directory),
    )
    .map((subscription) =>
      createQuorumSource(
        subscription,
        normalizedPolicy,
        metadataBySubscriptionId.get(subscription.id),
      ),
    )
    .sort((left, right) =>
      left.subscriptionId.localeCompare(right.subscriptionId),
    );
  const sourceGroups = new Map<
    string,
    ReceiptTrustAnchorDirectoryQuorumSource[]
  >();
  for (const source of sources) {
    const group = sourceGroups.get(source.anchorSetSha256) ?? [];
    group.push(source);
    sourceGroups.set(source.anchorSetSha256, group);
  }
  const candidates = Array.from(sourceGroups.entries())
    .map(([anchorSetSha256, group]) =>
      createQuorumCandidate(anchorSetSha256, group),
    )
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        right.sourceCount - left.sourceCount ||
        left.anchorSetSha256.localeCompare(right.anchorSetSha256),
    );
  const winner = candidates.at(0);
  const agreementCount = winner?.sourceCount ?? 0;
  const agreementWeight = winner?.weight ?? 0;
  const agreementDistinctSourceOriginCount =
    winner?.distinctSourceOriginCount ?? 0;
  const winningSourceOrigins = new Set(
    winner
      ? sources
          .filter((source) => source.anchorSetSha256 === winner.anchorSetSha256)
          .map((source) => source.sourceOriginSha256)
      : [],
  );
  const winningMetadataPublishers = metadataPublisherSetForSources(
    winner
      ? sources.filter(
          (source) => source.anchorSetSha256 === winner.anchorSetSha256,
        )
      : [],
  );
  const requiredSourceOriginMissing =
    normalizedPolicy.requiredSourceOriginSha256s.some(
      (originSha256) => !winningSourceOrigins.has(originSha256),
    );
  const requiredMetadataPublisherMissing =
    normalizedPolicy.requiredMetadataPublisherSha256s.some(
      (publisherSha256) => !winningMetadataPublishers.has(publisherSha256),
    );
  const selectedSource = winner
    ? sources
        .filter((source) => source.anchorSetSha256 === winner.anchorSetSha256)
        .sort(
          (left, right) =>
            right.observedAt.localeCompare(left.observedAt) ||
            left.subscriptionId.localeCompare(right.subscriptionId),
        )
        .at(0)
    : undefined;
  const selectedSubscription = selectedSource
    ? subscriptions
        .map(validateReceiptTrustAnchorDirectorySubscription)
        .find(
          (subscription) => subscription.id === selectedSource.subscriptionId,
        )
    : undefined;
  const selectedDirectory = selectedSubscription?.lastGoodDiscovery?.directory;
  const diagnostics: string[] = [];
  if (sources.length < normalizedPolicy.minimumSources) {
    diagnostics.push("insufficient_sources");
  }
  if (agreementCount < normalizedPolicy.minimumAgreementCount) {
    diagnostics.push("insufficient_agreement");
  }
  if (agreementWeight < normalizedPolicy.minimumAgreementWeight) {
    diagnostics.push("insufficient_agreement_weight");
  }
  if (
    agreementDistinctSourceOriginCount <
    normalizedPolicy.minimumDistinctSourceOrigins
  ) {
    diagnostics.push("insufficient_distinct_source_origins");
  }
  if (
    normalizedPolicy.expectedAnchorSetSha256 &&
    winner?.anchorSetSha256 !== normalizedPolicy.expectedAnchorSetSha256
  ) {
    diagnostics.push("anchor_set_unexpected");
  }
  if (requiredSourceOriginMissing) {
    diagnostics.push("required_source_origin_missing");
  }
  if (
    winningMetadataPublishers.size <
    normalizedPolicy.minimumMetadataPublisherCount
  ) {
    diagnostics.push("insufficient_metadata_publishers");
  }
  if (requiredMetadataPublisherMissing) {
    diagnostics.push("required_metadata_publisher_missing");
  }
  const expectedAnchorSetMismatched = Boolean(
    normalizedPolicy.expectedAnchorSetSha256 &&
      winner?.anchorSetSha256 !== normalizedPolicy.expectedAnchorSetSha256,
  );
  const quorumAgreed =
    agreementCount >= normalizedPolicy.minimumAgreementCount &&
    agreementWeight >= normalizedPolicy.minimumAgreementWeight &&
    agreementDistinctSourceOriginCount >=
      normalizedPolicy.minimumDistinctSourceOrigins &&
    winningMetadataPublishers.size >=
      normalizedPolicy.minimumMetadataPublisherCount;
  const status: ReceiptTrustAnchorDirectoryQuorum["status"] =
    sources.length < normalizedPolicy.minimumSources
      ? "insufficient_sources"
      : expectedAnchorSetMismatched ||
          requiredSourceOriginMissing ||
          requiredMetadataPublisherMissing
        ? "policy_failed"
        : quorumAgreed
          ? "agreed"
          : "split";
  const policySha256 = sha256(canonicalJson(normalizedPolicy));
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    policy: normalizedPolicy,
    policySha256,
    sourceCount: sources.length,
    candidateCount: candidates.length,
    agreementCount,
    agreementWeight,
    agreementDistinctSourceOriginCount,
    agreementMetadataPublisherCount: winningMetadataPublishers.size,
    agreementMetadataPublisherSetSha256: sha256(
      canonicalJson([...winningMetadataPublishers].sort()),
    ),
    ...(winner ? { selectedAnchorSetSha256: winner.anchorSetSha256 } : {}),
    ...(selectedDirectory
      ? {
          selectedDirectorySha256: selectedDirectory.contentSha256,
          selectedDirectory,
        }
      : {}),
    sources,
    candidates,
  };
  return {
    ...content,
    generatedAt: new Date().toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
  quorumInput: ReceiptTrustAnchorDirectoryQuorum,
  metadataInputs: ReceiptTrustAnchorDirectoryQuorumMetadataInput[] = [],
): ReceiptTrustAnchorDirectoryQuorumPromotionReceipt {
  const quorum = validateReceiptTrustAnchorDirectoryQuorum(quorumInput);
  if (
    quorum.status !== "agreed" ||
    !quorum.selectedAnchorSetSha256 ||
    !quorum.selectedDirectorySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion requires an agreed quorum",
    );
  }
  const selectedSources = quorum.sources.filter(
    (source) => source.anchorSetSha256 === quorum.selectedAnchorSetSha256,
  );
  const selectedSubscriptionIds = selectedSources
    .map((source) => source.subscriptionId)
    .sort();
  const metadataBySubscriptionId = new Map(
    metadataInputs.map((input) => [input.subscriptionId, input.envelope]),
  );
  const selectedMetadata = selectedSources
    .flatMap((source) => {
      if (
        source.metadata?.status !== "trusted" ||
        !source.metadata.directoryBindingValid ||
        !source.metadata.envelopeSha256 ||
        !source.metadata.verificationSha256
      ) {
        return [];
      }
      const envelopeInput = metadataBySubscriptionId.get(source.subscriptionId);
      if (envelopeInput === undefined) return [];
      const envelope = validateTrustedReceiptEnvelope(
        envelopeInput,
      ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryMetadataReceipt>;
      if (
        envelope.receiptKind !== "receipt_trust_anchor_directory_metadata" ||
        envelope.contentSha256 !== source.metadata.envelopeSha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum promotion metadata does not match source evidence",
        );
      }
      const metadataContent = {
        subscriptionId: source.subscriptionId,
        envelope,
        envelopeSha256: envelope.contentSha256,
        verificationSha256: source.metadata.verificationSha256,
        ...(source.metadata.publisherSha256
          ? { publisherSha256: source.metadata.publisherSha256 }
          : {}),
        ...(source.metadata.signerKeyId
          ? { signerKeyId: source.metadata.signerKeyId }
          : {}),
      };
      return [
        {
          ...metadataContent,
          contentSha256: sha256(canonicalJson(metadataContent)),
        },
      ];
    })
    .sort((left, right) =>
      left.subscriptionId.localeCompare(right.subscriptionId),
    );
  const metadataEnvelopeHashes = Array.from(
    new Set(selectedMetadata.map((metadata) => metadata.envelopeSha256)),
  ).sort();
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-promotion" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    quorum,
    selectedAnchorSetSha256: quorum.selectedAnchorSetSha256,
    selectedDirectorySha256: quorum.selectedDirectorySha256,
    selectedSubscriptionCount: selectedSubscriptionIds.length,
    selectedSubscriptionSetSha256: sha256(
      canonicalJson(selectedSubscriptionIds),
    ),
    selectedMetadataCount: selectedMetadata.length,
    selectedMetadataEnvelopeSetSha256: sha256(
      canonicalJson(metadataEnvelopeHashes),
    ),
    selectedMetadata,
  };
  return {
    ...content,
    generatedAt: new Date().toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumPromotionReceipt {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion receipt is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "quorum",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedSubscriptionCount",
    "selectedSubscriptionSetSha256",
    "selectedMetadataCount",
    "selectedMetadataEnvelopeSetSha256",
    "selectedMetadata",
    "contentSha256",
  ]);
  const receipt =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumPromotionReceipt;
  const quorum = validateReceiptTrustAnchorDirectoryQuorum(receipt.quorum);
  const selectedMetadata = validateQuorumPromotionMetadataList(
    receipt.selectedMetadata,
  );
  const selectedSources = quorum.sources.filter(
    (source) => source.anchorSetSha256 === quorum.selectedAnchorSetSha256,
  );
  const selectedSubscriptionIds = selectedSources
    .map((source) => source.subscriptionId)
    .sort();
  const metadataEnvelopeHashes = Array.from(
    new Set(selectedMetadata.map((metadata) => metadata.envelopeSha256)),
  ).sort();
  if (
    receipt.kind !==
      "napier.receipt-trust-anchor-directory-quorum-promotion" ||
    receipt.schemaVersion !== 1 ||
    receipt.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(receipt.generatedAt) ||
    quorum.status !== "agreed" ||
    receipt.selectedAnchorSetSha256 !== quorum.selectedAnchorSetSha256 ||
    receipt.selectedDirectorySha256 !== quorum.selectedDirectorySha256 ||
    receipt.selectedSubscriptionCount !== selectedSubscriptionIds.length ||
    receipt.selectedSubscriptionSetSha256 !==
      sha256(canonicalJson(selectedSubscriptionIds)) ||
    receipt.selectedMetadataCount !== selectedMetadata.length ||
    receipt.selectedMetadataEnvelopeSetSha256 !==
      sha256(canonicalJson(metadataEnvelopeHashes)) ||
    !SHA256_PATTERN.test(receipt.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion receipt is invalid",
    );
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = {
    ...receipt,
    quorum,
    selectedMetadata,
  };
  if (sha256(canonicalJson(content)) !== receipt.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion receipt hash mismatch",
    );
  }
  return structuredClone({
    ...receipt,
    quorum,
    selectedMetadata,
  });
}

export function hashReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  baseline: Omit<
    ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
    "contentSha256"
  >,
): string {
  return sha256(canonicalJson(baseline));
}

export function createReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  envelopeInput: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  promotedByThreadId: string,
  supersedesBaselineId?: string,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
  const envelope = validateTrustedReceiptEnvelope(
    envelopeInput,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>;
  if (
    envelope.receiptKind !==
    "receipt_trust_anchor_directory_quorum_promotion"
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline requires a promotion receipt",
    );
  }
  const receipt = validateReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
    envelope.receipt,
  );
  const content = {
    id: createId("trustqpb"),
    envelope: {
      ...envelope,
      receipt,
    },
    promotedByThreadId,
    selectedAnchorSetSha256: receipt.selectedAnchorSetSha256,
    selectedDirectorySha256: receipt.selectedDirectorySha256,
    selectedSubscriptionSetSha256: receipt.selectedSubscriptionSetSha256,
    selectedMetadataEnvelopeSetSha256:
      receipt.selectedMetadataEnvelopeSetSha256,
    ...(supersedesBaselineId ? { supersedesBaselineId } : {}),
    createdAt: nowIso(),
  };
  return {
    ...content,
    contentSha256: hashReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
      content,
    ),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  value: unknown,
  anchors?: ReceiptTrustAnchor[],
): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline is invalid",
    );
  }
  assertAllowedKeys(value, [
    "id",
    "envelope",
    "promotedByThreadId",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedSubscriptionSetSha256",
    "selectedMetadataEnvelopeSetSha256",
    "supersedesBaselineId",
    "createdAt",
    "contentSha256",
  ]);
  const baseline =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  const envelope = validateTrustedReceiptEnvelope(
    baseline.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>;
  if (
    !/^trustqpb_[a-z0-9]{8,80}$/.test(baseline.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(baseline.promotedByThreadId) ||
    !SHA256_PATTERN.test(baseline.selectedAnchorSetSha256) ||
    !SHA256_PATTERN.test(baseline.selectedDirectorySha256) ||
    !SHA256_PATTERN.test(baseline.selectedSubscriptionSetSha256) ||
    !SHA256_PATTERN.test(baseline.selectedMetadataEnvelopeSetSha256) ||
    (baseline.supersedesBaselineId !== undefined &&
      !/^trustqpb_[a-z0-9]{8,80}$/.test(baseline.supersedesBaselineId)) ||
    !validTimestamp(baseline.createdAt) ||
    !SHA256_PATTERN.test(baseline.contentSha256) ||
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_promotion" ||
    envelope.receipt.selectedAnchorSetSha256 !==
      baseline.selectedAnchorSetSha256 ||
    envelope.receipt.selectedDirectorySha256 !==
      baseline.selectedDirectorySha256 ||
    envelope.receipt.selectedSubscriptionSetSha256 !==
      baseline.selectedSubscriptionSetSha256 ||
    envelope.receipt.selectedMetadataEnvelopeSetSha256 !==
      baseline.selectedMetadataEnvelopeSetSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline is invalid",
    );
  }
  if (anchors) {
    const verification = verifyTrustedReceiptEnvelope(
      envelope,
      receiptAnchorsForQuorumPromotionBaseline(envelope, anchors),
    );
    if (!verification.integrityValid || !verification.signatureValid) {
      throw new Error(
        `Receipt trust anchor directory quorum promotion baseline signature is invalid: ${verification.reason}`,
      );
    }
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...baseline,
    envelope,
  };
  if (
    hashReceiptTrustAnchorDirectoryQuorumPromotionBaseline(content) !==
    baseline.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline hash mismatch",
    );
  }
  return structuredClone({
    ...baseline,
    envelope,
  });
}

export function verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  value: unknown,
  anchors: ReceiptTrustAnchor[],
  options: {
    trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
  } = {},
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification {
  const verifiedAt = nowIso();
  let baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  try {
    baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(value);
  } catch {
    return createQuorumPromotionBaselineVerification({
      verifiedAt,
      status: "invalid",
      diagnostics: ["baseline_invalid"],
      baselineValid: false,
      signatureValid: false,
      integrityValid: false,
      ...(options.trustDirectoryVerification
        ? { trustDirectoryVerification: options.trustDirectoryVerification }
        : {}),
    });
  }
  if (options.trustDirectoryVerification?.status === "invalid") {
    return createQuorumPromotionBaselineVerification({
      verifiedAt,
      status: "invalid",
      diagnostics: ["trust_directory_invalid"],
      baselineValid: true,
      signatureValid: false,
      integrityValid: true,
      baseline,
      trustDirectoryVerification: options.trustDirectoryVerification,
    });
  }
  const trustedReceiptVerification = verifyTrustedReceiptEnvelope(
    baseline.envelope,
    anchors,
  );
  return createQuorumPromotionBaselineVerification({
    verifiedAt,
    status: trustedReceiptVerification.status,
    diagnostics: diagnosticsForTrustedReceiptVerification(
      trustedReceiptVerification.status,
    ),
    baselineValid: true,
    signatureValid: trustedReceiptVerification.signatureValid,
    integrityValid: trustedReceiptVerification.integrityValid,
    baseline,
    ...(options.trustDirectoryVerification
      ? { trustDirectoryVerification: options.trustDirectoryVerification }
      : {}),
  });
}

export function reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
  value: unknown,
  policyInput?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  reviewedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview {
  const reviewedAt = requireTimestamp(
    reviewedAtInput,
    "anchor directory quorum promotion baseline import policy review time",
  );
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
      policyInput,
    );
  let baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  try {
    baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(value);
  } catch {
    return createQuorumPromotionBaselineImportPolicyReview({
      reviewedAt,
      status: "rejected",
      diagnostics: ["baseline_invalid"],
      policy,
    });
  }
  const receipt = baseline.envelope.receipt;
  const selectedSources = receipt.quorum.sources.filter(
    (source) => source.anchorSetSha256 === receipt.selectedAnchorSetSha256,
  );
  const selectedSourceOrigins = Array.from(
    new Set(selectedSources.map((source) => source.sourceOriginSha256)),
  ).sort();
  const selectedMetadataPublishers = Array.from(
    new Set(
      receipt.selectedMetadata.flatMap((metadata) =>
        metadata.publisherSha256 ? [metadata.publisherSha256] : [],
      ),
    ),
  ).sort();
  const selectedMetadataSigners = Array.from(
    new Set(
      receipt.selectedMetadata.flatMap((metadata) =>
        metadata.signerKeyId ? [metadata.signerKeyId] : [],
      ),
    ),
  ).sort();
  const diagnostics: string[] = [];
  const reviewedAtMs = Date.parse(reviewedAt);
  if (
    policy.maxBaselineAgeMs > 0 &&
    reviewedAtMs - Date.parse(baseline.createdAt) > policy.maxBaselineAgeMs
  ) {
    diagnostics.push("baseline_stale");
  }
  if (
    policy.maxReceiptAgeMs > 0 &&
    reviewedAtMs - Date.parse(receipt.generatedAt) > policy.maxReceiptAgeMs
  ) {
    diagnostics.push("receipt_stale");
  }
  if (
    policy.maxSourceObservedAgeMs > 0 &&
    selectedSources.some(
      (source) =>
        reviewedAtMs - Date.parse(source.observedAt) >
        policy.maxSourceObservedAgeMs,
    )
  ) {
    diagnostics.push("source_observation_stale");
  }
  if (
    policy.minimumAgreementCount > 0 &&
    receipt.quorum.agreementCount < policy.minimumAgreementCount
  ) {
    diagnostics.push("insufficient_agreement_count");
  }
  if (
    policy.minimumAgreementWeight > 0 &&
    receipt.quorum.agreementWeight < policy.minimumAgreementWeight
  ) {
    diagnostics.push("insufficient_agreement_weight");
  }
  if (
    policy.minimumDistinctSourceOrigins > 0 &&
    receipt.quorum.agreementDistinctSourceOriginCount <
      policy.minimumDistinctSourceOrigins
  ) {
    diagnostics.push("insufficient_distinct_source_origins");
  }
  if (
    policy.minimumMetadataPublisherCount > 0 &&
    receipt.quorum.agreementMetadataPublisherCount <
      policy.minimumMetadataPublisherCount
  ) {
    diagnostics.push("insufficient_metadata_publishers");
  }
  if (
    policy.minimumSelectedMetadataCount > 0 &&
    receipt.selectedMetadataCount < policy.minimumSelectedMetadataCount
  ) {
    diagnostics.push("insufficient_selected_metadata");
  }
  if (
    policy.expectedAnchorSetSha256 &&
    baseline.selectedAnchorSetSha256 !== policy.expectedAnchorSetSha256
  ) {
    diagnostics.push("expected_anchor_set_mismatch");
  }
  if (
    policy.expectedDirectorySha256 &&
    baseline.selectedDirectorySha256 !== policy.expectedDirectorySha256
  ) {
    diagnostics.push("expected_directory_mismatch");
  }
  if (
    policy.requiredSourceOriginSha256s.some(
      (origin) => !selectedSourceOrigins.includes(origin),
    )
  ) {
    diagnostics.push("required_source_origin_missing");
  }
  if (
    policy.requiredMetadataPublisherSha256s.some(
      (publisher) => !selectedMetadataPublishers.includes(publisher),
    )
  ) {
    diagnostics.push("required_metadata_publisher_missing");
  }
  if (
    policy.requiredMetadataSignerKeyIds.some(
      (keyId) => !selectedMetadataSigners.includes(keyId),
    )
  ) {
    diagnostics.push("required_metadata_signer_missing");
  }
  return createQuorumPromotionBaselineImportPolicyReview({
    reviewedAt,
    status: diagnostics.length === 0 ? "accepted" : "rejected",
    diagnostics,
    policy,
    baseline,
    selectedSourceOrigins,
    selectedMetadataPublishers,
    selectedMetadataSigners,
  });
}

export function validateReceiptTrustAnchorDirectoryQuorum(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorum {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor directory quorum is invalid");
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "status",
    "diagnostics",
    "policy",
    "policySha256",
    "sourceCount",
    "candidateCount",
    "agreementCount",
    "agreementWeight",
    "agreementDistinctSourceOriginCount",
    "agreementMetadataPublisherCount",
    "agreementMetadataPublisherSetSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedDirectory",
    "sources",
    "candidates",
    "contentSha256",
  ]);
  const quorum = value as unknown as ReceiptTrustAnchorDirectoryQuorum;
  const policy = normalizeReceiptTrustAnchorDirectoryQuorumPolicy(
    quorum.policy,
  );
  const sources = validateQuorumSources(quorum.sources);
  const candidates = validateQuorumCandidates(quorum.candidates);
  const selectedDirectory =
    quorum.selectedDirectory === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectory(quorum.selectedDirectory);
  if (
    quorum.kind !== "napier.receipt-trust-anchor-directory-quorum" ||
    quorum.schemaVersion !== 1 ||
    quorum.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(quorum.generatedAt) ||
    (quorum.status !== "agreed" &&
      quorum.status !== "insufficient_sources" &&
      quorum.status !== "split" &&
      quorum.status !== "policy_failed") ||
    !validDiagnostics(quorum.diagnostics) ||
    sha256(canonicalJson(policy)) !== quorum.policySha256 ||
    quorum.sourceCount !== sources.length ||
    quorum.candidateCount !== candidates.length ||
    !nonNegativeInteger(quorum.agreementCount) ||
    !nonNegativeInteger(quorum.agreementWeight) ||
    !nonNegativeInteger(quorum.agreementDistinctSourceOriginCount) ||
    !nonNegativeInteger(quorum.agreementMetadataPublisherCount) ||
    !SHA256_PATTERN.test(quorum.agreementMetadataPublisherSetSha256) ||
    !optionalSha256(quorum.selectedAnchorSetSha256) ||
    !optionalSha256(quorum.selectedDirectorySha256) ||
    (selectedDirectory !== undefined &&
      quorum.selectedDirectorySha256 !== selectedDirectory.contentSha256) ||
    !SHA256_PATTERN.test(quorum.contentSha256)
  ) {
    throw new Error("Receipt trust anchor directory quorum is invalid");
  }
  const { generatedAt: _generatedAt, contentSha256: _contentSha256, ...content } =
    {
      ...quorum,
      policy,
      sources,
      candidates,
      ...(selectedDirectory ? { selectedDirectory } : {}),
    };
  if (sha256(canonicalJson(content)) !== quorum.contentSha256) {
    throw new Error("Receipt trust anchor directory quorum hash mismatch");
  }
  return structuredClone({
    ...quorum,
    policy,
    sources,
    candidates,
    ...(selectedDirectory ? { selectedDirectory } : {}),
  });
}

export function validatePersistedReceiptTrustAnchorDirectorySubscription(
  value: unknown,
): PersistedReceiptTrustAnchorDirectorySubscription {
  if (!isRecord(value) || typeof value["sourceUrl"] !== "string") {
    throw new Error(
      "Persisted receipt trust anchor directory subscription is invalid",
    );
  }
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    value["sourceUrl"],
  );
  const migrated = migrateReceiptTrustAnchorDirectorySubscription(value);
  const subscription =
    validateReceiptTrustAnchorDirectorySubscription(migrated);
  if (
    sha256(sourceUrl.href) !== subscription.sourceUrlSha256 ||
    sha256(sourceUrl.origin) !== subscription.sourceOriginSha256
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory subscription source hash mismatch",
    );
  }
  const claim = validateOptionalClaim(value["claim"]);
  const claimTokenSha256 = value["claimTokenSha256"];
  if (
    (claim === undefined) !== (claimTokenSha256 === undefined) ||
    (claimTokenSha256 !== undefined &&
      (typeof claimTokenSha256 !== "string" ||
        !SHA256_PATTERN.test(claimTokenSha256)))
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory subscription claim is invalid",
    );
  }
  return {
    ...subscription,
    sourceUrl: sourceUrl.href,
    ...(claim ? { claim } : {}),
    ...(typeof claimTokenSha256 === "string" ? { claimTokenSha256 } : {}),
  };
}

export function validateReceiptTrustAnchorDirectorySubscription(
  value: unknown,
): ReceiptTrustAnchorDirectorySubscription {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor directory subscription is invalid");
  }
  const subscription =
    value as unknown as ReceiptTrustAnchorDirectorySubscription;
  const policy = normalizeReceiptTrustAnchorDirectoryVerificationPolicy(
    subscription.policy,
  );
  const lastGoodDiscovery =
    subscription.lastGoodDiscovery === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryDiscovery(
          subscription.lastGoodDiscovery,
        );
  const transparencyHistory = validateTransparencyHistory(
    subscription.transparencyHistory,
  );
  const transparencyTail = transparencyHistory.at(-1);
  if (
    subscription.kind !==
      "napier.receipt-trust-anchor-directory-subscription" ||
    subscription.schemaVersion !== 1 ||
    subscription.apiVersion !== NAPIER_API_VERSION ||
    !SUBSCRIPTION_ID_PATTERN.test(subscription.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(subscription.auditThreadId) ||
    normalizeLabel(subscription.label) !== subscription.label ||
    (subscription.status !== "active" && subscription.status !== "paused") ||
    !Number.isSafeInteger(subscription.revision) ||
    subscription.revision < 1 ||
    !SHA256_PATTERN.test(subscription.sourceUrlSha256) ||
    !SHA256_PATTERN.test(subscription.sourceOriginSha256) ||
    normalizeRefreshInterval(subscription.refreshIntervalMs) !==
      subscription.refreshIntervalMs ||
    !policy ||
    hashReceiptTrustAnchorDirectoryVerificationPolicy(policy) !==
      subscription.policySha256 ||
    !validTimestamp(subscription.nextRefreshAt) ||
    !validTimestamp(subscription.createdAt) ||
    !validTimestamp(subscription.updatedAt) ||
    !optionalTimestamp(subscription.lastRefreshAt) ||
    !optionalRefreshStatus(subscription.lastRefreshStatus) ||
    !optionalSha256(subscription.lastDiscoverySha256) ||
    !optionalSha256(subscription.lastFailureSha256) ||
    !nonNegativeInteger(subscription.transparencyEntryCount) ||
    !optionalSha256(subscription.transparencyTailSha256) ||
    !SHA256_PATTERN.test(subscription.contentSha256)
  ) {
    throw new Error("Receipt trust anchor directory subscription is invalid");
  }
  if (
    (transparencyHistory.length === 0 &&
      (subscription.transparencyEntryCount !== 0 ||
        subscription.transparencyTailSha256 !== undefined)) ||
    (transparencyTail &&
      (subscription.transparencyEntryCount !== transparencyTail.sequence ||
        subscription.transparencyTailSha256 !== transparencyTail.contentSha256))
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription transparency tail is invalid",
    );
  }
  if (
    lastGoodDiscovery &&
    (lastGoodDiscovery.status !== "valid" ||
      !lastGoodDiscovery.directory ||
      lastGoodDiscovery.sourceUrlSha256 !== subscription.sourceUrlSha256 ||
      lastGoodDiscovery.sourceOriginSha256 !==
        subscription.sourceOriginSha256 ||
      lastGoodDiscovery.verification.policySha256 !== subscription.policySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription last-good discovery is invalid",
    );
  }
  if (lastGoodDiscovery) {
    const lastGoodDirectory = lastGoodDiscovery.directory;
    if (
      !lastGoodDirectory ||
      !transparencyTail ||
      transparencyTail.directorySha256 !== lastGoodDirectory.contentSha256 ||
      transparencyTail.anchorSetSha256 !== lastGoodDirectory.anchorSetSha256
    ) {
      throw new Error(
        "Receipt trust anchor directory subscription transparency history is stale",
      );
    }
  }
  const content = {
    ...subscriptionContent(subscription),
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  };
  if (hashSubscriptionContent(content) !== subscription.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory subscription content hash mismatch",
    );
  }
  return structuredClone({
    ...subscription,
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  });
}

export function stripReceiptTrustAnchorDirectorySubscriptionSecrets(
  input: PersistedReceiptTrustAnchorDirectorySubscription,
): ReceiptTrustAnchorDirectorySubscription {
  const {
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    ...subscription
  } = input;
  return validateReceiptTrustAnchorDirectorySubscription(subscription);
}

export function validateReceiptTrustAnchorDirectoryDiscovery(
  value: unknown,
): ReceiptTrustAnchorDirectoryDiscovery {
  if (!isRecord(value) || !isRecord(value["verification"])) {
    throw new Error("Receipt trust anchor directory discovery is invalid");
  }
  const discovery = value as unknown as ReceiptTrustAnchorDirectoryDiscovery;
  const verification = discovery.verification;
  const directory =
    discovery.directory === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectory(discovery.directory);
  if (
    discovery.kind !== "napier.receipt-trust-anchor-directory-discovery" ||
    discovery.schemaVersion !== 1 ||
    discovery.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(discovery.generatedAt) ||
    (discovery.status !== "valid" && discovery.status !== "invalid") ||
    !SHA256_PATTERN.test(discovery.sourceUrlSha256) ||
    !SHA256_PATTERN.test(discovery.sourceOriginSha256) ||
    discovery.httpStatus !== 200 ||
    typeof discovery.responseMediaType !== "string" ||
    discovery.responseMediaType.length < 1 ||
    !Number.isSafeInteger(discovery.responseBytes) ||
    discovery.responseBytes < 1 ||
    !SHA256_PATTERN.test(discovery.responseBodySha256) ||
    !SHA256_PATTERN.test(discovery.contentSha256) ||
    verification.kind !==
      "napier.receipt-trust-anchor-directory-verification" ||
    verification.schemaVersion !== 1 ||
    verification.apiVersion !== NAPIER_API_VERSION ||
    verification.status !== discovery.status ||
    !validTimestamp(verification.generatedAt) ||
    !Array.isArray(verification.diagnostics) ||
    verification.diagnostics.some(
      (diagnostic) => typeof diagnostic !== "string",
    ) ||
    (verification.status === "valid" &&
      verification.diagnostics.length !== 0) ||
    !SHA256_PATTERN.test(verification.contentSha256) ||
    (discovery.status === "valid" && !directory) ||
    (discovery.status === "invalid" && directory !== undefined) ||
    (directory !== undefined &&
      (verification.declaredContentSha256 !== directory.contentSha256 ||
        verification.recomputedContentSha256 !== directory.contentSha256 ||
        verification.declaredAnchorSetSha256 !== directory.anchorSetSha256 ||
        verification.recomputedAnchorSetSha256 !== directory.anchorSetSha256))
  ) {
    throw new Error("Receipt trust anchor directory discovery is invalid");
  }
  const {
    generatedAt: _verificationGeneratedAt,
    contentSha256: _verificationContentSha256,
    ...verificationContent
  } = verification;
  if (
    sha256(canonicalJson(verificationContent)) !== verification.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory discovery verification hash mismatch",
    );
  }
  const { contentSha256: _contentSha256, ...discoveryContent } = {
    ...discovery,
    ...(directory ? { directory } : {}),
  };
  if (sha256(canonicalJson(discoveryContent)) !== discovery.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory discovery content hash mismatch",
    );
  }
  return structuredClone({
    ...discovery,
    ...(directory ? { directory } : {}),
  });
}

export function normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
  value: string,
): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error(
      "Receipt trust anchor directory subscription URL is invalid",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Receipt trust anchor directory subscription URL is invalid",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription URL is invalid",
    );
  }
  return url;
}

function assertDiscoveryBinding(
  discovery: ReceiptTrustAnchorDirectoryDiscovery,
  sourceUrl: URL,
  policySha256: string,
): void {
  if (
    discovery.sourceUrlSha256 !== sha256(sourceUrl.href) ||
    discovery.sourceOriginSha256 !== sha256(sourceUrl.origin) ||
    discovery.verification.policySha256 !== policySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription discovery binding changed",
    );
  }
}

function createQuorumSource(
  subscription: ReceiptTrustAnchorDirectorySubscription,
  policy: Required<ReceiptTrustAnchorDirectoryQuorumPolicy>,
  metadata?: ReceiptTrustAnchorDirectoryQuorumSourceMetadata,
): ReceiptTrustAnchorDirectoryQuorumSource {
  const discovery = subscription.lastGoodDiscovery;
  const directory = discovery?.directory;
  const tail = subscription.transparencyHistory.at(-1);
  if (
    !discovery ||
    !directory ||
    !tail ||
    !subscription.transparencyTailSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum source is missing last-good evidence",
    );
  }
  return {
    subscriptionId: subscription.id,
    subscriptionSha256: subscription.contentSha256,
    sourceUrlSha256: subscription.sourceUrlSha256,
    sourceOriginSha256: subscription.sourceOriginSha256,
    weight: sourceWeightForOrigin(subscription.sourceOriginSha256, policy),
    ...(metadata ? { metadata } : {}),
    revision: subscription.revision,
    directorySha256: directory.contentSha256,
    anchorSetSha256: directory.anchorSetSha256,
    discoverySha256: discovery.contentSha256,
    transparencyTailSha256: subscription.transparencyTailSha256,
    trustedCount: directory.trustedCount,
    observedAt: tail.observedAt,
  };
}

function createQuorumCandidate(
  anchorSetSha256: string,
  sources: ReceiptTrustAnchorDirectoryQuorumSource[],
): ReceiptTrustAnchorDirectoryQuorumCandidate {
  const sorted = [...sources].sort((left, right) =>
    left.subscriptionId.localeCompare(right.subscriptionId),
  );
  const metadataPublishers = [...metadataPublisherSetForSources(sorted)].sort();
  return {
    anchorSetSha256,
    sourceCount: sorted.length,
    distinctSourceOriginCount: new Set(
      sorted.map((source) => source.sourceOriginSha256),
    ).size,
    weight: sorted.reduce((sum, source) => sum + source.weight, 0),
    metadataPublisherCount: metadataPublishers.length,
    metadataPublisherSetSha256: sha256(canonicalJson(metadataPublishers)),
    trustedCount: Math.max(...sorted.map((source) => source.trustedCount)),
    subscriptionSetSha256: sha256(
      canonicalJson(sorted.map((source) => source.subscriptionId)),
    ),
    directorySetSha256: sha256(
      canonicalJson(sorted.map((source) => source.directorySha256).sort()),
    ),
    discoverySetSha256: sha256(
      canonicalJson(sorted.map((source) => source.discoverySha256).sort()),
    ),
  };
}

function normalizeReceiptTrustAnchorDirectoryQuorumPolicy(
  policy: ReceiptTrustAnchorDirectoryQuorumPolicy | undefined,
): Required<ReceiptTrustAnchorDirectoryQuorumPolicy> {
  if (policy !== undefined) {
    if (!isRecord(policy)) {
      throw new Error(
        "Receipt trust anchor directory quorum policy is invalid",
      );
    }
    assertAllowedKeys(policy, [
      "minimumSources",
      "minimumAgreementCount",
      "minimumDistinctSourceOrigins",
      "minimumAgreementWeight",
      "minimumMetadataPublisherCount",
      "expectedAnchorSetSha256",
      "requiredSourceOriginSha256s",
      "requiredMetadataPublisherSha256s",
      "sourceWeights",
    ]);
  }
  const minimumSources = normalizeQuorumCount(
    policy?.["minimumSources"] ?? 2,
    "minimum sources",
  );
  const minimumAgreementCount = normalizeQuorumCount(
    policy?.["minimumAgreementCount"] ?? 2,
    "minimum agreement",
  );
  const minimumDistinctSourceOrigins = normalizeQuorumCount(
    policy?.["minimumDistinctSourceOrigins"] ?? Math.min(2, minimumSources),
    "minimum distinct source origins",
  );
  const minimumAgreementWeight = normalizeQuorumWeight(
    policy?.["minimumAgreementWeight"] ?? minimumAgreementCount,
    "minimum agreement weight",
  );
  const minimumMetadataPublisherCount = normalizeQuorumOptionalCount(
    policy?.["minimumMetadataPublisherCount"] ?? 0,
    "minimum metadata publisher count",
  );
  const expectedAnchorSetSha256Input = policy?.["expectedAnchorSetSha256"];
  if (
    expectedAnchorSetSha256Input !== undefined &&
    typeof expectedAnchorSetSha256Input !== "string"
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum expected anchor set is invalid",
    );
  }
  const expectedAnchorSetSha256 = expectedAnchorSetSha256Input ?? "";
  if (
    expectedAnchorSetSha256 !== "" &&
    !SHA256_PATTERN.test(expectedAnchorSetSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum expected anchor set is invalid",
    );
  }
  if (minimumAgreementCount > minimumSources) {
    throw new Error(
      "Receipt trust anchor directory quorum agreement cannot exceed sources",
    );
  }
  const requiredSourceOriginSha256s = normalizeSourceOriginPins(
    policy?.["requiredSourceOriginSha256s"],
    "source origin pins",
  );
  const requiredMetadataPublisherSha256s = normalizeSourceOriginPins(
    policy?.["requiredMetadataPublisherSha256s"],
    "metadata publisher pins",
  );
  const sourceWeights = normalizeQuorumSourceWeights(
    policy?.["sourceWeights"],
  );
  return {
    minimumSources,
    minimumAgreementCount,
    minimumDistinctSourceOrigins,
    minimumAgreementWeight,
    minimumMetadataPublisherCount,
    expectedAnchorSetSha256,
    requiredSourceOriginSha256s,
    requiredMetadataPublisherSha256s,
    sourceWeights,
  };
}

function normalizeReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
  policy:
    | ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy
    | undefined,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyProjection {
  if (policy !== undefined) {
    if (!isRecord(policy)) {
      throw new Error(
        "Receipt trust anchor directory quorum promotion baseline import policy is invalid",
      );
    }
    assertAllowedKeys(policy, [
      "maxBaselineAgeMs",
      "maxReceiptAgeMs",
      "maxSourceObservedAgeMs",
      "minimumAgreementCount",
      "minimumAgreementWeight",
      "minimumDistinctSourceOrigins",
      "minimumMetadataPublisherCount",
      "minimumSelectedMetadataCount",
      "expectedAnchorSetSha256",
      "expectedDirectorySha256",
      "requiredSourceOriginSha256s",
      "requiredMetadataPublisherSha256s",
      "requiredMetadataSignerKeyIds",
    ]);
  }
  return {
    maxBaselineAgeMs: normalizeImportPolicyDuration(
      policy?.["maxBaselineAgeMs"],
      "baseline age",
    ),
    maxReceiptAgeMs: normalizeImportPolicyDuration(
      policy?.["maxReceiptAgeMs"],
      "receipt age",
    ),
    maxSourceObservedAgeMs: normalizeImportPolicyDuration(
      policy?.["maxSourceObservedAgeMs"],
      "source observation age",
    ),
    minimumAgreementCount: normalizeQuorumOptionalCount(
      policy?.["minimumAgreementCount"] ?? 0,
      "minimum agreement",
    ),
    minimumAgreementWeight: normalizeQuorumOptionalWeight(
      policy?.["minimumAgreementWeight"],
      "minimum agreement weight",
    ),
    minimumDistinctSourceOrigins: normalizeQuorumOptionalCount(
      policy?.["minimumDistinctSourceOrigins"] ?? 0,
      "minimum distinct source origins",
    ),
    minimumMetadataPublisherCount: normalizeQuorumOptionalCount(
      policy?.["minimumMetadataPublisherCount"] ?? 0,
      "minimum metadata publisher count",
    ),
    minimumSelectedMetadataCount: normalizeQuorumOptionalCount(
      policy?.["minimumSelectedMetadataCount"] ?? 0,
      "minimum selected metadata count",
    ),
    expectedAnchorSetSha256: normalizeOptionalImportPolicySha256(
      policy?.["expectedAnchorSetSha256"],
      "expected anchor set",
    ),
    expectedDirectorySha256: normalizeOptionalImportPolicySha256(
      policy?.["expectedDirectorySha256"],
      "expected directory",
    ),
    requiredSourceOriginSha256s: normalizeSourceOriginPins(
      policy?.["requiredSourceOriginSha256s"],
      "required source origins",
    ),
    requiredMetadataPublisherSha256s: normalizeSourceOriginPins(
      policy?.["requiredMetadataPublisherSha256s"],
      "required metadata publishers",
    ),
    requiredMetadataSignerKeyIds: normalizeSourceOriginPins(
      policy?.["requiredMetadataSignerKeyIds"],
      "required metadata signer key ids",
    ),
  };
}

function normalizeImportPolicyDuration(
  value: unknown,
  label: string,
): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(
      `Receipt trust anchor directory quorum promotion baseline import policy ${label} is invalid`,
    );
  }
  return value;
}

function normalizeOptionalImportPolicySha256(
  value: unknown,
  label: string,
): string {
  if (value === undefined) return "";
  if (
    typeof value !== "string" ||
    (value !== "" && !SHA256_PATTERN.test(value))
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum promotion baseline import policy ${label} is invalid`,
    );
  }
  return value;
}

function normalizeQuorumCount(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value < 1 ||
    value > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum ${label} is invalid`,
    );
  }
  return value;
}

function normalizeQuorumOptionalCount(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value < 0 ||
    value > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum ${label} is invalid`,
    );
  }
  return value;
}

function normalizeQuorumOptionalWeight(value: unknown, label: string): number {
  if (value === undefined || value === 0) return 0;
  return normalizeQuorumWeight(value, label);
}

function normalizeQuorumWeight(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value < 1 ||
    value >
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS *
        MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum ${label} is invalid`,
    );
  }
  return value;
}

function normalizeSourceOriginPins(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS ||
    value.some((item) => typeof item !== "string" || !SHA256_PATTERN.test(item))
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum ${label} are invalid`,
    );
  }
  return Array.from(new Set(value as string[])).sort();
}

function normalizeQuorumSourceWeights(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumSourceWeight[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum source weights are invalid",
    );
  }
  const seen = new Set<string>();
  const weights = value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(
        "Receipt trust anchor directory quorum source weights are invalid",
      );
    }
    assertAllowedKeys(item, ["sourceOriginSha256", "weight"]);
    const sourceOriginSha256 = item["sourceOriginSha256"];
    const weight = item["weight"];
    if (
      typeof sourceOriginSha256 !== "string" ||
      !SHA256_PATTERN.test(sourceOriginSha256) ||
      !Number.isSafeInteger(weight) ||
      typeof weight !== "number" ||
      weight < 1 ||
      weight > MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT ||
      seen.has(sourceOriginSha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum source weights are invalid",
      );
    }
    seen.add(sourceOriginSha256);
    return { sourceOriginSha256, weight };
  });
  return weights.sort((left, right) =>
    left.sourceOriginSha256.localeCompare(right.sourceOriginSha256),
  );
}

function sourceWeightForOrigin(
  sourceOriginSha256: string,
  policy: Required<ReceiptTrustAnchorDirectoryQuorumPolicy>,
): number {
  return (
    policy.sourceWeights.find(
      (weight) => weight.sourceOriginSha256 === sourceOriginSha256,
    )?.weight ?? 1
  );
}

function metadataPublisherSetForSources(
  sources: ReceiptTrustAnchorDirectoryQuorumSource[],
): Set<string> {
  return new Set(
    sources.flatMap((source) =>
      source.metadata?.status === "trusted" &&
      source.metadata.directoryBindingValid &&
      source.metadata.publisherSha256
        ? [source.metadata.publisherSha256]
        : [],
    ),
  );
}

function createQuorumPromotionBaselineVerification(input: {
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification["status"];
  diagnostics: string[];
  baselineValid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  baseline?: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
}): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    verifiedAt: input.verifiedAt,
    status: input.status,
    diagnostics: input.diagnostics,
    baselineValid: input.baselineValid,
    signatureValid: input.signatureValid,
    integrityValid: input.integrityValid,
    ...(input.baseline
      ? {
          baselineSha256: input.baseline.contentSha256,
          envelopeSha256: input.baseline.envelope.contentSha256,
          receiptSha256: input.baseline.envelope.receipt.contentSha256,
          receiptArtifactSha256:
            input.baseline.envelope.signature.receiptArtifactSha256,
          keyId: input.baseline.envelope.signature.keyId,
          selectedAnchorSetSha256: input.baseline.selectedAnchorSetSha256,
          selectedDirectorySha256: input.baseline.selectedDirectorySha256,
          selectedSubscriptionSetSha256:
            input.baseline.selectedSubscriptionSetSha256,
          selectedMetadataEnvelopeSetSha256:
            input.baseline.selectedMetadataEnvelopeSetSha256,
        }
      : {}),
    ...(input.trustDirectoryVerification
      ? {
          ...(input.trustDirectoryVerification.recomputedContentSha256
            ? {
                anchorDirectorySha256:
                  input.trustDirectoryVerification.recomputedContentSha256,
              }
            : input.trustDirectoryVerification.declaredContentSha256
              ? {
                  anchorDirectorySha256:
                    input.trustDirectoryVerification.declaredContentSha256,
                }
              : {}),
          anchorDirectoryVerificationSha256:
            input.trustDirectoryVerification.contentSha256,
          ...(input.trustDirectoryVerification.policySha256
            ? {
                anchorDirectoryPolicySha256:
                  input.trustDirectoryVerification.policySha256,
              }
            : {}),
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createQuorumPromotionBaselineImportPolicyReview(input: {
  reviewedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview["status"];
  diagnostics: string[];
  policy: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyProjection;
  baseline?: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  selectedSourceOrigins?: string[];
  selectedMetadataPublishers?: string[];
  selectedMetadataSigners?: string[];
}): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-import-policy-review" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    reviewedAt: input.reviewedAt,
    status: input.status,
    diagnostics: input.diagnostics,
    policy: input.policy,
    policySha256: sha256(canonicalJson(input.policy)),
    ...(input.baseline
      ? {
          baselineSha256: input.baseline.contentSha256,
          envelopeSha256: input.baseline.envelope.contentSha256,
          receiptSha256: input.baseline.envelope.receipt.contentSha256,
          keyId: input.baseline.envelope.signature.keyId,
          selectedAnchorSetSha256: input.baseline.selectedAnchorSetSha256,
          selectedDirectorySha256: input.baseline.selectedDirectorySha256,
          selectedSourceOriginCount:
            input.selectedSourceOrigins?.length ?? 0,
          selectedSourceOriginSetSha256: sha256(
            canonicalJson(input.selectedSourceOrigins ?? []),
          ),
          selectedMetadataPublisherCount:
            input.selectedMetadataPublishers?.length ?? 0,
          selectedMetadataPublisherSetSha256: sha256(
            canonicalJson(input.selectedMetadataPublishers ?? []),
          ),
          selectedMetadataSignerCount:
            input.selectedMetadataSigners?.length ?? 0,
          selectedMetadataSignerSetSha256: sha256(
            canonicalJson(input.selectedMetadataSigners ?? []),
          ),
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function diagnosticsForTrustedReceiptVerification(
  status: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification["status"],
): string[] {
  if (status === "trusted") return [];
  if (status === "revoked") return ["signer_revoked"];
  if (status === "unknown_key") return ["signer_unknown"];
  return ["signature_invalid"];
}

function receiptAnchorsForQuorumPromotionBaseline(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  anchors: ReceiptTrustAnchor[],
): ReceiptTrustAnchor[] {
  const byKeyId = new Map<string, ReceiptTrustAnchor>();
  for (const anchor of anchors) byKeyId.set(anchor.keyId, anchor);
  const selectedDirectory = envelope.receipt.quorum.selectedDirectory;
  if (selectedDirectory) {
    for (const anchor of receiptTrustAnchorsFromDirectory(selectedDirectory)) {
      if (!byKeyId.has(anchor.keyId)) byKeyId.set(anchor.keyId, anchor);
    }
  }
  return [...byKeyId.values()];
}

function validateQuorumPromotionMetadataList(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumPromotionMetadata[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion metadata is invalid",
    );
  }
  const seenSubscriptionIds = new Set<string>();
  return value
    .map((input) => {
      const metadata = validateQuorumPromotionMetadata(input);
      if (seenSubscriptionIds.has(metadata.subscriptionId)) {
        throw new Error(
          "Receipt trust anchor directory quorum promotion metadata is invalid",
        );
      }
      seenSubscriptionIds.add(metadata.subscriptionId);
      return metadata;
    })
    .sort((left, right) =>
      left.subscriptionId.localeCompare(right.subscriptionId),
    );
}

function validateQuorumPromotionMetadata(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumPromotionMetadata {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion metadata is invalid",
    );
  }
  assertAllowedKeys(value, [
    "subscriptionId",
    "envelope",
    "envelopeSha256",
    "verificationSha256",
    "publisherSha256",
    "signerKeyId",
    "contentSha256",
  ]);
  const metadata =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumPromotionMetadata;
  const envelope = validateTrustedReceiptEnvelope(
    metadata.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryMetadataReceipt>;
  if (
    !SUBSCRIPTION_ID_PATTERN.test(metadata.subscriptionId) ||
    envelope.receiptKind !== "receipt_trust_anchor_directory_metadata" ||
    metadata.envelopeSha256 !== envelope.contentSha256 ||
    !SHA256_PATTERN.test(metadata.verificationSha256) ||
    !optionalSha256(metadata.publisherSha256) ||
    !optionalSha256(metadata.signerKeyId) ||
    !SHA256_PATTERN.test(metadata.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion metadata is invalid",
    );
  }
  const metadataContent = {
    subscriptionId: metadata.subscriptionId,
    envelope,
    envelopeSha256: envelope.contentSha256,
    verificationSha256: metadata.verificationSha256,
    ...(metadata.publisherSha256
      ? { publisherSha256: metadata.publisherSha256 }
      : {}),
    ...(metadata.signerKeyId ? { signerKeyId: metadata.signerKeyId } : {}),
  };
  if (sha256(canonicalJson(metadataContent)) !== metadata.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion metadata hash mismatch",
    );
  }
  return structuredClone({
    ...metadataContent,
    contentSha256: metadata.contentSha256,
  });
}

function validateQuorumSources(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumSource[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error("Receipt trust anchor directory quorum sources are invalid");
  }
  return value
    .map(validateQuorumSource)
    .sort((left, right) => left.subscriptionId.localeCompare(right.subscriptionId));
}

function validateQuorumSource(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumSource {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor directory quorum source is invalid");
  }
  assertAllowedKeys(value, [
    "subscriptionId",
    "subscriptionSha256",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "weight",
    "metadata",
    "revision",
    "directorySha256",
    "anchorSetSha256",
    "discoverySha256",
    "transparencyTailSha256",
    "trustedCount",
    "observedAt",
  ]);
  const source = value as unknown as ReceiptTrustAnchorDirectoryQuorumSource;
  const metadata =
    source.metadata === undefined
      ? undefined
      : validateQuorumSourceMetadata(source.metadata);
  if (
    !SUBSCRIPTION_ID_PATTERN.test(source.subscriptionId) ||
    !SHA256_PATTERN.test(source.subscriptionSha256) ||
    !SHA256_PATTERN.test(source.sourceUrlSha256) ||
    !SHA256_PATTERN.test(source.sourceOriginSha256) ||
    !Number.isSafeInteger(source.weight) ||
    source.weight < 1 ||
    source.weight > MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !SHA256_PATTERN.test(source.directorySha256) ||
    !SHA256_PATTERN.test(source.anchorSetSha256) ||
    !SHA256_PATTERN.test(source.discoverySha256) ||
    !SHA256_PATTERN.test(source.transparencyTailSha256) ||
    !nonNegativeInteger(source.trustedCount) ||
    !validTimestamp(source.observedAt)
  ) {
    throw new Error("Receipt trust anchor directory quorum source is invalid");
  }
  return {
    ...source,
    ...(metadata ? { metadata } : {}),
  };
}

function validateQuorumSourceMetadata(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumSourceMetadata {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum source metadata is invalid",
    );
  }
  assertAllowedKeys(value, [
    "status",
    "signatureValid",
    "integrityValid",
    "directoryBindingValid",
    "diagnosticCount",
    "diagnosticsSha256",
    "publisherSha256",
    "signerKeyId",
    "envelopeSha256",
    "verificationSha256",
  ]);
  return validateReceiptTrustAnchorDirectoryQuorumMetadata({
    subscriptionId: "trustdir_00000000000000000000",
    ...value,
  } as ReceiptTrustAnchorDirectoryQuorumMetadataEvidence);
}

function validateQuorumCandidates(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum candidates are invalid",
    );
  }
  return value.map(validateQuorumCandidate).sort(
    (left, right) =>
      right.weight - left.weight ||
      right.sourceCount - left.sourceCount ||
      left.anchorSetSha256.localeCompare(right.anchorSetSha256),
  );
}

function validateQuorumCandidate(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumCandidate {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum candidate is invalid",
    );
  }
  assertAllowedKeys(value, [
    "anchorSetSha256",
    "sourceCount",
    "distinctSourceOriginCount",
    "weight",
    "metadataPublisherCount",
    "metadataPublisherSetSha256",
    "trustedCount",
    "subscriptionSetSha256",
    "directorySetSha256",
    "discoverySetSha256",
  ]);
  const candidate =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumCandidate;
  if (
    !SHA256_PATTERN.test(candidate.anchorSetSha256) ||
    !nonNegativeInteger(candidate.sourceCount) ||
    !nonNegativeInteger(candidate.distinctSourceOriginCount) ||
    !nonNegativeInteger(candidate.weight) ||
    !nonNegativeInteger(candidate.metadataPublisherCount) ||
    !SHA256_PATTERN.test(candidate.metadataPublisherSetSha256) ||
    !nonNegativeInteger(candidate.trustedCount) ||
    !SHA256_PATTERN.test(candidate.subscriptionSetSha256) ||
    !SHA256_PATTERN.test(candidate.directorySetSha256) ||
    !SHA256_PATTERN.test(candidate.discoverySetSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum candidate is invalid",
    );
  }
  return structuredClone(candidate);
}

function receiptTrustAnchorDirectoryQuorumMetadataEvidenceBySubscriptionId(
  values: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[],
): Map<string, ReceiptTrustAnchorDirectoryQuorumSourceMetadata> {
  if (values.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) {
    throw new Error(
      "Receipt trust anchor directory quorum metadata evidence is invalid",
    );
  }
  const metadataBySubscriptionId = new Map<
    string,
    ReceiptTrustAnchorDirectoryQuorumSourceMetadata
  >();
  for (const value of values) {
    const metadata = validateReceiptTrustAnchorDirectoryQuorumMetadata(value);
    if (metadataBySubscriptionId.has(value.subscriptionId)) {
      throw new Error(
        "Receipt trust anchor directory quorum metadata evidence is invalid",
      );
    }
    metadataBySubscriptionId.set(value.subscriptionId, metadata);
  }
  return metadataBySubscriptionId;
}

function validateReceiptTrustAnchorDirectoryQuorumMetadata(
  value: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
): ReceiptTrustAnchorDirectoryQuorumSourceMetadata {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum metadata evidence is invalid",
    );
  }
  assertAllowedKeys(value, [
    "subscriptionId",
    "status",
    "signatureValid",
    "integrityValid",
    "directoryBindingValid",
    "diagnosticCount",
    "diagnosticsSha256",
    "publisherSha256",
    "signerKeyId",
    "envelopeSha256",
    "verificationSha256",
  ]);
  if (
    !SUBSCRIPTION_ID_PATTERN.test(value.subscriptionId) ||
    (value.status !== "trusted" &&
      value.status !== "revoked" &&
      value.status !== "unknown_key" &&
      value.status !== "invalid") ||
    typeof value.signatureValid !== "boolean" ||
    typeof value.integrityValid !== "boolean" ||
    typeof value.directoryBindingValid !== "boolean" ||
    !Number.isSafeInteger(value.diagnosticCount) ||
    value.diagnosticCount < 0 ||
    value.diagnosticCount > 64 ||
    !SHA256_PATTERN.test(value.diagnosticsSha256) ||
    !optionalSha256(value.publisherSha256) ||
    !optionalSha256(value.signerKeyId) ||
    !optionalSha256(value.envelopeSha256) ||
    !optionalSha256(value.verificationSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum metadata evidence is invalid",
    );
  }
  return {
    status: value.status,
    signatureValid: value.signatureValid,
    integrityValid: value.integrityValid,
    directoryBindingValid: value.directoryBindingValid,
    diagnosticCount: value.diagnosticCount,
    diagnosticsSha256: value.diagnosticsSha256,
    ...(value.publisherSha256
      ? { publisherSha256: value.publisherSha256 }
      : {}),
    ...(value.signerKeyId ? { signerKeyId: value.signerKeyId } : {}),
    ...(value.envelopeSha256 ? { envelopeSha256: value.envelopeSha256 } : {}),
    ...(value.verificationSha256
      ? { verificationSha256: value.verificationSha256 }
      : {}),
  };
}

function migrateReceiptTrustAnchorDirectorySubscription(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (
    Array.isArray(value["transparencyHistory"]) &&
    value["transparencyEntryCount"] !== undefined
  ) {
    return value;
  }
  const lastGoodDiscovery =
    value["lastGoodDiscovery"] === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryDiscovery(
          value["lastGoodDiscovery"],
        );
  if (!lastGoodDiscovery?.directory) {
    return value;
  }
  const observedAt = validTimestamp(lastGoodDiscovery.generatedAt)
    ? lastGoodDiscovery.generatedAt
    : validTimestamp(value["lastRefreshAt"])
      ? value["lastRefreshAt"]
      : validTimestamp(value["createdAt"])
        ? value["createdAt"]
        : new Date().toISOString();
  const entry = createTransparencyEntry({
    discovery: lastGoodDiscovery,
    status: "promoted",
    observedAt,
  });
  const migrated = {
    ...value,
    transparencyEntryCount: entry.sequence,
    transparencyTailSha256: entry.contentSha256,
    transparencyHistory: [entry],
  };
  const content = subscriptionContent(
    migrated as unknown as ReceiptTrustAnchorDirectorySubscription,
  );
  return {
    ...migrated,
    contentSha256: hashSubscriptionContent(content),
  };
}

function createTransparencyEntry(input: {
  discovery: ReceiptTrustAnchorDirectoryDiscovery;
  status: ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus;
  observedAt: string;
  previousEntrySha256?: string;
  previousSequence?: number;
}): ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry {
  if (!input.discovery.directory) {
    throw new Error(
      "Receipt trust anchor directory transparency entry requires a directory",
    );
  }
  const observedAt = requireTimestamp(
    input.observedAt,
    "subscription transparency observation time",
  );
  if (
    input.previousEntrySha256 !== undefined &&
    !SHA256_PATTERN.test(input.previousEntrySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory transparency predecessor is invalid",
    );
  }
  const sequence = (input.previousSequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(
      "Receipt trust anchor directory transparency sequence is invalid",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-subscription-transparency-entry" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    sequence,
    status: input.status,
    observedAt,
    discoverySha256: input.discovery.contentSha256,
    directorySha256: input.discovery.directory.contentSha256,
    anchorSetSha256: input.discovery.directory.anchorSetSha256,
    trustedCount: input.discovery.directory.trustedCount,
    ...(input.previousEntrySha256
      ? { previousEntrySha256: input.previousEntrySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function appendTransparencyEntry(
  history: ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry[],
  entry: ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry,
): ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry[] {
  return [...history, entry].slice(
    -MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTION_TRANSPARENCY_ENTRIES,
  );
}

function validateTransparencyHistory(
  value: unknown,
): ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTION_TRANSPARENCY_ENTRIES
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription transparency history is invalid",
    );
  }
  const entries = value.map(validateTransparencyEntry);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    if (previous) {
      if (
        entry.sequence !== previous.sequence + 1 ||
        entry.previousEntrySha256 !== previous.contentSha256
      ) {
        throw new Error(
          "Receipt trust anchor directory subscription transparency chain is invalid",
        );
      }
    } else if (
      (entry.sequence === 1 && entry.previousEntrySha256 !== undefined) ||
      (entry.sequence > 1 && !entry.previousEntrySha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory subscription transparency chain is invalid",
      );
    }
  }
  return entries;
}

function validateTransparencyEntry(
  value: unknown,
): ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory subscription transparency entry is invalid",
    );
  }
  const entry =
    value as unknown as ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry;
  if (
    entry.kind !==
      "napier.receipt-trust-anchor-directory-subscription-transparency-entry" ||
    entry.schemaVersion !== 1 ||
    entry.apiVersion !== NAPIER_API_VERSION ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    (entry.status !== "promoted" && entry.status !== "unchanged") ||
    !validTimestamp(entry.observedAt) ||
    !SHA256_PATTERN.test(entry.discoverySha256) ||
    !SHA256_PATTERN.test(entry.directorySha256) ||
    !SHA256_PATTERN.test(entry.anchorSetSha256) ||
    !nonNegativeInteger(entry.trustedCount) ||
    !optionalSha256(entry.previousEntrySha256) ||
    !SHA256_PATTERN.test(entry.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription transparency entry is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = entry;
  if (sha256(canonicalJson(content)) !== entry.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory subscription transparency entry hash mismatch",
    );
  }
  return structuredClone(entry);
}

function subscriptionContent(
  input: ReceiptTrustAnchorDirectorySubscription,
): Omit<ReceiptTrustAnchorDirectorySubscription, "contentSha256"> {
  const {
    contentSha256: _contentSha256,
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    ...content
  } = input as ReceiptTrustAnchorDirectorySubscription &
    Partial<PersistedReceiptTrustAnchorDirectorySubscription>;
  return content;
}

function hashSubscriptionContent(value: object): string {
  return sha256(canonicalJson(value));
}

function normalizeLabel(value: string): string {
  if (typeof value !== "string") {
    throw new Error(
      "Receipt trust anchor directory subscription label is invalid",
    );
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 100) {
    throw new Error(
      "Receipt trust anchor directory subscription label is invalid",
    );
  }
  return normalized;
}

function normalizeRefreshInterval(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    value > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription refresh interval is invalid",
    );
  }
  return value;
}

function validateOptionalClaim(
  value: unknown,
): ReceiptTrustAnchorDirectorySubscriptionClaimState | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value["ownerId"] !== "string" ||
    value["ownerId"].length < 1 ||
    value["ownerId"].length > 100 ||
    !validTimestamp(value["acquiredAt"]) ||
    !validTimestamp(value["expiresAt"])
  ) {
    throw new Error(
      "Receipt trust anchor directory subscription claim is invalid",
    );
  }
  return {
    ownerId: value["ownerId"],
    acquiredAt: value["acquiredAt"],
    expiresAt: value["expiresAt"],
  };
}

function optionalRefreshStatus(
  value: unknown,
): value is ReceiptTrustAnchorDirectorySubscriptionRefreshStatus | undefined {
  return (
    value === undefined ||
    value === "promoted" ||
    value === "unchanged" ||
    value === "rollback_rejected" ||
    value === "rejected" ||
    value === "failed"
  );
}

function optionalTimestamp(value: unknown): boolean {
  return value === undefined || validTimestamp(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDiagnostics(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (diagnostic) =>
        typeof diagnostic === "string" &&
        /^[a-z0-9_]{1,80}$/.test(diagnostic),
    )
  );
}

function requireTimestamp(value: string, label: string): string {
  if (!validTimestamp(value))
    throw new Error(`Receipt trust ${label} is invalid`);
  return new Date(value).toISOString();
}

function optionalSha256(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && SHA256_PATTERN.test(value))
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): void {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      "Receipt trust anchor directory payload has unsupported fields",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
