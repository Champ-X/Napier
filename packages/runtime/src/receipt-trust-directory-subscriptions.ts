import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type ReceiptTrustAnchorDirectoryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumCandidate,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumSource,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshStatus,
  type ReceiptTrustAnchorDirectorySubscriptionStatus,
  type ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry,
  type ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus,
} from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  hashReceiptTrustAnchorDirectoryVerificationPolicy,
  normalizeReceiptTrustAnchorDirectoryVerificationPolicy,
  validateReceiptTrustAnchorDirectory,
} from "./receipt-trust.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUBSCRIPTION_ID_PATTERN = /^trustdir_[a-f0-9]{20}$/;

export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTION_TRANSPARENCY_ENTRIES = 20;
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
): ReceiptTrustAnchorDirectoryQuorum {
  const normalizedPolicy =
    normalizeReceiptTrustAnchorDirectoryQuorumPolicy(policy);
  const sources = subscriptions
    .map(validateReceiptTrustAnchorDirectorySubscription)
    .filter(
      (subscription) =>
        subscription.status === "active" &&
        Boolean(subscription.lastGoodDiscovery?.directory),
    )
    .map(createQuorumSource)
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
        right.sourceCount - left.sourceCount ||
        left.anchorSetSha256.localeCompare(right.anchorSetSha256),
    );
  const winner = candidates.at(0);
  const agreementCount = winner?.sourceCount ?? 0;
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
  if (
    normalizedPolicy.expectedAnchorSetSha256 &&
    winner?.anchorSetSha256 !== normalizedPolicy.expectedAnchorSetSha256
  ) {
    diagnostics.push("anchor_set_unexpected");
  }
  const status: ReceiptTrustAnchorDirectoryQuorum["status"] =
    sources.length < normalizedPolicy.minimumSources
      ? "insufficient_sources"
      : normalizedPolicy.expectedAnchorSetSha256 &&
          winner?.anchorSetSha256 !== normalizedPolicy.expectedAnchorSetSha256
        ? "policy_failed"
        : agreementCount >= normalizedPolicy.minimumAgreementCount
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
  return {
    anchorSetSha256,
    sourceCount: sorted.length,
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
      "expectedAnchorSetSha256",
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
  return {
    minimumSources,
    minimumAgreementCount,
    expectedAnchorSetSha256,
  };
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
