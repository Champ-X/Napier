import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectoryMetadataReceipt,
  type ReceiptTrustAnchorDirectoryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumCandidate,
  type ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  type ReceiptTrustAnchorDirectoryQuorumMetadataInput,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  type ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySourceStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry,
  type ReceiptTrustAnchorDirectoryQuorumActivationSource,
  type ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  type ReceiptTrustAnchorDirectoryQuorumActivationSourceStatus,
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
  type TrustedReceiptVerification,
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
const CHECKPOINT_SUBSCRIPTION_ID_PATTERN = /^trustcpsub_[a-f0-9]{20}$/;
const ROTATION_PROPOSAL_SUBSCRIPTION_ID_PATTERN =
  /^trustpropsub_[a-f0-9]{20}$/;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9_]{2,80}$/;

export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTION_TRANSPARENCY_ENTRIES = 20;
export const MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS = 20;
export const MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS = 20;
export const MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES = 20;
export const MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTION_TRANSPARENCY_ENTRIES = 20;
export const MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTION_TRANSPARENCY_ENTRIES = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT = 10;
export const MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES = 20;
export const MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS = 50;
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

export interface PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription extends ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  sourceUrl: string;
  claim?: ReceiptTrustAnchorDirectorySubscriptionClaimState;
  claimTokenSha256?: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim {
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
  sourceUrl: string;
  token: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyStatus =
  | "pending"
  | "applied"
  | "rejected"
  | "failed";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyState {
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyStatus;
  queuedAt: string;
  applyAfter: string;
  approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
  approvalEnvelopeSha256: string;
  approvalSha256: string;
  claim?: ReceiptTrustAnchorDirectorySubscriptionClaimState;
  claimTokenSha256?: string;
  settledAt?: string;
  resultSha256?: string;
  failureSha256?: string;
}

export interface PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription extends ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  sourceUrl: string;
  claim?: ReceiptTrustAnchorDirectorySubscriptionClaimState;
  claimTokenSha256?: string;
  pendingApprovalApply?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyState;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim {
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  sourceUrl: string;
  token: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim {
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
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

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy = {},
): Required<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy> {
  const requiredSignerKeyIds = Array.from(
    new Set(input.requiredSignerKeyIds ?? []),
  ).sort();
  if (
    !Number.isSafeInteger(input.maxEnvelopeAgeMs ?? 0) ||
    (input.maxEnvelopeAgeMs !== undefined &&
      (input.maxEnvelopeAgeMs < 0 ||
        input.maxEnvelopeAgeMs > 365 * 24 * 60 * 60 * 1_000)) ||
    (input.expectedCheckpointSha256 !== undefined &&
      input.expectedCheckpointSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedCheckpointSha256)) ||
    (input.expectedSelectionSetSha256 !== undefined &&
      input.expectedSelectionSetSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedSelectionSetSha256)) ||
    (input.expectedSelectionChainTailSha256 !== undefined &&
      input.expectedSelectionChainTailSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedSelectionChainTailSha256)) ||
    (input.minimumSelectionCount !== undefined &&
      (!Number.isSafeInteger(input.minimumSelectionCount) ||
        input.minimumSelectionCount < 0 ||
        input.minimumSelectionCount > 1_000)) ||
    requiredSignerKeyIds.some((keyId) => !SHA256_PATTERN.test(keyId)) ||
    (input.rejectRollback !== undefined &&
      typeof input.rejectRollback !== "boolean")
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint discovery policy is invalid",
    );
  }
  return {
    maxEnvelopeAgeMs: input.maxEnvelopeAgeMs ?? 7 * 24 * 60 * 60 * 1_000,
    expectedCheckpointSha256: input.expectedCheckpointSha256 ?? "",
    expectedSelectionSetSha256: input.expectedSelectionSetSha256 ?? "",
    expectedSelectionChainTailSha256:
      input.expectedSelectionChainTailSha256 ?? "",
    minimumSelectionCount: input.minimumSelectionCount ?? 0,
    requiredSignerKeyIds,
    rejectRollback: input.rejectRollback ?? true,
  };
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy = {},
): string {
  return sha256(
    canonicalJson(
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
        input,
      ),
    ),
  );
}

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy = {},
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy {
  const requiredSignerKeyIds =
    input.requiredSignerKeyIds === undefined
      ? undefined
      : Array.from(new Set(input.requiredSignerKeyIds)).sort();
  return {
    ...(input.maxEnvelopeAgeMs !== undefined
      ? { maxEnvelopeAgeMs: input.maxEnvelopeAgeMs }
      : {}),
    ...(input.expectedEnvelopeSha256
      ? { expectedEnvelopeSha256: input.expectedEnvelopeSha256 }
      : {}),
    ...(input.expectedProposalSha256
      ? { expectedProposalSha256: input.expectedProposalSha256 }
      : {}),
    ...(input.expectedActivationDecisionRecordId
      ? {
          expectedActivationDecisionRecordId:
            input.expectedActivationDecisionRecordId,
        }
      : {}),
    ...(input.expectedCurrentSelectionSha256 !== undefined
      ? { expectedCurrentSelectionSha256: input.expectedCurrentSelectionSha256 }
      : {}),
    ...(requiredSignerKeyIds && requiredSignerKeyIds.length > 0
      ? { requiredSignerKeyIds }
      : {}),
  };
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy = {},
): string {
  return sha256(
    canonicalJson(
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
        input,
      ),
    ),
  );
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  discoveryInput: unknown,
  createdAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    request.sourceUrl,
  );
  const label = normalizeLabel(request.label);
  const refreshIntervalMs = normalizeRefreshInterval(request.refreshIntervalMs);
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      request.policy,
    );
  const policySha256 =
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      policy,
    );
  const discovery =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
      discoveryInput,
    );
  assertCheckpointDiscoveryBinding(discovery, sourceUrl, policySha256);
  if (
    discovery.status !== "valid" ||
    !discovery.envelope ||
    !discovery.checkpointSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription requires a valid discovery",
    );
  }
  const now = requireTimestamp(
    createdAt,
    "checkpoint subscription creation time",
  );
  const transparencyEntry = createCheckpointSubscriptionTransparencyEntry({
    discovery,
    status: "accepted",
    observedAt: now,
  });
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    id: createId("trustcpsub"),
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
    lastRefreshStatus: "accepted" as const,
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
    contentSha256: hashCheckpointSubscriptionContent(content),
    sourceUrl: sourceUrl.href,
  };
}

export function updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus,
  updatedAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  const current =
    validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      input,
    );
  if (status !== "active" && status !== "paused") {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription status is invalid",
    );
  }
  if (current.status === status) return current;
  const content = {
    ...checkpointSubscriptionContent(current),
    status,
    revision: current.revision + 1,
    updatedAt: requireTimestamp(
      updatedAt,
      "checkpoint subscription update time",
    ),
  };
  return {
    ...content,
    contentSha256: hashCheckpointSubscriptionContent(content),
    sourceUrl: current.sourceUrl,
  };
}

export function settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefresh(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  outcome: { discovery: unknown } | { failureSha256: string },
  refreshedAt = new Date().toISOString(),
): {
  persisted: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
  result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult;
} {
  const current =
    validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      input,
    );
  const refreshTime = requireTimestamp(
    refreshedAt,
    "checkpoint subscription refresh time",
  );
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    current.sourceUrl,
  );
  let discovery:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery
    | undefined;
  let failureSha256: string | undefined;
  let status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus;
  let lastGoodDiscovery = current.lastGoodDiscovery;
  let transparencyHistory = current.transparencyHistory;
  let transparencyEntryCount = current.transparencyEntryCount;
  let transparencyTailSha256 = current.transparencyTailSha256;

  if ("discovery" in outcome) {
    discovery =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
        outcome.discovery,
      );
    assertCheckpointDiscoveryBinding(discovery, sourceUrl, current.policySha256);
    if (
      discovery.status === "valid" &&
      discovery.envelope &&
      discovery.checkpointSha256
    ) {
      const checkpointSha256 = discovery.checkpointSha256;
      const currentCheckpointSha256 = current.lastGoodDiscovery?.checkpointSha256;
      const currentSelectionCount = current.lastGoodDiscovery?.selectionCount;
      const isKnownRollback =
        checkpointSha256 !== currentCheckpointSha256 &&
        current.transparencyHistory.some(
          (entry) => entry.checkpointSha256 === checkpointSha256,
        );
      const isCountRollback =
        currentSelectionCount !== undefined &&
        (discovery.selectionCount ?? 0) < currentSelectionCount;
      if (isKnownRollback || isCountRollback) {
        status = "rollback_rejected";
      } else {
        const transparencyStatus: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyStatus =
          discovery.envelopeSha256 === current.lastGoodDiscovery?.envelopeSha256
            ? "unchanged"
            : "accepted";
        status = transparencyStatus;
        lastGoodDiscovery = discovery;
        transparencyHistory = appendCheckpointSubscriptionTransparencyEntry(
          current.transparencyHistory,
          createCheckpointSubscriptionTransparencyEntry({
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
        "Receipt trust anchor directory quorum activation selection checkpoint subscription failure hash is invalid",
      );
    }
    status = "failed";
    failureSha256 = outcome.failureSha256;
  }

  const {
    lastDiscoverySha256: _lastDiscoverySha256,
    lastFailureSha256: _lastFailureSha256,
    ...currentContent
  } = checkpointSubscriptionContent(current);
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
  const persisted: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription =
    {
      ...content,
      contentSha256: hashCheckpointSubscriptionContent(content),
      sourceUrl: current.sourceUrl,
    };
  const subscription =
    stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
      persisted,
    );
  const resultContent = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription-refresh" as const,
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

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
  request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  discoveryInput: unknown,
  createdAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    request.sourceUrl,
  );
  const label = normalizeLabel(request.label);
  const refreshIntervalMs = normalizeRefreshInterval(request.refreshIntervalMs);
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      request.policy,
    );
  const policySha256 =
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      policy,
    );
  const discovery =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
      discoveryInput,
    );
  assertRotationProposalDiscoveryBinding(discovery, sourceUrl, policySha256);
  if (
    discovery.status !== "valid" ||
    !discovery.envelope ||
    !discovery.proposalSha256 ||
    !discovery.preflight
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription requires a valid discovery",
    );
  }
  const now = requireTimestamp(
    createdAt,
    "rotation proposal subscription creation time",
  );
  const transparencyEntry = createRotationProposalSubscriptionTransparencyEntry({
    discovery,
    status: "accepted",
    observedAt: now,
  });
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    id: createId("trustpropsub"),
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
    lastRefreshStatus: "accepted" as const,
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
    contentSha256: hashRotationProposalSubscriptionContent(content),
    sourceUrl: sourceUrl.href,
  };
}

export function updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus,
  updatedAt = new Date().toISOString(),
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  const current =
    validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      input,
    );
  if (status !== "active" && status !== "paused") {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription status is invalid",
    );
  }
  if (current.status === status) return current;
  const content = {
    ...rotationProposalSubscriptionContent(current),
    status,
    revision: current.revision + 1,
    updatedAt: requireTimestamp(
      updatedAt,
      "rotation proposal subscription update time",
    ),
  };
  return {
    ...content,
    contentSha256: hashRotationProposalSubscriptionContent(content),
    sourceUrl: current.sourceUrl,
  };
}

export function settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  outcome: { discovery: unknown } | { failureSha256: string },
  refreshedAt = new Date().toISOString(),
): {
  persisted: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult;
} {
  const current =
    validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      input,
    );
  const refreshTime = requireTimestamp(
    refreshedAt,
    "rotation proposal subscription refresh time",
  );
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    current.sourceUrl,
  );
  let discovery:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery
    | undefined;
  let failureSha256: string | undefined;
  let status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus;
  let lastGoodDiscovery = current.lastGoodDiscovery;
  let transparencyHistory = current.transparencyHistory;
  let transparencyEntryCount = current.transparencyEntryCount;
  let transparencyTailSha256 = current.transparencyTailSha256;

  if ("discovery" in outcome) {
    discovery =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
        outcome.discovery,
      );
    assertRotationProposalDiscoveryBinding(
      discovery,
      sourceUrl,
      current.policySha256,
    );
    if (
      discovery.status === "valid" &&
      discovery.envelope &&
      discovery.proposalSha256 &&
      discovery.preflight
    ) {
      const envelopeSha256 = discovery.envelopeSha256;
      const currentEnvelopeSha256 = current.lastGoodDiscovery?.envelopeSha256;
      const isKnownRollback =
        envelopeSha256 !== currentEnvelopeSha256 &&
        envelopeSha256 !== undefined &&
        current.transparencyHistory.some(
          (entry) => entry.envelopeSha256 === envelopeSha256,
        );
      if (isKnownRollback) {
        status = "rollback_rejected";
      } else {
        const transparencyStatus: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyStatus =
          envelopeSha256 === currentEnvelopeSha256 ? "unchanged" : "accepted";
        status = transparencyStatus;
        lastGoodDiscovery = discovery;
        transparencyHistory = appendRotationProposalSubscriptionTransparencyEntry(
          current.transparencyHistory,
          createRotationProposalSubscriptionTransparencyEntry({
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
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription failure hash is invalid",
      );
    }
    status = "failed";
    failureSha256 = outcome.failureSha256;
  }

  const {
    lastDiscoverySha256: _lastDiscoverySha256,
    lastFailureSha256: _lastFailureSha256,
    ...currentContent
  } = rotationProposalSubscriptionContent(current);
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
  const persisted: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription =
    {
      ...content,
      contentSha256: hashRotationProposalSubscriptionContent(content),
      sourceUrl: current.sourceUrl,
    };
  const subscription =
    stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
      persisted,
    );
  const resultContent = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-refresh" as const,
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

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy = {},
): Required<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy> {
  const requiredSourceOriginSha256s = Array.from(
    new Set(input.requiredSourceOriginSha256s ?? []),
  ).sort();
  const requiredSignerKeyIds = Array.from(
    new Set(input.requiredSignerKeyIds ?? []),
  ).sort();
  if (
    (input.minimumSources !== undefined &&
      (!Number.isSafeInteger(input.minimumSources) ||
        input.minimumSources < 1 ||
        input.minimumSources > MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS)) ||
    (input.minimumAgreementCount !== undefined &&
      (!Number.isSafeInteger(input.minimumAgreementCount) ||
        input.minimumAgreementCount < 1 ||
        input.minimumAgreementCount >
          MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS)) ||
    (input.minimumDistinctSourceOrigins !== undefined &&
      (!Number.isSafeInteger(input.minimumDistinctSourceOrigins) ||
        input.minimumDistinctSourceOrigins < 1 ||
        input.minimumDistinctSourceOrigins >
          MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS)) ||
    (input.maxObservationAgeMs !== undefined &&
      (!Number.isSafeInteger(input.maxObservationAgeMs) ||
        input.maxObservationAgeMs < 0 ||
        input.maxObservationAgeMs > 365 * 24 * 60 * 60 * 1_000)) ||
    (input.expectedCheckpointSha256 !== undefined &&
      input.expectedCheckpointSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedCheckpointSha256)) ||
    (input.expectedSelectionSetSha256 !== undefined &&
      input.expectedSelectionSetSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedSelectionSetSha256)) ||
    (input.expectedSelectionChainTailSha256 !== undefined &&
      input.expectedSelectionChainTailSha256 !== "" &&
      !SHA256_PATTERN.test(input.expectedSelectionChainTailSha256)) ||
    (input.minimumSelectionCount !== undefined &&
      (!Number.isSafeInteger(input.minimumSelectionCount) ||
        input.minimumSelectionCount < 0 ||
        input.minimumSelectionCount > 1_000)) ||
    requiredSourceOriginSha256s.some((origin) => !SHA256_PATTERN.test(origin)) ||
    requiredSignerKeyIds.some((keyId) => !SHA256_PATTERN.test(keyId))
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum policy is invalid",
    );
  }
  return {
    minimumSources: input.minimumSources ?? 2,
    minimumAgreementCount: input.minimumAgreementCount ?? 2,
    minimumDistinctSourceOrigins: input.minimumDistinctSourceOrigins ?? 2,
    maxObservationAgeMs: input.maxObservationAgeMs ?? 7 * 24 * 60 * 60 * 1_000,
    expectedCheckpointSha256: input.expectedCheckpointSha256 ?? "",
    expectedSelectionSetSha256: input.expectedSelectionSetSha256 ?? "",
    expectedSelectionChainTailSha256:
      input.expectedSelectionChainTailSha256 ?? "",
    minimumSelectionCount: input.minimumSelectionCount ?? 0,
    requiredSourceOriginSha256s,
    requiredSignerKeyIds,
  };
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy = {},
): string {
  return sha256(
    canonicalJson(
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
        input,
      ),
    ),
  );
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
  subscriptions: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[],
  policyInput?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "checkpoint registry quorum generation time",
  );
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
      policyInput,
    );
  const generatedAtMs = Date.parse(generatedAt);
  const sources = subscriptions
    .map(validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription)
    .map((subscription) =>
      createCheckpointRegistrySource(subscription, policy, generatedAtMs),
    )
    .sort((left, right) =>
      left.subscriptionId.localeCompare(right.subscriptionId),
    );
  const eligibleSources = sources.filter(
    (source) => source.status === "eligible" && source.checkpointSha256,
  );
  const staleSourceCount = sources.filter(
    (source) => source.status === "stale",
  ).length;
  const sourceGroups = new Map<
    string,
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource[]
  >();
  for (const source of eligibleSources) {
    const key = source.checkpointSha256!;
    const group = sourceGroups.get(key) ?? [];
    group.push(source);
    sourceGroups.set(key, group);
  }
  const candidates = Array.from(sourceGroups.entries())
    .map(([checkpointSha256, group]) =>
      createCheckpointRegistryCandidate(checkpointSha256, group),
    )
    .sort(
      (left, right) =>
        right.sourceCount - left.sourceCount ||
        right.distinctSourceOriginCount - left.distinctSourceOriginCount ||
        right.signerCount - left.signerCount ||
        left.checkpointSha256.localeCompare(right.checkpointSha256),
    );
  const winner = candidates.at(0);
  const winnerSources = winner
    ? eligibleSources.filter(
        (source) => source.checkpointSha256 === winner.checkpointSha256,
      )
    : [];
  const winningSourceOrigins = new Set(
    winnerSources.map((source) => source.sourceOriginSha256),
  );
  const winningSignerKeyIds = new Set(
    winnerSources.flatMap((source) =>
      source.signerKeyId ? [source.signerKeyId] : [],
    ),
  );
  const requiredSourceOriginMissing =
    policy.requiredSourceOriginSha256s.some(
      (origin) => !winningSourceOrigins.has(origin),
    );
  const requiredSignerMissing = policy.requiredSignerKeyIds.some(
    (keyId) => !winningSignerKeyIds.has(keyId),
  );
  const diagnostics: string[] = [];
  if (sources.length < policy.minimumSources) diagnostics.push("insufficient_sources");
  if (eligibleSources.length < policy.minimumSources) {
    diagnostics.push("insufficient_eligible_sources");
  }
  if (winner && winner.sourceCount < policy.minimumAgreementCount) {
    diagnostics.push("insufficient_agreement");
  }
  if (
    winner &&
    winner.distinctSourceOriginCount < policy.minimumDistinctSourceOrigins
  ) {
    diagnostics.push("insufficient_distinct_source_origins");
  }
  if (staleSourceCount > 0) diagnostics.push("stale_registry_sources");
  if (sources.some((source) => source.status === "missing_last_good")) {
    diagnostics.push("missing_last_good_sources");
  }
  if (
    policy.expectedCheckpointSha256 &&
    winner?.checkpointSha256 !== policy.expectedCheckpointSha256
  ) {
    diagnostics.push("checkpoint_unexpected");
  }
  if (
    policy.expectedSelectionSetSha256 &&
    winner?.selectionSetSha256 !== policy.expectedSelectionSetSha256
  ) {
    diagnostics.push("selection_set_unexpected");
  }
  if (
    policy.expectedSelectionChainTailSha256 &&
    winner?.selectionChainTailSha256 !== policy.expectedSelectionChainTailSha256
  ) {
    diagnostics.push("selection_chain_tail_unexpected");
  }
  if (winner && winner.selectionCount < policy.minimumSelectionCount) {
    diagnostics.push("selection_count_below_minimum");
  }
  if (requiredSourceOriginMissing) {
    diagnostics.push("required_source_origin_missing");
  }
  if (requiredSignerMissing) diagnostics.push("required_signer_missing");

  const agreementSatisfied = Boolean(
    winner &&
      winner.sourceCount >= policy.minimumAgreementCount &&
      winner.distinctSourceOriginCount >= policy.minimumDistinctSourceOrigins,
  );
  const policyFailed = diagnostics.some((diagnostic) =>
    [
      "checkpoint_unexpected",
      "selection_set_unexpected",
      "selection_chain_tail_unexpected",
      "selection_count_below_minimum",
      "required_source_origin_missing",
      "required_signer_missing",
    ].includes(diagnostic),
  );
  const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum["status"] =
    eligibleSources.length < policy.minimumSources && staleSourceCount > 0
      ? "stale"
      : eligibleSources.length < policy.minimumSources
        ? "insufficient_sources"
        : policyFailed
          ? "policy_failed"
          : agreementSatisfied
            ? "agreed"
            : "split";
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    generatedAt,
    status,
    diagnostics,
    policy,
    policySha256:
      hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
        policy,
      ),
    sourceCount: sources.length,
    eligibleSourceCount: eligibleSources.length,
    staleSourceCount,
    candidateCount: candidates.length,
    agreementCount: winner?.sourceCount ?? 0,
    agreementDistinctSourceOriginCount: winner?.distinctSourceOriginCount ?? 0,
    agreementSignerCount: winner?.signerCount ?? 0,
    ...(winner
      ? {
          selectedCheckpointSha256: winner.checkpointSha256,
          selectedSelectionSetSha256: winner.selectionSetSha256,
          ...(winner.selectionChainTailSha256
            ? { selectedSelectionChainTailSha256: winner.selectionChainTailSha256 }
            : {}),
        }
      : {}),
    sources,
    candidates,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust checkpoint registry quorum is invalid",
    );
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
    "eligibleSourceCount",
    "staleSourceCount",
    "candidateCount",
    "agreementCount",
    "agreementDistinctSourceOriginCount",
    "agreementSignerCount",
    "selectedCheckpointSha256",
    "selectedSelectionSetSha256",
    "selectedSelectionChainTailSha256",
    "sources",
    "candidates",
    "contentSha256",
  ]);
  const quorum =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
      quorum.policy,
    );
  const sources = validateCheckpointRegistrySources(quorum.sources);
  const candidates = validateCheckpointRegistryCandidates(quorum.candidates);
  const eligibleSources = sources.filter(
    (source) => source.status === "eligible" && source.checkpointSha256,
  );
  const staleSourceCount = sources.filter(
    (source) => source.status === "stale",
  ).length;
  const selectedCandidate = quorum.selectedCheckpointSha256
    ? candidates.find(
        (candidate) =>
          candidate.checkpointSha256 === quorum.selectedCheckpointSha256,
      )
    : undefined;
  if (
    quorum.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum" ||
    quorum.schemaVersion !== 1 ||
    quorum.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(quorum.generatedAt) ||
    !validCheckpointRegistryQuorumStatus(quorum.status) ||
    !validDiagnostics(quorum.diagnostics) ||
    quorum.policySha256 !==
      hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
        policy,
      ) ||
    !nonNegativeInteger(quorum.sourceCount) ||
    !nonNegativeInteger(quorum.eligibleSourceCount) ||
    !nonNegativeInteger(quorum.staleSourceCount) ||
    !nonNegativeInteger(quorum.candidateCount) ||
    !nonNegativeInteger(quorum.agreementCount) ||
    !nonNegativeInteger(quorum.agreementDistinctSourceOriginCount) ||
    !nonNegativeInteger(quorum.agreementSignerCount) ||
    (quorum.selectedCheckpointSha256 !== undefined &&
      !SHA256_PATTERN.test(quorum.selectedCheckpointSha256)) ||
    (quorum.selectedSelectionSetSha256 !== undefined &&
      !SHA256_PATTERN.test(quorum.selectedSelectionSetSha256)) ||
    (quorum.selectedSelectionChainTailSha256 !== undefined &&
      !SHA256_PATTERN.test(quorum.selectedSelectionChainTailSha256)) ||
    !SHA256_PATTERN.test(quorum.contentSha256) ||
    quorum.sourceCount !== sources.length ||
    quorum.eligibleSourceCount !== eligibleSources.length ||
    quorum.staleSourceCount !== staleSourceCount ||
    quorum.candidateCount !== candidates.length ||
    quorum.agreementCount !== (selectedCandidate?.sourceCount ?? 0) ||
    quorum.agreementDistinctSourceOriginCount !==
      (selectedCandidate?.distinctSourceOriginCount ?? 0) ||
    quorum.agreementSignerCount !== (selectedCandidate?.signerCount ?? 0) ||
    quorum.selectedSelectionSetSha256 !==
      selectedCandidate?.selectionSetSha256 ||
    quorum.selectedSelectionChainTailSha256 !==
      selectedCandidate?.selectionChainTailSha256 ||
    (quorum.status === "agreed" && !selectedCandidate)
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum is invalid",
    );
  }
  const content = {
    kind: quorum.kind,
    schemaVersion: quorum.schemaVersion,
    apiVersion: quorum.apiVersion,
    generatedAt: quorum.generatedAt,
    status: quorum.status,
    diagnostics: quorum.diagnostics,
    policy,
    policySha256: quorum.policySha256,
    sourceCount: quorum.sourceCount,
    eligibleSourceCount: quorum.eligibleSourceCount,
    staleSourceCount: quorum.staleSourceCount,
    candidateCount: quorum.candidateCount,
    agreementCount: quorum.agreementCount,
    agreementDistinctSourceOriginCount:
      quorum.agreementDistinctSourceOriginCount,
    agreementSignerCount: quorum.agreementSignerCount,
    ...(quorum.selectedCheckpointSha256
      ? { selectedCheckpointSha256: quorum.selectedCheckpointSha256 }
      : {}),
    ...(quorum.selectedSelectionSetSha256
      ? { selectedSelectionSetSha256: quorum.selectedSelectionSetSha256 }
      : {}),
    ...(quorum.selectedSelectionChainTailSha256
      ? {
          selectedSelectionChainTailSha256:
            quorum.selectedSelectionChainTailSha256,
        }
      : {}),
    sources,
    candidates,
  };
  if (sha256(canonicalJson(content)) !== quorum.contentSha256) {
    throw new Error(
      "Receipt trust checkpoint registry quorum hash mismatch",
    );
  }
  return structuredClone({
    ...quorum,
    policy,
    sources,
    candidates,
  });
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  baseline: Omit<
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
    "contentSha256"
  >,
): string {
  return sha256(canonicalJson(baseline));
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  envelopeInput: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
  promotedByThreadId: string,
  supersedesBaselineId?: string,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline {
  const envelope = validateTrustedReceiptEnvelope(
    envelopeInput,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>;
  if (
    envelope.receiptKind !==
    "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum"
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum baseline requires a checkpoint registry quorum receipt",
    );
  }
  const quorum =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
      envelope.receipt,
    );
  const candidate = selectedCheckpointRegistryCandidate(quorum);
  const content = {
    id: createId("trustcpqb"),
    envelope: {
      ...envelope,
      receipt: quorum,
    },
    promotedByThreadId,
    selectedCheckpointSha256: quorum.selectedCheckpointSha256!,
    selectedSelectionSetSha256: quorum.selectedSelectionSetSha256!,
    ...(quorum.selectedSelectionChainTailSha256
      ? {
          selectedSelectionChainTailSha256:
            quorum.selectedSelectionChainTailSha256,
        }
      : {}),
    selectedSubscriptionSetSha256: candidate.subscriptionSetSha256,
    selectedSourceOriginSetSha256: candidate.sourceOriginSetSha256,
    selectedSignerSetSha256: candidate.signerSetSha256,
    ...(supersedesBaselineId ? { supersedesBaselineId } : {}),
    createdAt: nowIso(),
  };
  return {
    ...content,
    contentSha256:
      hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        content,
      ),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  value: unknown,
  anchors?: ReceiptTrustAnchor[],
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust checkpoint registry quorum baseline is invalid",
    );
  }
  assertAllowedKeys(value, [
    "id",
    "envelope",
    "promotedByThreadId",
    "selectedCheckpointSha256",
    "selectedSelectionSetSha256",
    "selectedSelectionChainTailSha256",
    "selectedSubscriptionSetSha256",
    "selectedSourceOriginSetSha256",
    "selectedSignerSetSha256",
    "supersedesBaselineId",
    "createdAt",
    "contentSha256",
  ]);
  const baseline =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  const envelope = validateTrustedReceiptEnvelope(
    baseline.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>;
  const quorum =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
      envelope.receipt,
    );
  const candidate = selectedCheckpointRegistryCandidate(quorum);
  if (
    !/^trustcpqb_[a-z0-9]{8,80}$/.test(baseline.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(baseline.promotedByThreadId) ||
    !SHA256_PATTERN.test(baseline.selectedCheckpointSha256) ||
    !SHA256_PATTERN.test(baseline.selectedSelectionSetSha256) ||
    (baseline.selectedSelectionChainTailSha256 !== undefined &&
      !SHA256_PATTERN.test(baseline.selectedSelectionChainTailSha256)) ||
    !SHA256_PATTERN.test(baseline.selectedSubscriptionSetSha256) ||
    !SHA256_PATTERN.test(baseline.selectedSourceOriginSetSha256) ||
    !SHA256_PATTERN.test(baseline.selectedSignerSetSha256) ||
    (baseline.supersedesBaselineId !== undefined &&
      !/^trustcpqb_[a-z0-9]{8,80}$/.test(baseline.supersedesBaselineId)) ||
    !validTimestamp(baseline.createdAt) ||
    !SHA256_PATTERN.test(baseline.contentSha256) ||
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum" ||
    quorum.status !== "agreed" ||
    quorum.selectedCheckpointSha256 !== baseline.selectedCheckpointSha256 ||
    quorum.selectedSelectionSetSha256 !==
      baseline.selectedSelectionSetSha256 ||
    quorum.selectedSelectionChainTailSha256 !==
      baseline.selectedSelectionChainTailSha256 ||
    candidate.subscriptionSetSha256 !==
      baseline.selectedSubscriptionSetSha256 ||
    candidate.sourceOriginSetSha256 !==
      baseline.selectedSourceOriginSetSha256 ||
    candidate.signerSetSha256 !== baseline.selectedSignerSetSha256
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum baseline is invalid",
    );
  }
  if (anchors) {
    const verification = verifyTrustedReceiptEnvelope(envelope, anchors);
    if (!verification.integrityValid || !verification.signatureValid) {
      throw new Error(
        `Receipt trust checkpoint registry quorum baseline signature is invalid: ${verification.reason}`,
      );
    }
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...baseline,
    envelope: {
      ...envelope,
      receipt: quorum,
    },
  };
  if (
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
      content,
    ) !== baseline.contentSha256
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum baseline hash mismatch",
    );
  }
  return structuredClone({
    ...baseline,
    envelope: {
      ...envelope,
      receipt: quorum,
    },
  });
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  value: unknown,
  anchors: ReceiptTrustAnchor[],
  options: {
    trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
  } = {},
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification {
  const verifiedAt = nowIso();
  let baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  try {
    baseline =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        value,
      );
  } catch {
    return createCheckpointRegistryQuorumBaselineVerification({
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
    return createCheckpointRegistryQuorumBaselineVerification({
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
  return createCheckpointRegistryQuorumBaselineVerification({
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

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "proposedAt",
    "status",
    "diagnostics",
    "activationDecisionRecordId",
    "activationDecisionRecordSha256",
    "expectedCurrentSelectionSha256",
    "currentSelectionSha256",
    "rotationReview",
    "rotationReviewSha256",
    "checkpointRegistryQuorumBaselineId",
    "expectedCheckpointRegistryQuorumBaselineSha256",
    "checkpointRegistryQuorumBaselineSha256",
    "checkpointRegistryQuorumBaselineEnvelopeSha256",
    "checkpointRegistryQuorumSha256",
    "selectedCheckpointSha256",
    "selectedSelectionSetSha256",
    "selectedSelectionChainTailSha256",
    "selectedSubscriptionSetSha256",
    "selectedSourceOriginSetSha256",
    "selectedSignerSetSha256",
    "currentCheckpointSha256",
    "currentSelectionSetSha256",
    "currentSelectionChainTailSha256",
    "checkpointRegistryQuorumBaseline",
    "contentSha256",
  ]);
  const proposal =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
  const rotationReview =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview(
      proposal.rotationReview,
    );
  const checkpointRegistryQuorumBaseline =
    proposal.checkpointRegistryQuorumBaseline === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          proposal.checkpointRegistryQuorumBaseline,
        );
  if (
    proposal.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal" ||
    proposal.schemaVersion !== 1 ||
    proposal.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(proposal.proposedAt) ||
    !validRotationProposalStatus(proposal.status) ||
    !validDiagnostics(proposal.diagnostics) ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(proposal.activationDecisionRecordId) ||
    !optionalSha256(proposal.activationDecisionRecordSha256) ||
    (proposal.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(proposal.expectedCurrentSelectionSha256)) ||
    (proposal.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(proposal.currentSelectionSha256)) ||
    proposal.rotationReviewSha256 !== rotationReview.contentSha256 ||
    (proposal.checkpointRegistryQuorumBaselineId !== undefined &&
      !/^trustcpqb_[a-z0-9]{8,80}$/.test(
        proposal.checkpointRegistryQuorumBaselineId,
      )) ||
    !optionalSha256(proposal.expectedCheckpointRegistryQuorumBaselineSha256) ||
    !optionalSha256(proposal.checkpointRegistryQuorumBaselineSha256) ||
    !optionalSha256(proposal.checkpointRegistryQuorumBaselineEnvelopeSha256) ||
    !optionalSha256(proposal.checkpointRegistryQuorumSha256) ||
    !optionalSha256(proposal.selectedCheckpointSha256) ||
    !optionalSha256(proposal.selectedSelectionSetSha256) ||
    !optionalSha256(proposal.selectedSelectionChainTailSha256) ||
    !optionalSha256(proposal.selectedSubscriptionSetSha256) ||
    !optionalSha256(proposal.selectedSourceOriginSetSha256) ||
    !optionalSha256(proposal.selectedSignerSetSha256) ||
    !SHA256_PATTERN.test(proposal.currentCheckpointSha256) ||
    !SHA256_PATTERN.test(proposal.currentSelectionSetSha256) ||
    !optionalSha256(proposal.currentSelectionChainTailSha256) ||
    !SHA256_PATTERN.test(proposal.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal is invalid",
    );
  }
  if (checkpointRegistryQuorumBaseline) {
    if (
      proposal.checkpointRegistryQuorumBaselineId !==
        checkpointRegistryQuorumBaseline.id ||
      proposal.checkpointRegistryQuorumBaselineSha256 !==
        checkpointRegistryQuorumBaseline.contentSha256 ||
      proposal.checkpointRegistryQuorumBaselineEnvelopeSha256 !==
        checkpointRegistryQuorumBaseline.envelope.contentSha256 ||
      proposal.checkpointRegistryQuorumSha256 !==
        checkpointRegistryQuorumBaseline.envelope.receipt.contentSha256 ||
      proposal.selectedCheckpointSha256 !==
        checkpointRegistryQuorumBaseline.selectedCheckpointSha256 ||
      proposal.selectedSelectionSetSha256 !==
        checkpointRegistryQuorumBaseline.selectedSelectionSetSha256 ||
      (proposal.selectedSelectionChainTailSha256 ?? "") !==
        (checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256 ??
          "") ||
      proposal.selectedSubscriptionSetSha256 !==
        checkpointRegistryQuorumBaseline.selectedSubscriptionSetSha256 ||
      proposal.selectedSourceOriginSetSha256 !==
        checkpointRegistryQuorumBaseline.selectedSourceOriginSetSha256 ||
      proposal.selectedSignerSetSha256 !==
        checkpointRegistryQuorumBaseline.selectedSignerSetSha256
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal baseline binding is invalid",
      );
    }
  }
  const content = {
    kind: proposal.kind,
    schemaVersion: proposal.schemaVersion,
    apiVersion: proposal.apiVersion,
    proposedAt: proposal.proposedAt,
    status: proposal.status,
    diagnostics: proposal.diagnostics,
    activationDecisionRecordId: proposal.activationDecisionRecordId,
    ...(proposal.activationDecisionRecordSha256
      ? {
          activationDecisionRecordSha256:
            proposal.activationDecisionRecordSha256,
        }
      : {}),
    expectedCurrentSelectionSha256:
      proposal.expectedCurrentSelectionSha256,
    currentSelectionSha256: proposal.currentSelectionSha256,
    rotationReview,
    rotationReviewSha256: proposal.rotationReviewSha256,
    ...(proposal.checkpointRegistryQuorumBaselineId
      ? {
          checkpointRegistryQuorumBaselineId:
            proposal.checkpointRegistryQuorumBaselineId,
        }
      : {}),
    ...(proposal.expectedCheckpointRegistryQuorumBaselineSha256
      ? {
          expectedCheckpointRegistryQuorumBaselineSha256:
            proposal.expectedCheckpointRegistryQuorumBaselineSha256,
        }
      : {}),
    ...(proposal.checkpointRegistryQuorumBaselineSha256
      ? {
          checkpointRegistryQuorumBaselineSha256:
            proposal.checkpointRegistryQuorumBaselineSha256,
        }
      : {}),
    ...(proposal.checkpointRegistryQuorumBaselineEnvelopeSha256
      ? {
          checkpointRegistryQuorumBaselineEnvelopeSha256:
            proposal.checkpointRegistryQuorumBaselineEnvelopeSha256,
        }
      : {}),
    ...(proposal.checkpointRegistryQuorumSha256
      ? { checkpointRegistryQuorumSha256: proposal.checkpointRegistryQuorumSha256 }
      : {}),
    ...(proposal.selectedCheckpointSha256
      ? { selectedCheckpointSha256: proposal.selectedCheckpointSha256 }
      : {}),
    ...(proposal.selectedSelectionSetSha256
      ? { selectedSelectionSetSha256: proposal.selectedSelectionSetSha256 }
      : {}),
    ...(proposal.selectedSelectionChainTailSha256
      ? {
          selectedSelectionChainTailSha256:
            proposal.selectedSelectionChainTailSha256,
        }
      : {}),
    ...(proposal.selectedSubscriptionSetSha256
      ? { selectedSubscriptionSetSha256: proposal.selectedSubscriptionSetSha256 }
      : {}),
    ...(proposal.selectedSourceOriginSetSha256
      ? { selectedSourceOriginSetSha256: proposal.selectedSourceOriginSetSha256 }
      : {}),
    ...(proposal.selectedSignerSetSha256
      ? { selectedSignerSetSha256: proposal.selectedSignerSetSha256 }
      : {}),
    currentCheckpointSha256: proposal.currentCheckpointSha256,
    currentSelectionSetSha256: proposal.currentSelectionSetSha256,
    ...(proposal.currentSelectionChainTailSha256
      ? {
          currentSelectionChainTailSha256:
            proposal.currentSelectionChainTailSha256,
        }
      : {}),
    ...(checkpointRegistryQuorumBaseline
      ? { checkpointRegistryQuorumBaseline }
      : {}),
  };
  if (proposal.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal hash mismatch",
    );
  }
  return {
    ...proposal,
    rotationReview,
    ...(checkpointRegistryQuorumBaseline
      ? { checkpointRegistryQuorumBaseline }
      : {}),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "approvedAt",
    "approvedByThreadId",
    "subscriptionId",
    "subscriptionRevision",
    "subscriptionSha256",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "policySha256",
    "discoverySha256",
    "envelopeSha256",
    "proposalSha256",
    "proposalReviewSha256",
    "approvalPreflightSha256",
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "checkpointRegistryQuorumBaselineSha256",
    "proposalSignerKeyId",
    "proposalSignedAt",
    "expiresAt",
    "contentSha256",
  ]);
  const approval =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval;
  if (
    approval.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval" ||
    approval.schemaVersion !== 1 ||
    approval.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(approval.approvedAt) ||
    !/^thread_[a-z0-9]{8,80}$/.test(approval.approvedByThreadId) ||
    !ROTATION_PROPOSAL_SUBSCRIPTION_ID_PATTERN.test(approval.subscriptionId) ||
    !Number.isSafeInteger(approval.subscriptionRevision) ||
    approval.subscriptionRevision < 1 ||
    !SHA256_PATTERN.test(approval.subscriptionSha256) ||
    !SHA256_PATTERN.test(approval.sourceUrlSha256) ||
    !SHA256_PATTERN.test(approval.sourceOriginSha256) ||
    !SHA256_PATTERN.test(approval.policySha256) ||
    !SHA256_PATTERN.test(approval.discoverySha256) ||
    !SHA256_PATTERN.test(approval.envelopeSha256) ||
    !SHA256_PATTERN.test(approval.proposalSha256) ||
    !SHA256_PATTERN.test(approval.proposalReviewSha256) ||
    !SHA256_PATTERN.test(approval.approvalPreflightSha256) ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(approval.activationDecisionRecordId) ||
    (approval.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(approval.expectedCurrentSelectionSha256)) ||
    !optionalSha256(approval.checkpointRegistryQuorumBaselineSha256) ||
    !SHA256_PATTERN.test(approval.proposalSignerKeyId) ||
    !validTimestamp(approval.proposalSignedAt) ||
    !optionalTimestamp(approval.expiresAt) ||
    !SHA256_PATTERN.test(approval.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval is invalid",
    );
  }
  if (
    approval.expiresAt !== undefined &&
    Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval expiry is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = approval;
  if (approval.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval hash mismatch",
    );
  }
  return structuredClone(approval);
}

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy {
  if (!isRecord(input)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy is invalid",
    );
  }
  assertAllowedKeys(input, [
    "minimumDistinctSignerCount",
    "requiredSignerKeyIds",
  ]);
  const minimumDistinctSignerCount = input["minimumDistinctSignerCount"];
  const requiredSignerKeyIdsInput = input["requiredSignerKeyIds"];
  if (
    typeof minimumDistinctSignerCount !== "number" ||
    !Number.isSafeInteger(minimumDistinctSignerCount) ||
    minimumDistinctSignerCount < 1 ||
    minimumDistinctSignerCount > 20 ||
    (requiredSignerKeyIdsInput !== undefined &&
      (!Array.isArray(requiredSignerKeyIdsInput) ||
        requiredSignerKeyIdsInput.length > 20 ||
        !requiredSignerKeyIdsInput.every(
          (keyId) => typeof keyId === "string" && SHA256_PATTERN.test(keyId),
        )))
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy is invalid",
    );
  }
  const requiredSignerKeyIds =
    requiredSignerKeyIdsInput === undefined
      ? []
      : Array.from(new Set(requiredSignerKeyIdsInput as string[])).sort();
  return {
    minimumDistinctSignerCount,
    ...(requiredSignerKeyIds.length > 0 ? { requiredSignerKeyIds } : {}),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "reviewedAt",
    "status",
    "diagnostics",
    "subscriptionId",
    "subscriptionRevision",
    "subscriptionSha256",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "subscriptionPolicySha256",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "approvalPolicy",
    "approvalPolicySha256",
    "approvalEnvelopeCount",
    "acceptedApprovalCount",
    "distinctSignerCount",
    "requiredSignerCount",
    "approvalEnvelopeSetSha256",
    "acceptedApprovalEnvelopeSetSha256",
    "signerSetSha256",
    "requiredSignerSetSha256",
    "approvalEnvelopeSha256s",
    "acceptedApprovalEnvelopeSha256s",
    "acceptedApprovalSignerKeyIds",
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "proposalEnvelopeSha256",
    "proposalSha256",
    "proposalReviewSha256",
    "currentPreflightSha256",
    "checkpointRegistryQuorumBaselineSha256",
    "contentSha256",
  ]);
  const review =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview;
  const diagnostics = [...review.diagnostics];
  const approvalPolicy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy(
      review.approvalPolicy,
    );
  const approvalEnvelopeSha256s = validateSha256List(
    review.approvalEnvelopeSha256s,
    "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review envelope set",
  );
  const acceptedApprovalEnvelopeSha256s = validateSha256List(
    review.acceptedApprovalEnvelopeSha256s,
    "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review accepted envelope set",
  );
  const acceptedApprovalSignerKeyIds = validateSha256List(
    review.acceptedApprovalSignerKeyIds,
    "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review signer set",
  );
  const requiredSignerKeyIds = approvalPolicy.requiredSignerKeyIds ?? [];
  if (
    review.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-review" ||
    review.schemaVersion !== 1 ||
    review.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(review.reviewedAt) ||
    (review.status !== "accepted" && review.status !== "rejected") ||
    !validDiagnostics(diagnostics) ||
    !ROTATION_PROPOSAL_SUBSCRIPTION_ID_PATTERN.test(review.subscriptionId) ||
    !Number.isSafeInteger(review.subscriptionRevision) ||
    review.subscriptionRevision < 1 ||
    !SHA256_PATTERN.test(review.subscriptionSha256) ||
    !SHA256_PATTERN.test(review.sourceUrlSha256) ||
    !SHA256_PATTERN.test(review.sourceOriginSha256) ||
    !SHA256_PATTERN.test(review.subscriptionPolicySha256) ||
    !Number.isSafeInteger(review.expectedSubscriptionRevision) ||
    review.expectedSubscriptionRevision < 1 ||
    !SHA256_PATTERN.test(review.expectedSubscriptionSha256) ||
    review.approvalPolicySha256 !== sha256(canonicalJson(approvalPolicy)) ||
    !nonNegativeInteger(review.approvalEnvelopeCount) ||
    review.approvalEnvelopeCount !== approvalEnvelopeSha256s.length ||
    !nonNegativeInteger(review.acceptedApprovalCount) ||
    review.acceptedApprovalCount !== acceptedApprovalEnvelopeSha256s.length ||
    !nonNegativeInteger(review.distinctSignerCount) ||
    review.distinctSignerCount !== acceptedApprovalSignerKeyIds.length ||
    !nonNegativeInteger(review.requiredSignerCount) ||
    review.requiredSignerCount !== requiredSignerKeyIds.length ||
    review.approvalEnvelopeSetSha256 !==
      sha256(canonicalJson(approvalEnvelopeSha256s)) ||
    review.acceptedApprovalEnvelopeSetSha256 !==
      sha256(canonicalJson(acceptedApprovalEnvelopeSha256s)) ||
    review.signerSetSha256 !== sha256(canonicalJson(acceptedApprovalSignerKeyIds)) ||
    (requiredSignerKeyIds.length > 0
      ? review.requiredSignerSetSha256 !==
        sha256(canonicalJson(requiredSignerKeyIds))
      : review.requiredSignerSetSha256 !== undefined) ||
    (review.activationDecisionRecordId !== undefined &&
      !/^trustqad_[a-z0-9]{8,80}$/.test(review.activationDecisionRecordId)) ||
    (review.expectedCurrentSelectionSha256 !== undefined &&
      review.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(review.expectedCurrentSelectionSha256)) ||
    !optionalSha256(review.proposalEnvelopeSha256) ||
    !optionalSha256(review.proposalSha256) ||
    !optionalSha256(review.proposalReviewSha256) ||
    !optionalSha256(review.currentPreflightSha256) ||
    !optionalSha256(review.checkpointRegistryQuorumBaselineSha256) ||
    !SHA256_PATTERN.test(review.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...review,
    diagnostics,
    approvalPolicy,
    approvalEnvelopeSha256s,
    acceptedApprovalEnvelopeSha256s,
    acceptedApprovalSignerKeyIds,
  };
  if (review.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review hash mismatch",
    );
  }
  return structuredClone({
    ...review,
    diagnostics,
    approvalPolicy,
    approvalEnvelopeSha256s,
    acceptedApprovalEnvelopeSha256s,
    acceptedApprovalSignerKeyIds,
  });
}

export function validateApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult(
  value: unknown,
): ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply result is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "appliedAt",
    "policyReview",
    "policyReviewSha256",
    "result",
    "resultSha256",
    "contentSha256",
  ]);
  const applyResult =
    value as unknown as ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult;
  const policyReview =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
      applyResult.policyReview,
    );
  if (
    applyResult.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-apply" ||
    applyResult.schemaVersion !== 1 ||
    applyResult.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(applyResult.appliedAt) ||
    applyResult.policyReviewSha256 !== policyReview.contentSha256 ||
    !isRecord(applyResult.result) ||
    !SHA256_PATTERN.test(applyResult.resultSha256) ||
    applyResult.resultSha256 !== applyResult.result["contentSha256"] ||
    !SHA256_PATTERN.test(applyResult.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply result is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...applyResult,
    policyReview,
  };
  if (applyResult.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply result hash mismatch",
    );
  }
  return structuredClone({
    ...applyResult,
    policyReview,
  });
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
  baseline: Omit<
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
    "contentSha256"
  >,
): string {
  return sha256(canonicalJson(baseline));
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
  promotedByThreadId: string,
  envelopeInput: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
  supersedesBaselineId?: string,
  createdAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline {
  const envelope = validateTrustedReceiptEnvelope(
    envelopeInput,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>;
  const policyReview =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
      envelope.receipt,
    );
  const createdAt = requireTimestamp(
    createdAtInput,
    "anchor directory quorum activation selection rotation proposal approval policy baseline time",
  );
  if (
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review" ||
    policyReview.status !== "accepted" ||
    !/^thread_[a-z0-9]{8,80}$/.test(promotedByThreadId) ||
    (supersedesBaselineId !== undefined &&
      !/^trustapb_[a-z0-9]{8,80}$/.test(supersedesBaselineId))
  ) {
    throw new Error(
      "Receipt trust rotation proposal approval policy baseline is invalid",
    );
  }
  const content = {
    id: createId("trustapb"),
    envelope,
    promotedByThreadId,
    approvalPolicySha256: policyReview.approvalPolicySha256,
    subscriptionSha256: policyReview.subscriptionSha256,
    ...(policyReview.proposalSha256
      ? { proposalSha256: policyReview.proposalSha256 }
      : {}),
    acceptedApprovalEnvelopeSetSha256:
      policyReview.acceptedApprovalEnvelopeSetSha256,
    signerSetSha256: policyReview.signerSetSha256,
    ...(policyReview.requiredSignerSetSha256
      ? { requiredSignerSetSha256: policyReview.requiredSignerSetSha256 }
      : {}),
    ...(supersedesBaselineId ? { supersedesBaselineId } : {}),
    createdAt,
  };
  return {
    ...content,
    contentSha256:
      hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
        content,
      ),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
  value: unknown,
  anchors?: ReceiptTrustAnchor[],
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust rotation proposal approval policy baseline is invalid",
    );
  }
  assertAllowedKeys(value, [
    "id",
    "envelope",
    "promotedByThreadId",
    "approvalPolicySha256",
    "subscriptionSha256",
    "proposalSha256",
    "acceptedApprovalEnvelopeSetSha256",
    "signerSetSha256",
    "requiredSignerSetSha256",
    "supersedesBaselineId",
    "createdAt",
    "contentSha256",
  ]);
  const baseline =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
  const envelope = validateTrustedReceiptEnvelope(
    baseline.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>;
  const policyReview =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
      envelope.receipt,
    );
  if (
    !/^trustapb_[a-z0-9]{8,80}$/.test(baseline.id) ||
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review" ||
    policyReview.status !== "accepted" ||
    !/^thread_[a-z0-9]{8,80}$/.test(baseline.promotedByThreadId) ||
    baseline.approvalPolicySha256 !== policyReview.approvalPolicySha256 ||
    baseline.subscriptionSha256 !== policyReview.subscriptionSha256 ||
    (baseline.proposalSha256 ?? "") !== (policyReview.proposalSha256 ?? "") ||
    baseline.acceptedApprovalEnvelopeSetSha256 !==
      policyReview.acceptedApprovalEnvelopeSetSha256 ||
    baseline.signerSetSha256 !== policyReview.signerSetSha256 ||
    (baseline.requiredSignerSetSha256 ?? "") !==
      (policyReview.requiredSignerSetSha256 ?? "") ||
    (baseline.supersedesBaselineId !== undefined &&
      !/^trustapb_[a-z0-9]{8,80}$/.test(baseline.supersedesBaselineId)) ||
    !validTimestamp(baseline.createdAt) ||
    !SHA256_PATTERN.test(baseline.contentSha256)
  ) {
    throw new Error(
      "Receipt trust rotation proposal approval policy baseline is invalid",
    );
  }
  if (anchors) {
    const verification = verifyTrustedReceiptEnvelope(envelope, anchors);
    if (!verification.integrityValid || !verification.signatureValid) {
      throw new Error(
        `Receipt trust rotation proposal approval policy baseline signature is invalid: ${verification.reason}`,
      );
    }
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...baseline,
    envelope,
  };
  if (
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
      content,
    ) !== baseline.contentSha256
  ) {
    throw new Error(
      "Receipt trust rotation proposal approval policy baseline hash mismatch",
    );
  }
  return structuredClone({
    ...baseline,
    envelope,
  });
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
  value: unknown,
  anchors: ReceiptTrustAnchor[],
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification {
  let baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
  try {
    baseline =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
        value,
      );
  } catch {
    return createRotationProposalApprovalPolicyBaselineVerification({
      status: "invalid",
      diagnostics: ["baseline_invalid"],
      baselineValid: false,
      signatureValid: false,
      integrityValid: false,
    });
  }
  let verification: TrustedReceiptVerification;
  try {
    verification = verifyTrustedReceiptEnvelope(baseline.envelope, anchors);
  } catch {
    return createRotationProposalApprovalPolicyBaselineVerification({
      status: "invalid",
      diagnostics: ["trusted_receipt_invalid"],
      baseline,
      baselineValid: true,
      signatureValid: false,
      integrityValid: false,
    });
  }
  return createRotationProposalApprovalPolicyBaselineVerification({
    status: verification.status,
    diagnostics:
      verification.status === "trusted"
        ? []
        : [`trusted_receipt_${verification.status}`],
    baseline,
    baselineValid: true,
    signatureValid: verification.signatureValid,
    integrityValid: verification.integrityValid,
  });
}

function createRotationProposalApprovalPolicyBaselineVerification(input: {
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification["status"];
  diagnostics: string[];
  baselineValid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  baseline?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-baseline-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    verifiedAt: nowIso(),
    status: input.status,
    diagnostics: input.diagnostics,
    baselineValid: input.baselineValid,
    signatureValid: input.signatureValid,
    integrityValid: input.integrityValid,
    ...(input.baseline
      ? {
          baselineSha256: input.baseline.contentSha256,
          envelopeSha256: input.baseline.envelope.contentSha256,
          policyReviewSha256: input.baseline.envelope.receipt.contentSha256,
          receiptArtifactSha256:
            input.baseline.envelope.signature.receiptArtifactSha256,
          keyId: input.baseline.envelope.signature.keyId,
          approvalPolicySha256: input.baseline.approvalPolicySha256,
          subscriptionSha256: input.baseline.subscriptionSha256,
          acceptedApprovalEnvelopeSetSha256:
            input.baseline.acceptedApprovalEnvelopeSetSha256,
          signerSetSha256: input.baseline.signerSetSha256,
          ...(input.baseline.requiredSignerSetSha256
            ? {
                requiredSignerSetSha256:
                  input.baseline.requiredSignerSetSha256,
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

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "replayedAt",
    "status",
    "diagnostics",
    "subscriptionId",
    "subscriptionRevision",
    "subscriptionSha256",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "policySha256",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "currentSelectionSha256",
    "selectionStateSha256",
    "activeSelectionSha256",
    "activeActivationDecisionRecordId",
    "approvalVerifierSelectionSha256",
    "approvalVerifierDirectorySha256",
    "approvalEnvelopeSha256",
    "approvalSha256",
    "approvalTrustedReceiptVerificationStatus",
    "approvalTrustedReceiptVerificationReason",
    "approvalTrustedReceiptVerificationKeyId",
    "proposalEnvelopeSha256",
    "proposalSha256",
    "proposalReviewSha256",
    "approvalPreflightSha256",
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "checkpointRegistryQuorumBaselineSha256",
    "contentSha256",
  ]);
  const replay =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay;
  const diagnostics = [...replay.diagnostics];
  if (
    replay.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-apply-replay" ||
    replay.schemaVersion !== 1 ||
    replay.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(replay.replayedAt) ||
    (replay.status !== "aligned" &&
      replay.status !== "divergent" &&
      replay.status !== "invalid") ||
    !validDiagnostics(diagnostics) ||
    !ROTATION_PROPOSAL_SUBSCRIPTION_ID_PATTERN.test(replay.subscriptionId) ||
    !Number.isSafeInteger(replay.subscriptionRevision) ||
    replay.subscriptionRevision < 1 ||
    !SHA256_PATTERN.test(replay.subscriptionSha256) ||
    !SHA256_PATTERN.test(replay.sourceUrlSha256) ||
    !SHA256_PATTERN.test(replay.sourceOriginSha256) ||
    !SHA256_PATTERN.test(replay.policySha256) ||
    !Number.isSafeInteger(replay.expectedSubscriptionRevision) ||
    replay.expectedSubscriptionRevision < 1 ||
    !SHA256_PATTERN.test(replay.expectedSubscriptionSha256) ||
    (replay.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(replay.currentSelectionSha256)) ||
    !SHA256_PATTERN.test(replay.selectionStateSha256) ||
    !optionalSha256(replay.activeSelectionSha256) ||
    (replay.activeActivationDecisionRecordId !== undefined &&
      !/^trustqad_[a-z0-9]{8,80}$/.test(
        replay.activeActivationDecisionRecordId,
      )) ||
    !optionalSha256(replay.approvalVerifierSelectionSha256) ||
    !optionalSha256(replay.approvalVerifierDirectorySha256) ||
    !optionalSha256(replay.approvalEnvelopeSha256) ||
    !optionalSha256(replay.approvalSha256) ||
    !optionalTrustedReceiptStatus(
      replay.approvalTrustedReceiptVerificationStatus,
    ) ||
    (replay.approvalTrustedReceiptVerificationReason !== undefined &&
      typeof replay.approvalTrustedReceiptVerificationReason !== "string") ||
    !optionalSha256(replay.approvalTrustedReceiptVerificationKeyId) ||
    !optionalSha256(replay.proposalEnvelopeSha256) ||
    !optionalSha256(replay.proposalSha256) ||
    !optionalSha256(replay.proposalReviewSha256) ||
    !optionalSha256(replay.approvalPreflightSha256) ||
    (replay.activationDecisionRecordId !== undefined &&
      !/^trustqad_[a-z0-9]{8,80}$/.test(replay.activationDecisionRecordId)) ||
    (replay.expectedCurrentSelectionSha256 !== undefined &&
      replay.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(replay.expectedCurrentSelectionSha256)) ||
    !optionalSha256(replay.checkpointRegistryQuorumBaselineSha256) ||
    !SHA256_PATTERN.test(replay.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...replay,
    diagnostics,
  };
  if (replay.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay hash mismatch",
    );
  }
  return structuredClone({
    ...replay,
    diagnostics,
  });
}

function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation review is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "reviewedAt",
    "status",
    "diagnostics",
    "expectedCurrentSelectionSha256",
    "currentSelectionSha256",
    "activationDecisionRecordId",
    "activationDecisionRecordSha256",
    "baselineSha256",
    "sourceAlignmentSha256",
    "currentSourceAlignmentSha256",
    "driftAudit",
    "checkpointRegistryQuorum",
    "contentSha256",
  ]);
  const review =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
  const driftAudit =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
      review.driftAudit,
    );
  const checkpointRegistryQuorum =
    review.checkpointRegistryQuorum === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
          review.checkpointRegistryQuorum,
        );
  if (
    review.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-review" ||
    review.schemaVersion !== 1 ||
    review.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(review.reviewedAt) ||
    !validRotationReviewStatus(review.status) ||
    !validDiagnostics(review.diagnostics) ||
    (review.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(review.expectedCurrentSelectionSha256)) ||
    (review.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(review.currentSelectionSha256)) ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(review.activationDecisionRecordId) ||
    !optionalSha256(review.activationDecisionRecordSha256) ||
    !optionalSha256(review.baselineSha256) ||
    !optionalSha256(review.sourceAlignmentSha256) ||
    !optionalSha256(review.currentSourceAlignmentSha256) ||
    !SHA256_PATTERN.test(review.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation review is invalid",
    );
  }
  const content = {
    kind: review.kind,
    schemaVersion: review.schemaVersion,
    apiVersion: review.apiVersion,
    reviewedAt: review.reviewedAt,
    status: review.status,
    diagnostics: review.diagnostics,
    expectedCurrentSelectionSha256: review.expectedCurrentSelectionSha256,
    currentSelectionSha256: review.currentSelectionSha256,
    activationDecisionRecordId: review.activationDecisionRecordId,
    ...(review.activationDecisionRecordSha256
      ? {
          activationDecisionRecordSha256:
            review.activationDecisionRecordSha256,
        }
      : {}),
    ...(review.baselineSha256
      ? { baselineSha256: review.baselineSha256 }
      : {}),
    ...(review.sourceAlignmentSha256
      ? { sourceAlignmentSha256: review.sourceAlignmentSha256 }
      : {}),
    ...(review.currentSourceAlignmentSha256
      ? { currentSourceAlignmentSha256: review.currentSourceAlignmentSha256 }
      : {}),
    driftAudit,
    ...(checkpointRegistryQuorum ? { checkpointRegistryQuorum } : {}),
  };
  if (review.contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation review hash mismatch",
    );
  }
  return {
    ...review,
    driftAudit,
    ...(checkpointRegistryQuorum ? { checkpointRegistryQuorum } : {}),
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
    receipt.kind !== "napier.receipt-trust-anchor-directory-quorum-promotion" ||
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
    envelope.receiptKind !== "receipt_trust_anchor_directory_quorum_promotion"
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
    contentSha256:
      hashReceiptTrustAnchorDirectoryQuorumPromotionBaseline(content),
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
    baseline =
      validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(value);
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
    baseline =
      validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(value);
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

export function createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
  baselineInput: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  subscriptions: readonly ReceiptTrustAnchorDirectorySubscription[],
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "anchor directory quorum activation source alignment time",
  );
  const baseline =
    validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(baselineInput);
  const selectedSourceOrigins = Array.from(
    new Set(
      baseline.envelope.receipt.quorum.sources
        .filter(
          (source) =>
            source.anchorSetSha256 === baseline.selectedAnchorSetSha256,
        )
        .map((source) => source.sourceOriginSha256),
    ),
  ).sort();
  const sources = selectedSourceOrigins.map((origin) =>
    createQuorumActivationSource(
      origin,
      baseline,
      subscriptions.find(
        (subscription) =>
          subscription.status === "active" &&
          subscription.sourceOriginSha256 === origin,
      ),
    ),
  );
  const driftedSourceCount = sources.filter(
    (source) =>
      source.status === "directory_drift" ||
      source.status === "anchor_set_drift",
  ).length;
  const missingSourceCount = sources.filter(
    (source) =>
      source.status === "missing_subscription" ||
      source.status === "no_last_good",
  ).length;
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-source-alignment" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    generatedAt,
    baselineSha256: baseline.contentSha256,
    selectedAnchorSetSha256: baseline.selectedAnchorSetSha256,
    selectedDirectorySha256: baseline.selectedDirectorySha256,
    selectedSourceOriginCount: selectedSourceOrigins.length,
    selectedSourceOriginSetSha256: sha256(canonicalJson(selectedSourceOrigins)),
    alignedSourceCount: sources.filter((source) => source.status === "aligned")
      .length,
    driftedSourceCount,
    missingSourceCount,
    sources,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt(
  input: {
    baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
    verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
    policyReview: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
    sourceAlignment: ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment;
  },
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "anchor directory quorum activation decision time",
  );
  const baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    input.baseline,
  );
  const verification = validateQuorumPromotionBaselineVerification(
    input.verification,
    baseline,
  );
  const policyReview = validateQuorumPromotionBaselineImportPolicyReview(
    input.policyReview,
    baseline,
  );
  const sourceAlignment =
    validateReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
      input.sourceAlignment,
      baseline,
    );
  const diagnostics: string[] = [];
  if (
    verification.status !== "trusted" ||
    !verification.baselineValid ||
    !verification.signatureValid ||
    !verification.integrityValid
  ) {
    diagnostics.push("baseline_verification_untrusted");
  }
  if (policyReview.status !== "accepted") {
    diagnostics.push("policy_review_rejected");
  }
  if (sourceAlignment.driftedSourceCount > 0) {
    diagnostics.push("source_alignment_drift");
  }
  if (sourceAlignment.missingSourceCount > 0) {
    diagnostics.push("source_alignment_missing");
  }
  if (sourceAlignment.selectedSourceOriginCount === 0) {
    diagnostics.push("source_alignment_empty");
  }
  const metadataPublisherSetSha256 = sha256(
    canonicalJson(
      Array.from(
        new Set(
          baseline.envelope.receipt.selectedMetadata.flatMap((metadata) =>
            metadata.publisherSha256 ? [metadata.publisherSha256] : [],
          ),
        ),
      ).sort(),
    ),
  );
  const metadataSignerSetSha256 = sha256(
    canonicalJson(
      Array.from(
        new Set(
          baseline.envelope.receipt.selectedMetadata.flatMap((metadata) =>
            metadata.signerKeyId ? [metadata.signerKeyId] : [],
          ),
        ),
      ).sort(),
    ),
  );
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    generatedAt,
    decision:
      diagnostics.length === 0 ? ("approved" as const) : ("rejected" as const),
    diagnostics,
    baselineId: baseline.id,
    baselineSha256: baseline.contentSha256,
    envelopeSha256: baseline.envelope.contentSha256,
    receiptSha256: baseline.envelope.receipt.contentSha256,
    receiptArtifactSha256: baseline.envelope.signature.receiptArtifactSha256,
    selectedAnchorSetSha256: baseline.selectedAnchorSetSha256,
    selectedDirectorySha256: baseline.selectedDirectorySha256,
    verificationStatus: verification.status,
    verificationSha256: verification.contentSha256,
    signatureValid: verification.signatureValid,
    integrityValid: verification.integrityValid,
    policyReviewStatus: policyReview.status,
    policySha256: policyReview.policySha256,
    policyReviewSha256: policyReview.contentSha256,
    sourceAlignmentSha256: sourceAlignment.contentSha256,
    alignedSourceCount: sourceAlignment.alignedSourceCount,
    driftedSourceCount: sourceAlignment.driftedSourceCount,
    missingSourceCount: sourceAlignment.missingSourceCount,
    selectedSourceOriginSetSha256:
      sourceAlignment.selectedSourceOriginSetSha256,
    metadataPublisherSetSha256,
    metadataSignerSetSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision receipt is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "decision",
    "diagnostics",
    "baselineId",
    "baselineSha256",
    "envelopeSha256",
    "receiptSha256",
    "receiptArtifactSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "verificationStatus",
    "verificationSha256",
    "signatureValid",
    "integrityValid",
    "policyReviewStatus",
    "policySha256",
    "policyReviewSha256",
    "sourceAlignmentSha256",
    "alignedSourceCount",
    "driftedSourceCount",
    "missingSourceCount",
    "selectedSourceOriginSetSha256",
    "metadataPublisherSetSha256",
    "metadataSignerSetSha256",
    "contentSha256",
  ]);
  const receipt =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt;
  if (
    receipt.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-decision" ||
    receipt.schemaVersion !== 1 ||
    receipt.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(receipt.generatedAt) ||
    (receipt.decision !== "approved" && receipt.decision !== "rejected") ||
    !validDiagnostics(receipt.diagnostics) ||
    !RESOURCE_ID_PATTERN.test(receipt.baselineId) ||
    !SHA256_PATTERN.test(receipt.baselineSha256) ||
    !SHA256_PATTERN.test(receipt.envelopeSha256) ||
    !SHA256_PATTERN.test(receipt.receiptSha256) ||
    !SHA256_PATTERN.test(receipt.receiptArtifactSha256) ||
    !SHA256_PATTERN.test(receipt.selectedAnchorSetSha256) ||
    !SHA256_PATTERN.test(receipt.selectedDirectorySha256) ||
    !validTrustedReceiptStatus(receipt.verificationStatus) ||
    !SHA256_PATTERN.test(receipt.verificationSha256) ||
    typeof receipt.signatureValid !== "boolean" ||
    typeof receipt.integrityValid !== "boolean" ||
    (receipt.policyReviewStatus !== "accepted" &&
      receipt.policyReviewStatus !== "rejected") ||
    !SHA256_PATTERN.test(receipt.policySha256) ||
    !SHA256_PATTERN.test(receipt.policyReviewSha256) ||
    !SHA256_PATTERN.test(receipt.sourceAlignmentSha256) ||
    !nonNegativeInteger(receipt.alignedSourceCount) ||
    !nonNegativeInteger(receipt.driftedSourceCount) ||
    !nonNegativeInteger(receipt.missingSourceCount) ||
    !SHA256_PATTERN.test(receipt.selectedSourceOriginSetSha256) ||
    !SHA256_PATTERN.test(receipt.metadataPublisherSetSha256) ||
    !SHA256_PATTERN.test(receipt.metadataSignerSetSha256) ||
    !SHA256_PATTERN.test(receipt.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision receipt is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== receipt.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision receipt hash mismatch",
    );
  }
  return structuredClone(receipt);
}

export function createReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord(
  input: {
    signedByThreadId: string;
    baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
    verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
    policyReview: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
    sourceAlignment: ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment;
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt>;
  },
  createdAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord {
  const createdAt = requireTimestamp(
    createdAtInput,
    "anchor directory quorum activation decision record time",
  );
  const baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    input.baseline,
  );
  const verification = validateQuorumPromotionBaselineVerification(
    input.verification,
    baseline,
  );
  const policyReview = validateQuorumPromotionBaselineImportPolicyReview(
    input.policyReview,
    baseline,
  );
  const sourceAlignment =
    validateReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
      input.sourceAlignment,
      baseline,
    );
  const envelope = validateTrustedReceiptEnvelope(
    input.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt>;
  if (
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_decision" ||
    envelope.receipt.baselineSha256 !== baseline.contentSha256 ||
    envelope.receipt.verificationSha256 !== verification.contentSha256 ||
    envelope.receipt.policyReviewSha256 !== policyReview.contentSha256 ||
    envelope.receipt.sourceAlignmentSha256 !== sourceAlignment.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision record envelope binding is invalid",
    );
  }
  const content = {
    id: createId("trustqad"),
    signedByThreadId: input.signedByThreadId,
    baseline,
    verification,
    policyReview,
    sourceAlignment,
    envelope,
    createdAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision record is invalid",
    );
  }
  assertAllowedKeys(value, [
    "id",
    "signedByThreadId",
    "baseline",
    "verification",
    "policyReview",
    "sourceAlignment",
    "envelope",
    "createdAt",
    "contentSha256",
  ]);
  const record =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord;
  const baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    record.baseline,
  );
  const verification = validateQuorumPromotionBaselineVerification(
    record.verification,
    baseline,
  );
  const policyReview = validateQuorumPromotionBaselineImportPolicyReview(
    record.policyReview,
    baseline,
  );
  const sourceAlignment =
    validateReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
      record.sourceAlignment,
      baseline,
    );
  const envelope = validateTrustedReceiptEnvelope(
    record.envelope,
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt>;
  if (
    !RESOURCE_ID_PATTERN.test(record.id) ||
    !RESOURCE_ID_PATTERN.test(record.signedByThreadId) ||
    !validTimestamp(record.createdAt) ||
    !SHA256_PATTERN.test(record.contentSha256) ||
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_decision" ||
    envelope.receipt.baselineSha256 !== baseline.contentSha256 ||
    envelope.receipt.verificationSha256 !== verification.contentSha256 ||
    envelope.receipt.policyReviewSha256 !== policyReview.contentSha256 ||
    envelope.receipt.sourceAlignmentSha256 !== sourceAlignment.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision record is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...record,
    baseline,
    verification,
    policyReview,
    sourceAlignment,
    envelope,
  };
  if (sha256(canonicalJson(content)) !== record.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision record hash mismatch",
    );
  }
  return structuredClone({
    ...content,
    contentSha256: record.contentSha256,
  });
}

export function createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
  recordsInput: readonly ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[],
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "anchor directory quorum activation decision history time",
  );
  const records = recordsInput
    .map(validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord)
    .sort((left, right) => {
      const createdOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdOrder !== 0) return createdOrder;
      return left.id.localeCompare(right.id);
    });
  const decisionHashes = records
    .map((record) => record.envelope.receipt.contentSha256)
    .sort();
  const baselineHashes = records
    .map((record) => record.baseline.contentSha256)
    .sort();
  const policyReviewHashes = records
    .map((record) => record.policyReview.contentSha256)
    .sort();
  const sourceAlignmentHashes = records
    .map((record) => record.sourceAlignment.contentSha256)
    .sort();
  const latestDecisionAt = records.at(-1)?.createdAt;
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    decisionCount: records.length,
    approvedCount: records.filter(
      (record) => record.envelope.receipt.decision === "approved",
    ).length,
    rejectedCount: records.filter(
      (record) => record.envelope.receipt.decision === "rejected",
    ).length,
    distinctBaselineCount: new Set(baselineHashes).size,
    decisionSetSha256: sha256(canonicalJson(decisionHashes)),
    baselineSetSha256: sha256(canonicalJson(baselineHashes)),
    policyReviewSetSha256: sha256(canonicalJson(policyReviewHashes)),
    sourceAlignmentSetSha256: sha256(canonicalJson(sourceAlignmentHashes)),
    ...(latestDecisionAt ? { latestDecisionAt } : {}),
    records,
  };
  return {
    ...content,
    generatedAt,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision history is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "decisionCount",
    "approvedCount",
    "rejectedCount",
    "distinctBaselineCount",
    "decisionSetSha256",
    "baselineSetSha256",
    "policyReviewSetSha256",
    "sourceAlignmentSetSha256",
    "latestDecisionAt",
    "records",
    "contentSha256",
  ]);
  const history =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
  if (
    history.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-decision-history" ||
    history.schemaVersion !== 1 ||
    history.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(history.generatedAt) ||
    !Array.isArray(history.records) ||
    history.records.length !== history.decisionCount ||
    !nonNegativeInteger(history.approvedCount) ||
    !nonNegativeInteger(history.rejectedCount) ||
    !nonNegativeInteger(history.distinctBaselineCount) ||
    !SHA256_PATTERN.test(history.decisionSetSha256) ||
    !SHA256_PATTERN.test(history.baselineSetSha256) ||
    !SHA256_PATTERN.test(history.policyReviewSetSha256) ||
    !SHA256_PATTERN.test(history.sourceAlignmentSetSha256) ||
    !optionalTimestamp(history.latestDecisionAt) ||
    !SHA256_PATTERN.test(history.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision history is invalid",
    );
  }
  const observed =
    createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      history.records,
      history.generatedAt,
    );
  if (
    observed.decisionCount !== history.decisionCount ||
    observed.approvedCount !== history.approvedCount ||
    observed.rejectedCount !== history.rejectedCount ||
    observed.distinctBaselineCount !== history.distinctBaselineCount ||
    observed.decisionSetSha256 !== history.decisionSetSha256 ||
    observed.baselineSetSha256 !== history.baselineSetSha256 ||
    observed.policyReviewSetSha256 !== history.policyReviewSetSha256 ||
    observed.sourceAlignmentSetSha256 !== history.sourceAlignmentSetSha256 ||
    observed.latestDecisionAt !== history.latestDecisionAt ||
    observed.contentSha256 !== history.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation decision history hash mismatch",
    );
  }
  return observed;
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
  value: unknown,
  currentHistory: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
  const verifiedAt = nowIso();
  let declared: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
  try {
    declared =
      validateReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(value);
  } catch {
    return createQuorumActivationDecisionHistoryVerification({
      verifiedAt,
      status: "invalid",
      diagnostics: ["history_invalid"],
      currentHistory,
    });
  }
  const diagnostics: string[] = [];
  if (declared.contentSha256 !== currentHistory.contentSha256) {
    diagnostics.push("current_history_mismatch");
  }
  if (declared.decisionSetSha256 !== currentHistory.decisionSetSha256) {
    diagnostics.push("decision_set_mismatch");
  }
  if (declared.decisionCount !== currentHistory.decisionCount) {
    diagnostics.push("decision_count_mismatch");
  }
  return createQuorumActivationDecisionHistoryVerification({
    verifiedAt,
    status: diagnostics.length === 0 ? "valid" : "divergent",
    diagnostics,
    declared,
    currentHistory,
  });
}

function createQuorumActivationDecisionHistoryVerification(input: {
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification["status"];
  diagnostics: string[];
  declared?: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
  currentHistory: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
}): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    verifiedAt: input.verifiedAt,
    status: input.status,
    diagnostics: input.diagnostics,
    ...(input.declared
      ? {
          declaredContentSha256: input.declared.contentSha256,
          recomputedContentSha256: input.declared.contentSha256,
          declaredDecisionSetSha256: input.declared.decisionSetSha256,
          declaredDecisionCount: input.declared.decisionCount,
        }
      : {}),
    currentContentSha256: input.currentHistory.contentSha256,
    currentDecisionSetSha256: input.currentHistory.decisionSetSha256,
    currentDecisionCount: input.currentHistory.decisionCount,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelection(
  input: {
    activatedByThreadId: string;
    activationDecisionRecord: ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord;
    previousSelectionSha256?: string;
  },
  activatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelection {
  const activatedAt = requireTimestamp(
    activatedAtInput,
    "anchor directory quorum activation selection time",
  );
  if (
    input.previousSelectionSha256 !== undefined &&
    !SHA256_PATTERN.test(input.previousSelectionSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection previous hash is invalid",
    );
  }
  const record =
    validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord(
      input.activationDecisionRecord,
    );
  const selectedDirectoryInput =
    record.baseline.envelope.receipt.quorum.selectedDirectory;
  if (!selectedDirectoryInput) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection requires a selected directory",
    );
  }
  const selectedDirectory = validateReceiptTrustAnchorDirectory(
    selectedDirectoryInput,
  );
  if (
    record.envelope.receipt.decision !== "approved" ||
    record.verification.status !== "trusted" ||
    !record.verification.signatureValid ||
    !record.verification.integrityValid ||
    record.policyReview.status !== "accepted" ||
    record.sourceAlignment.driftedSourceCount !== 0 ||
    record.sourceAlignment.missingSourceCount !== 0 ||
    selectedDirectory.contentSha256 !== record.baseline.selectedDirectorySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection requires approved current evidence",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    id: createId("trustqas"),
    activatedAt,
    activatedByThreadId: input.activatedByThreadId,
    activationDecisionRecordId: record.id,
    activationDecisionRecordSha256: record.contentSha256,
    activationDecisionReceiptSha256: record.envelope.receipt.contentSha256,
    activationDecisionEnvelopeSha256: record.envelope.contentSha256,
    baselineId: record.baseline.id,
    baselineSha256: record.baseline.contentSha256,
    selectedAnchorSetSha256: record.baseline.selectedAnchorSetSha256,
    selectedDirectorySha256: record.baseline.selectedDirectorySha256,
    selectedDirectory,
    policyReviewSha256: record.policyReview.contentSha256,
    sourceAlignmentSha256: record.sourceAlignment.contentSha256,
    ...(input.previousSelectionSha256
      ? { previousSelectionSha256: input.previousSelectionSha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelection {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "id",
    "activatedAt",
    "activatedByThreadId",
    "activationDecisionRecordId",
    "activationDecisionRecordSha256",
    "activationDecisionReceiptSha256",
    "activationDecisionEnvelopeSha256",
    "baselineId",
    "baselineSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedDirectory",
    "policyReviewSha256",
    "sourceAlignmentSha256",
    "previousSelectionSha256",
    "contentSha256",
  ]);
  const selection =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelection;
  const selectedDirectory = validateReceiptTrustAnchorDirectory(
    selection.selectedDirectory,
  );
  if (
    selection.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection" ||
    selection.schemaVersion !== 1 ||
    selection.apiVersion !== NAPIER_API_VERSION ||
    !/^trustqas_[a-z0-9]{8,80}$/.test(selection.id) ||
    !validTimestamp(selection.activatedAt) ||
    !/^thread_[a-z0-9]{8,80}$/.test(selection.activatedByThreadId) ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(selection.activationDecisionRecordId) ||
    !SHA256_PATTERN.test(selection.activationDecisionRecordSha256) ||
    !SHA256_PATTERN.test(selection.activationDecisionReceiptSha256) ||
    !SHA256_PATTERN.test(selection.activationDecisionEnvelopeSha256) ||
    !/^trustqpb_[a-z0-9]{8,80}$/.test(selection.baselineId) ||
    !SHA256_PATTERN.test(selection.baselineSha256) ||
    !SHA256_PATTERN.test(selection.selectedAnchorSetSha256) ||
    !SHA256_PATTERN.test(selection.selectedDirectorySha256) ||
    selection.selectedDirectorySha256 !== selectedDirectory.contentSha256 ||
    selection.selectedAnchorSetSha256 !== selectedDirectory.anchorSetSha256 ||
    !SHA256_PATTERN.test(selection.policyReviewSha256) ||
    !SHA256_PATTERN.test(selection.sourceAlignmentSha256) ||
    (selection.previousSelectionSha256 !== undefined &&
      !SHA256_PATTERN.test(selection.previousSelectionSha256)) ||
    !SHA256_PATTERN.test(selection.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...selection,
    selectedDirectory,
  };
  if (sha256(canonicalJson(content)) !== selection.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection hash mismatch",
    );
  }
  return structuredClone({
    ...content,
    contentSha256: selection.contentSha256,
  });
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
  selectionInput?: ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "anchor directory quorum activation selection state time",
  );
  const selection = selectionInput
    ? validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
        selectionInput,
      )
    : undefined;
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-state" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    hasSelection: Boolean(selection),
    currentSelectionSha256: selection?.contentSha256 ?? "",
    ...(selection ? { selection } : {}),
  };
  return {
    ...content,
    generatedAt,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection state is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "hasSelection",
    "currentSelectionSha256",
    "selection",
    "contentSha256",
  ]);
  const state =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionState;
  const selection =
    state.selection === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
          state.selection,
        );
  if (
    state.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-state" ||
    state.schemaVersion !== 1 ||
    state.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(state.generatedAt) ||
    typeof state.hasSelection !== "boolean" ||
    (state.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(state.currentSelectionSha256)) ||
    state.hasSelection !== Boolean(selection) ||
    state.currentSelectionSha256 !== (selection?.contentSha256 ?? "") ||
    !SHA256_PATTERN.test(state.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection state is invalid",
    );
  }
  const observed =
    createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
      selection,
      state.generatedAt,
    );
  if (observed.contentSha256 !== state.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection state hash mismatch",
    );
  }
  return observed;
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  selectionsInput: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelection[],
  driftAuditInput: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  generatedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
  const generatedAt = requireTimestamp(
    generatedAtInput,
    "anchor directory quorum activation selection transparency checkpoint time",
  );
  const selections = selectionsInput
    .map(validateReceiptTrustAnchorDirectoryQuorumActivationSelection)
    .sort((left, right) => {
      const activatedOrder = left.activatedAt.localeCompare(right.activatedAt);
      if (activatedOrder !== 0) return activatedOrder;
      return left.id.localeCompare(right.id);
    });
  const driftAudit =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
      driftAuditInput,
    );
  const entries: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry[] =
    [];
  for (const selection of selections) {
    const previousEntrySha256 = entries.at(-1)?.contentSha256;
    entries.push(
      createActivationSelectionTransparencyEntry({
        selection,
        sequence: entries.length + 1,
        ...(previousEntrySha256 ? { previousEntrySha256 } : {}),
      }),
    );
  }
  const current = entries.at(-1);
  const selectionHashes = entries.map((entry) => entry.selectionSha256).sort();
  const decisionHashes = entries
    .map((entry) => entry.activationDecisionReceiptSha256)
    .sort();
  const baselineHashes = entries.map((entry) => entry.baselineSha256).sort();
  const policyReviewHashes = entries
    .map((entry) => entry.policyReviewSha256)
    .sort();
  const sourceAlignmentHashes = entries
    .map((entry) => entry.sourceAlignmentSha256)
    .sort();
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    hasSelection: Boolean(current),
    selectionCount: entries.length,
    currentSelectionSha256: current?.selectionSha256 ?? "",
    ...(current ? { currentSelectionId: current.selectionId } : {}),
    ...(current ? { currentSelectionEntrySha256: current.contentSha256 } : {}),
    selectionSetSha256: sha256(canonicalJson(selectionHashes)),
    ...(current ? { selectionChainTailSha256: current.contentSha256 } : {}),
    activationDecisionCount: entries.length,
    activationDecisionSetSha256: sha256(canonicalJson(decisionHashes)),
    baselineSetSha256: sha256(canonicalJson(baselineHashes)),
    policyReviewSetSha256: sha256(canonicalJson(policyReviewHashes)),
    sourceAlignmentSetSha256: sha256(canonicalJson(sourceAlignmentHashes)),
    driftAuditSha256: hashActivationSelectionDriftAuditEvidence(driftAudit),
    driftStatus: driftAudit.status,
    entries,
  };
  return {
    ...content,
    generatedAt,
    contentSha256: sha256(
      canonicalJson(activationSelectionCheckpointStableContent(content)),
    ),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency checkpoint is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "hasSelection",
    "selectionCount",
    "currentSelectionSha256",
    "currentSelectionId",
    "currentSelectionEntrySha256",
    "selectionSetSha256",
    "selectionChainTailSha256",
    "activationDecisionCount",
    "activationDecisionSetSha256",
    "baselineSetSha256",
    "policyReviewSetSha256",
    "sourceAlignmentSetSha256",
    "driftAuditSha256",
    "driftStatus",
    "entries",
    "contentSha256",
  ]);
  const checkpoint =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
  const entries = validateActivationSelectionTransparencyEntries(
    checkpoint.entries,
  );
  const current = entries.at(-1);
  const selectionSetSha256 = sha256(
    canonicalJson(entries.map((entry) => entry.selectionSha256).sort()),
  );
  const activationDecisionSetSha256 = sha256(
    canonicalJson(
      entries
        .map((entry) => entry.activationDecisionReceiptSha256)
        .sort(),
    ),
  );
  const baselineSetSha256 = sha256(
    canonicalJson(entries.map((entry) => entry.baselineSha256).sort()),
  );
  const policyReviewSetSha256 = sha256(
    canonicalJson(entries.map((entry) => entry.policyReviewSha256).sort()),
  );
  const sourceAlignmentSetSha256 = sha256(
    canonicalJson(entries.map((entry) => entry.sourceAlignmentSha256).sort()),
  );
  if (
    checkpoint.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint" ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(checkpoint.generatedAt) ||
    typeof checkpoint.hasSelection !== "boolean" ||
    checkpoint.hasSelection !== Boolean(current) ||
    checkpoint.selectionCount !== entries.length ||
    (checkpoint.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(checkpoint.currentSelectionSha256)) ||
    checkpoint.currentSelectionSha256 !== (current?.selectionSha256 ?? "") ||
    checkpoint.currentSelectionId !== current?.selectionId ||
    checkpoint.currentSelectionEntrySha256 !== current?.contentSha256 ||
    checkpoint.selectionSetSha256 !== selectionSetSha256 ||
    checkpoint.selectionChainTailSha256 !== current?.contentSha256 ||
    checkpoint.activationDecisionCount !== entries.length ||
    checkpoint.activationDecisionSetSha256 !== activationDecisionSetSha256 ||
    checkpoint.baselineSetSha256 !== baselineSetSha256 ||
    checkpoint.policyReviewSetSha256 !== policyReviewSetSha256 ||
    checkpoint.sourceAlignmentSetSha256 !== sourceAlignmentSetSha256 ||
    !SHA256_PATTERN.test(checkpoint.driftAuditSha256) ||
    !validActivationSelectionDriftStatus(checkpoint.driftStatus) ||
    !SHA256_PATTERN.test(checkpoint.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency checkpoint is invalid",
    );
  }
  if (
    sha256(
      canonicalJson(
        activationSelectionCheckpointStableContent({
          ...checkpoint,
          entries,
        }),
      ),
    ) !== checkpoint.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency checkpoint hash mismatch",
    );
  }
  return structuredClone({
    ...checkpoint,
    entries,
  });
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  value: unknown,
  currentCheckpoint: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
  const current =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      currentCheckpoint,
    );
  let declared: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
  try {
    declared =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        value,
      );
  } catch {
    return createActivationSelectionTransparencyCheckpointVerification({
      verifiedAt: nowIso(),
      status: "invalid",
      diagnostics: ["checkpoint_invalid"],
      current,
    });
  }
  const diagnostics: string[] = [];
  if (declared.contentSha256 !== current.contentSha256) {
    diagnostics.push("current_checkpoint_mismatch");
  }
  if (declared.selectionSetSha256 !== current.selectionSetSha256) {
    diagnostics.push("selection_set_mismatch");
  }
  if (
    declared.selectionChainTailSha256 !== current.selectionChainTailSha256
  ) {
    diagnostics.push("selection_chain_tail_mismatch");
  }
  if (declared.selectionCount !== current.selectionCount) {
    diagnostics.push("selection_count_mismatch");
  }
  if (declared.currentSelectionSha256 !== current.currentSelectionSha256) {
    diagnostics.push("current_selection_mismatch");
  }
  return createActivationSelectionTransparencyCheckpointVerification({
    verifiedAt: nowIso(),
    status: diagnostics.length === 0 ? "valid" : "divergent",
    diagnostics,
    declared,
    current,
  });
}

function createActivationSelectionTransparencyEntry(input: {
  selection: ReceiptTrustAnchorDirectoryQuorumActivationSelection;
  sequence: number;
  previousEntrySha256?: string;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry {
  const selection =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
      input.selection,
    );
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency sequence is invalid",
    );
  }
  if (
    input.previousEntrySha256 !== undefined &&
    !SHA256_PATTERN.test(input.previousEntrySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency predecessor is invalid",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-entry" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    sequence: input.sequence,
    activatedAt: selection.activatedAt,
    activatedByThreadId: selection.activatedByThreadId,
    selectionId: selection.id,
    selectionSha256: selection.contentSha256,
    activationDecisionRecordId: selection.activationDecisionRecordId,
    activationDecisionRecordSha256: selection.activationDecisionRecordSha256,
    activationDecisionReceiptSha256:
      selection.activationDecisionReceiptSha256,
    activationDecisionEnvelopeSha256:
      selection.activationDecisionEnvelopeSha256,
    baselineId: selection.baselineId,
    baselineSha256: selection.baselineSha256,
    selectedAnchorSetSha256: selection.selectedAnchorSetSha256,
    selectedDirectorySha256: selection.selectedDirectorySha256,
    policyReviewSha256: selection.policyReviewSha256,
    sourceAlignmentSha256: selection.sourceAlignmentSha256,
    ...(selection.previousSelectionSha256
      ? { previousSelectionSha256: selection.previousSelectionSha256 }
      : {}),
    ...(input.previousEntrySha256
      ? { previousEntrySha256: input.previousEntrySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function hashActivationSelectionDriftAuditEvidence(
  audit: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
): string {
  const evidence = {
    kind: audit.kind,
    schemaVersion: audit.schemaVersion,
    apiVersion: audit.apiVersion,
    status: audit.status,
    diagnostics: audit.diagnostics,
    hasSelection: audit.hasSelection,
    ...(audit.selectionId ? { selectionId: audit.selectionId } : {}),
    ...(audit.selectionSha256
      ? { selectionSha256: audit.selectionSha256 }
      : {}),
    ...(audit.selectedAnchorSetSha256
      ? { selectedAnchorSetSha256: audit.selectedAnchorSetSha256 }
      : {}),
    ...(audit.selectedDirectorySha256
      ? { selectedDirectorySha256: audit.selectedDirectorySha256 }
      : {}),
    currentQuorumStatus: audit.currentQuorumStatus,
    ...(audit.currentAnchorSetSha256
      ? { currentAnchorSetSha256: audit.currentAnchorSetSha256 }
      : {}),
    ...(audit.currentDirectorySha256
      ? { currentDirectorySha256: audit.currentDirectorySha256 }
      : {}),
  };
  return sha256(canonicalJson(evidence));
}

function activationSelectionCheckpointStableContent(
  checkpoint: Omit<
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
    "generatedAt" | "contentSha256"
  > &
    Partial<
      Pick<
        ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
        "generatedAt" | "contentSha256"
      >
    >,
): Omit<
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  "generatedAt" | "contentSha256" | "driftAuditSha256"
> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    driftAuditSha256: _driftAuditSha256,
    ...content
  } = checkpoint;
  return content;
}

function validateActivationSelectionTransparencyEntries(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency entries are invalid",
    );
  }
  const entries = value.map(validateActivationSelectionTransparencyEntry);
  const selectionIds = new Set<string>();
  const selectionHashes = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    if (selectionIds.has(entry.selectionId)) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection transparency entry duplicate id",
      );
    }
    if (selectionHashes.has(entry.selectionSha256)) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection transparency entry duplicate hash",
      );
    }
    selectionIds.add(entry.selectionId);
    selectionHashes.add(entry.selectionSha256);
    if (previous) {
      if (
        entry.sequence !== previous.sequence + 1 ||
        entry.previousEntrySha256 !== previous.contentSha256 ||
        entry.previousSelectionSha256 !== previous.selectionSha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection transparency chain is invalid",
        );
      }
    } else if (
      entry.sequence !== 1 ||
      entry.previousEntrySha256 !== undefined
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection transparency chain is invalid",
      );
    }
  }
  return entries;
}

function validateActivationSelectionTransparencyEntry(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency entry is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "sequence",
    "activatedAt",
    "activatedByThreadId",
    "selectionId",
    "selectionSha256",
    "activationDecisionRecordId",
    "activationDecisionRecordSha256",
    "activationDecisionReceiptSha256",
    "activationDecisionEnvelopeSha256",
    "baselineId",
    "baselineSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "policyReviewSha256",
    "sourceAlignmentSha256",
    "previousSelectionSha256",
    "previousEntrySha256",
    "contentSha256",
  ]);
  const entry =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry;
  if (
    entry.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-entry" ||
    entry.schemaVersion !== 1 ||
    entry.apiVersion !== NAPIER_API_VERSION ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    !validTimestamp(entry.activatedAt) ||
    !/^thread_[a-z0-9]{8,80}$/.test(entry.activatedByThreadId) ||
    !/^trustqas_[a-z0-9]{8,80}$/.test(entry.selectionId) ||
    !SHA256_PATTERN.test(entry.selectionSha256) ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(entry.activationDecisionRecordId) ||
    !SHA256_PATTERN.test(entry.activationDecisionRecordSha256) ||
    !SHA256_PATTERN.test(entry.activationDecisionReceiptSha256) ||
    !SHA256_PATTERN.test(entry.activationDecisionEnvelopeSha256) ||
    !/^trustqpb_[a-z0-9]{8,80}$/.test(entry.baselineId) ||
    !SHA256_PATTERN.test(entry.baselineSha256) ||
    !SHA256_PATTERN.test(entry.selectedAnchorSetSha256) ||
    !SHA256_PATTERN.test(entry.selectedDirectorySha256) ||
    !SHA256_PATTERN.test(entry.policyReviewSha256) ||
    !SHA256_PATTERN.test(entry.sourceAlignmentSha256) ||
    !optionalSha256(entry.previousSelectionSha256) ||
    !optionalSha256(entry.previousEntrySha256) ||
    !SHA256_PATTERN.test(entry.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency entry is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = entry;
  if (sha256(canonicalJson(content)) !== entry.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection transparency entry hash mismatch",
    );
  }
  return structuredClone(entry);
}

function createActivationSelectionTransparencyCheckpointVerification(input: {
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification["status"];
  diagnostics: string[];
  declared?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
  current: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    verifiedAt: input.verifiedAt,
    status: input.status,
    diagnostics: input.diagnostics,
    ...(input.declared
      ? {
          declaredContentSha256: input.declared.contentSha256,
          recomputedContentSha256: input.declared.contentSha256,
          declaredSelectionSetSha256: input.declared.selectionSetSha256,
          ...(input.declared.selectionChainTailSha256
            ? {
                declaredSelectionChainTailSha256:
                  input.declared.selectionChainTailSha256,
              }
            : {}),
          declaredSelectionCount: input.declared.selectionCount,
          declaredCurrentSelectionSha256:
            input.declared.currentSelectionSha256,
        }
      : {}),
    currentContentSha256: input.current.contentSha256,
    currentSelectionSetSha256: input.current.selectionSetSha256,
    ...(input.current.selectionChainTailSha256
      ? {
          currentSelectionChainTailSha256:
            input.current.selectionChainTailSha256,
        }
      : {}),
    currentSelectionCount: input.current.selectionCount,
    currentSelectionSha256: input.current.currentSelectionSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
  input: {
    selectionState: ReceiptTrustAnchorDirectoryQuorumActivationSelectionState;
    currentQuorum: ReceiptTrustAnchorDirectoryQuorum;
  },
  auditedAtInput = nowIso(),
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
  const auditedAt = requireTimestamp(
    auditedAtInput,
    "anchor directory quorum activation selection drift audit time",
  );
  const selectionState =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
      input.selectionState,
    );
  const currentQuorum = validateReceiptTrustAnchorDirectoryQuorum(
    input.currentQuorum,
  );
  const selection = selectionState.selection;
  const diagnostics: string[] = [];
  let status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus;
  if (!selection) {
    status = "missing_selection";
    diagnostics.push("selection_missing");
  } else if (
    currentQuorum.status !== "agreed" ||
    !currentQuorum.selectedAnchorSetSha256 ||
    !currentQuorum.selectedDirectorySha256
  ) {
    status = "quorum_unavailable";
    diagnostics.push("current_quorum_unavailable");
  } else if (
    currentQuorum.selectedAnchorSetSha256 !== selection.selectedAnchorSetSha256
  ) {
    status = "anchor_set_drift";
    diagnostics.push("anchor_set_drift");
  } else if (
    currentQuorum.selectedDirectorySha256 !== selection.selectedDirectorySha256
  ) {
    status = "directory_drift";
    diagnostics.push("directory_drift");
  } else {
    status = "aligned";
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-drift-audit" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    auditedAt,
    status,
    diagnostics,
    hasSelection: Boolean(selection),
    selectionStateSha256: selectionState.contentSha256,
    ...(selection
      ? {
          selectionId: selection.id,
          selectionSha256: selection.contentSha256,
          selectedAnchorSetSha256: selection.selectedAnchorSetSha256,
          selectedDirectorySha256: selection.selectedDirectorySha256,
        }
      : {}),
    currentQuorumStatus: currentQuorum.status,
    currentQuorumSha256: currentQuorum.contentSha256,
    currentSourceCount: currentQuorum.sourceCount,
    currentAgreementCount: currentQuorum.agreementCount,
    currentAgreementWeight: currentQuorum.agreementWeight,
    ...(currentQuorum.selectedAnchorSetSha256
      ? { currentAnchorSetSha256: currentQuorum.selectedAnchorSetSha256 }
      : {}),
    ...(currentQuorum.selectedDirectorySha256
      ? { currentDirectorySha256: currentQuorum.selectedDirectorySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection drift audit is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "auditedAt",
    "status",
    "diagnostics",
    "hasSelection",
    "selectionStateSha256",
    "selectionId",
    "selectionSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "currentQuorumStatus",
    "currentQuorumSha256",
    "currentSourceCount",
    "currentAgreementCount",
    "currentAgreementWeight",
    "currentAnchorSetSha256",
    "currentDirectorySha256",
    "contentSha256",
  ]);
  const audit =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit;
  if (
    audit.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-drift-audit" ||
    audit.schemaVersion !== 1 ||
    audit.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(audit.auditedAt) ||
    !validActivationSelectionDriftStatus(audit.status) ||
    !validDiagnostics(audit.diagnostics) ||
    typeof audit.hasSelection !== "boolean" ||
    !SHA256_PATTERN.test(audit.selectionStateSha256) ||
    (audit.selectionId !== undefined &&
      !/^trustqas_[a-z0-9]{8,80}$/.test(audit.selectionId)) ||
    !optionalSha256(audit.selectionSha256) ||
    !optionalSha256(audit.selectedAnchorSetSha256) ||
    !optionalSha256(audit.selectedDirectorySha256) ||
    !validQuorumStatus(audit.currentQuorumStatus) ||
    !SHA256_PATTERN.test(audit.currentQuorumSha256) ||
    !nonNegativeInteger(audit.currentSourceCount) ||
    !nonNegativeInteger(audit.currentAgreementCount) ||
    !nonNegativeInteger(audit.currentAgreementWeight) ||
    !optionalSha256(audit.currentAnchorSetSha256) ||
    !optionalSha256(audit.currentDirectorySha256) ||
    !SHA256_PATTERN.test(audit.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection drift audit is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = audit;
  if (sha256(canonicalJson(content)) !== audit.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection drift audit hash mismatch",
    );
  }
  return structuredClone(audit);
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
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = {
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

export function validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  value: unknown,
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  if (!isRecord(value) || typeof value["sourceUrl"] !== "string") {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection checkpoint subscription is invalid",
    );
  }
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    value["sourceUrl"],
  );
  const subscription =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      value,
    );
  if (
    sha256(sourceUrl.href) !== subscription.sourceUrlSha256 ||
    sha256(sourceUrl.origin) !== subscription.sourceOriginSha256
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection checkpoint subscription source hash mismatch",
    );
  }
  const claim = validateOptionalClaim(value["claim"]);
  const claimTokenSha256 = value["claimTokenSha256"];
  const pendingApprovalApply = validateOptionalRotationProposalApprovalApply(
    value["pendingApprovalApply"],
  );
  if (
    (claim === undefined) !== (claimTokenSha256 === undefined) ||
    (claimTokenSha256 !== undefined &&
      (typeof claimTokenSha256 !== "string" ||
        !SHA256_PATTERN.test(claimTokenSha256)))
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection checkpoint subscription claim is invalid",
    );
  }
  return {
    ...subscription,
    sourceUrl: sourceUrl.href,
    ...(claim ? { claim } : {}),
    ...(typeof claimTokenSha256 === "string" ? { claimTokenSha256 } : {}),
    ...(pendingApprovalApply ? { pendingApprovalApply } : {}),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription is invalid",
    );
  }
  const subscription =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      subscription.policy,
    );
  const lastGoodDiscovery =
    subscription.lastGoodDiscovery === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
          subscription.lastGoodDiscovery,
        );
  const transparencyHistory = validateCheckpointSubscriptionTransparencyHistory(
    subscription.transparencyHistory,
  );
  const transparencyTail = transparencyHistory.at(-1);
  if (
    subscription.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription" ||
    subscription.schemaVersion !== 1 ||
    subscription.apiVersion !== NAPIER_API_VERSION ||
    !CHECKPOINT_SUBSCRIPTION_ID_PATTERN.test(subscription.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(subscription.auditThreadId) ||
    normalizeLabel(subscription.label) !== subscription.label ||
    (subscription.status !== "active" && subscription.status !== "paused") ||
    !Number.isSafeInteger(subscription.revision) ||
    subscription.revision < 1 ||
    !SHA256_PATTERN.test(subscription.sourceUrlSha256) ||
    !SHA256_PATTERN.test(subscription.sourceOriginSha256) ||
    normalizeRefreshInterval(subscription.refreshIntervalMs) !==
      subscription.refreshIntervalMs ||
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      policy,
    ) !== subscription.policySha256 ||
    !validTimestamp(subscription.nextRefreshAt) ||
    !validTimestamp(subscription.createdAt) ||
    !validTimestamp(subscription.updatedAt) ||
    !optionalTimestamp(subscription.lastRefreshAt) ||
    !optionalCheckpointSubscriptionRefreshStatus(
      subscription.lastRefreshStatus,
    ) ||
    !optionalSha256(subscription.lastDiscoverySha256) ||
    !optionalSha256(subscription.lastFailureSha256) ||
    !nonNegativeInteger(subscription.transparencyEntryCount) ||
    !optionalSha256(subscription.transparencyTailSha256) ||
    !SHA256_PATTERN.test(subscription.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription is invalid",
    );
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
      "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency tail is invalid",
    );
  }
  if (
    lastGoodDiscovery &&
    (lastGoodDiscovery.status !== "valid" ||
      !lastGoodDiscovery.envelope ||
      !lastGoodDiscovery.checkpointSha256 ||
      lastGoodDiscovery.sourceUrlSha256 !== subscription.sourceUrlSha256 ||
      lastGoodDiscovery.sourceOriginSha256 !== subscription.sourceOriginSha256 ||
      lastGoodDiscovery.policySha256 !== subscription.policySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription last-good discovery is invalid",
    );
  }
  if (lastGoodDiscovery) {
    if (
      !transparencyTail ||
      transparencyTail.discoverySha256 !== lastGoodDiscovery.contentSha256 ||
      transparencyTail.envelopeSha256 !== lastGoodDiscovery.envelopeSha256 ||
      transparencyTail.checkpointSha256 !== lastGoodDiscovery.checkpointSha256
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency history is stale",
      );
    }
  }
  const content = {
    ...checkpointSubscriptionContent(subscription),
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  };
  if (
    hashCheckpointSubscriptionContent(content) !== subscription.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription content hash mismatch",
    );
  }
  return structuredClone({
    ...subscription,
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  });
}

export function stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  const {
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    ...subscription
  } = input;
  return validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscription,
  );
}

export function validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
  value: unknown,
): PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  if (!isRecord(value) || typeof value["sourceUrl"] !== "string") {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection rotation proposal subscription is invalid",
    );
  }
  const sourceUrl = normalizeReceiptTrustAnchorDirectorySubscriptionUrl(
    value["sourceUrl"],
  );
  const subscription =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      value,
    );
  if (
    sha256(sourceUrl.href) !== subscription.sourceUrlSha256 ||
    sha256(sourceUrl.origin) !== subscription.sourceOriginSha256
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection rotation proposal subscription source hash mismatch",
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
      "Persisted receipt trust anchor directory quorum activation selection rotation proposal subscription claim is invalid",
    );
  }
  return {
    ...subscription,
    sourceUrl: sourceUrl.href,
    ...(claim ? { claim } : {}),
    ...(typeof claimTokenSha256 === "string" ? { claimTokenSha256 } : {}),
  };
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription is invalid",
    );
  }
  const subscription =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      subscription.policy,
    );
  const lastGoodDiscovery =
    subscription.lastGoodDiscovery === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
          subscription.lastGoodDiscovery,
        );
  const transparencyHistory =
    validateRotationProposalSubscriptionTransparencyHistory(
      subscription.transparencyHistory,
    );
  const transparencyTail = transparencyHistory.at(-1);
  if (
    subscription.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription" ||
    subscription.schemaVersion !== 1 ||
    subscription.apiVersion !== NAPIER_API_VERSION ||
    !ROTATION_PROPOSAL_SUBSCRIPTION_ID_PATTERN.test(subscription.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(subscription.auditThreadId) ||
    normalizeLabel(subscription.label) !== subscription.label ||
    (subscription.status !== "active" && subscription.status !== "paused") ||
    !Number.isSafeInteger(subscription.revision) ||
    subscription.revision < 1 ||
    !SHA256_PATTERN.test(subscription.sourceUrlSha256) ||
    !SHA256_PATTERN.test(subscription.sourceOriginSha256) ||
    normalizeRefreshInterval(subscription.refreshIntervalMs) !==
      subscription.refreshIntervalMs ||
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      policy,
    ) !== subscription.policySha256 ||
    !validTimestamp(subscription.nextRefreshAt) ||
    !validTimestamp(subscription.createdAt) ||
    !validTimestamp(subscription.updatedAt) ||
    !optionalTimestamp(subscription.lastRefreshAt) ||
    !optionalRotationProposalSubscriptionRefreshStatus(
      subscription.lastRefreshStatus,
    ) ||
    !optionalSha256(subscription.lastDiscoverySha256) ||
    !optionalSha256(subscription.lastFailureSha256) ||
    !nonNegativeInteger(subscription.transparencyEntryCount) ||
    !optionalSha256(subscription.transparencyTailSha256) ||
    !SHA256_PATTERN.test(subscription.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription is invalid",
    );
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
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency tail is invalid",
    );
  }
  if (
    lastGoodDiscovery &&
    (lastGoodDiscovery.status !== "valid" ||
      !lastGoodDiscovery.envelope ||
      !lastGoodDiscovery.proposalSha256 ||
      !lastGoodDiscovery.preflight ||
      lastGoodDiscovery.sourceUrlSha256 !== subscription.sourceUrlSha256 ||
      lastGoodDiscovery.sourceOriginSha256 !== subscription.sourceOriginSha256 ||
      lastGoodDiscovery.policySha256 !== subscription.policySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription last-good discovery is invalid",
    );
  }
  if (lastGoodDiscovery) {
    const lastGoodPreflight = lastGoodDiscovery.preflight;
    if (
      !transparencyTail ||
      !lastGoodPreflight ||
      transparencyTail.discoverySha256 !== lastGoodDiscovery.contentSha256 ||
      transparencyTail.envelopeSha256 !== lastGoodDiscovery.envelopeSha256 ||
      transparencyTail.proposalSha256 !== lastGoodDiscovery.proposalSha256 ||
      transparencyTail.preflightSha256 !== lastGoodPreflight.contentSha256
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency history is stale",
      );
    }
  }
  const content = {
    ...rotationProposalSubscriptionContent(subscription),
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  };
  if (
    hashRotationProposalSubscriptionContent(content) !==
    subscription.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription content hash mismatch",
    );
  }
  return structuredClone({
    ...subscription,
    policy,
    ...(lastGoodDiscovery ? { lastGoodDiscovery } : {}),
    transparencyHistory,
  });
}

export function stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
  input: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  const {
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    pendingApprovalApply: _pendingApprovalApply,
    ...subscription
  } = input;
  return validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscription,
  );
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal discovery is invalid",
    );
  }
  const discovery =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      discovery.policy,
    );
  const diagnostics = [...discovery.diagnostics];
  const preflight =
    discovery.preflight === undefined
      ? undefined
      : validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
          discovery.preflight,
        );
  const envelope =
    discovery.envelope === undefined
      ? undefined
      : (validateTrustedReceiptEnvelope(
          discovery.envelope,
        ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>);
  if (
    discovery.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-discovery" ||
    discovery.schemaVersion !== 1 ||
    discovery.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(discovery.generatedAt) ||
    (discovery.status !== "valid" && discovery.status !== "invalid") ||
    !validDiagnostics(diagnostics) ||
    (discovery.status === "valid" && diagnostics.length !== 0) ||
    !SHA256_PATTERN.test(discovery.sourceUrlSha256) ||
    !SHA256_PATTERN.test(discovery.sourceOriginSha256) ||
    discovery.httpStatus !== 200 ||
    typeof discovery.responseMediaType !== "string" ||
    discovery.responseMediaType.length < 1 ||
    !Number.isSafeInteger(discovery.responseBytes) ||
    discovery.responseBytes < 1 ||
    !SHA256_PATTERN.test(discovery.responseBodySha256) ||
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      policy,
    ) !== discovery.policySha256 ||
    !optionalSha256(discovery.envelopeSha256) ||
    !optionalSha256(discovery.proposalSha256) ||
    !optionalSha256(discovery.proposalReviewSha256) ||
    !optionalSha256(discovery.checkpointRegistryQuorumBaselineSha256) ||
    (discovery.activationDecisionRecordId !== undefined &&
      !/^trustqad_[a-z0-9]{8,80}$/.test(
        discovery.activationDecisionRecordId,
      )) ||
    (discovery.expectedCurrentSelectionSha256 !== undefined &&
      discovery.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(discovery.expectedCurrentSelectionSha256)) ||
    !optionalSha256(discovery.signerKeyId) ||
    !optionalTimestamp(discovery.signedAt) ||
    !SHA256_PATTERN.test(discovery.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal discovery is invalid",
    );
  }
  if (envelope) {
    if (
      envelope.receiptKind !==
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal" ||
      discovery.envelopeSha256 !== envelope.contentSha256 ||
      discovery.proposalSha256 !== envelope.receipt.contentSha256 ||
      discovery.proposalReviewSha256 !== envelope.receipt.rotationReviewSha256 ||
      discovery.checkpointRegistryQuorumBaselineSha256 !==
        envelope.receipt.checkpointRegistryQuorumBaselineSha256 ||
      discovery.activationDecisionRecordId !==
        envelope.receipt.activationDecisionRecordId ||
      discovery.expectedCurrentSelectionSha256 !==
        envelope.receipt.expectedCurrentSelectionSha256 ||
      discovery.signerKeyId !== envelope.signature.keyId ||
      discovery.signedAt !== envelope.signature.signedAt
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal discovery envelope binding is invalid",
      );
    }
  }
  if (
    discovery.status === "valid" &&
    (!envelope || !preflight || preflight.status !== "accepted")
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal discovery status is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...discovery,
    diagnostics,
    policy,
    ...(preflight ? { preflight } : {}),
    ...(envelope ? { envelope } : {}),
  };
  if (sha256(canonicalJson(content)) !== discovery.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal discovery content hash mismatch",
    );
  }
  return structuredClone({
    ...discovery,
    diagnostics,
    policy,
    ...(preflight ? { preflight } : {}),
    ...(envelope ? { envelope } : {}),
  });
}

function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal preflight is invalid",
    );
  }
  const preflight =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight;
  const diagnostics = [...preflight.diagnostics];
  if (
    preflight.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-preflight" ||
    preflight.schemaVersion !== 1 ||
    preflight.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(preflight.checkedAt) ||
    (preflight.status !== "accepted" &&
      preflight.status !== "rejected" &&
      preflight.status !== "not_required") ||
    !validDiagnostics(diagnostics) ||
    typeof preflight.activationDecisionRecordId !== "string" ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(preflight.activationDecisionRecordId) ||
    (preflight.expectedCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(preflight.expectedCurrentSelectionSha256)) ||
    (preflight.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(preflight.currentSelectionSha256)) ||
    !optionalSha256(preflight.activeSelectionSha256) ||
    !optionalSha256(preflight.rotationProposalEnvelopeSha256) ||
    !optionalSha256(preflight.rotationProposalSha256) ||
    !optionalSha256(preflight.rotationProposalReviewSha256) ||
    !optionalSha256(
      preflight.rotationProposalCheckpointRegistryQuorumBaselineSha256,
    ) ||
    !optionalTrustedReceiptStatus(preflight.trustedReceiptVerificationStatus) ||
    (preflight.trustedReceiptVerificationReason !== undefined &&
      typeof preflight.trustedReceiptVerificationReason !== "string") ||
    !optionalSha256(preflight.trustedReceiptVerificationKeyId) ||
    !optionalSha256(preflight.trustedReceiptVerificationEnvelopeSha256) ||
    !SHA256_PATTERN.test(preflight.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal preflight is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...preflight,
    diagnostics,
  };
  if (sha256(canonicalJson(content)) !== preflight.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal preflight hash mismatch",
    );
  }
  return structuredClone({ ...preflight, diagnostics });
}

export function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint discovery is invalid",
    );
  }
  const discovery =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      discovery.policy,
    );
  const trustedReceiptVerification = validateTrustedReceiptVerification(
    discovery.trustedReceiptVerification,
  );
  const checkpointVerification =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification(
      discovery.checkpointVerification,
    );
  const envelope =
    discovery.envelope === undefined
      ? undefined
      : (validateTrustedReceiptEnvelope(
          discovery.envelope,
        ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>);
  const diagnostics = [...discovery.diagnostics];
  if (
    discovery.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-discovery" ||
    discovery.schemaVersion !== 1 ||
    discovery.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(discovery.generatedAt) ||
    (discovery.status !== "valid" && discovery.status !== "invalid") ||
    !validDiagnostics(diagnostics) ||
    (discovery.status === "valid" && diagnostics.length !== 0) ||
    !SHA256_PATTERN.test(discovery.sourceUrlSha256) ||
    !SHA256_PATTERN.test(discovery.sourceOriginSha256) ||
    discovery.httpStatus !== 200 ||
    typeof discovery.responseMediaType !== "string" ||
    discovery.responseMediaType.length < 1 ||
    !Number.isSafeInteger(discovery.responseBytes) ||
    discovery.responseBytes < 1 ||
    !SHA256_PATTERN.test(discovery.responseBodySha256) ||
    hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      policy,
    ) !== discovery.policySha256 ||
    !nonNegativeInteger(discovery.currentSelectionCount) ||
    !optionalSha256(discovery.currentSelectionChainTailSha256) ||
    !SHA256_PATTERN.test(discovery.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint discovery is invalid",
    );
  }
  if (envelope) {
    if (
      envelope.receiptKind !==
        "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint" ||
      discovery.envelopeSha256 !== envelope.contentSha256 ||
      discovery.checkpointSha256 !== envelope.receipt.contentSha256 ||
      discovery.signerKeyId !== envelope.signature.keyId ||
      discovery.signedAt !== envelope.signature.signedAt ||
      discovery.selectionCount !== envelope.receipt.selectionCount ||
      discovery.selectionSetSha256 !== envelope.receipt.selectionSetSha256 ||
      discovery.selectionChainTailSha256 !==
        envelope.receipt.selectionChainTailSha256
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint discovery envelope binding is invalid",
      );
    }
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...discovery,
    diagnostics,
    policy,
    trustedReceiptVerification,
    checkpointVerification,
    ...(envelope ? { envelope } : {}),
  };
  if (sha256(canonicalJson(content)) !== discovery.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint discovery content hash mismatch",
    );
  }
  return structuredClone({
    ...discovery,
    diagnostics,
    policy,
    trustedReceiptVerification,
    checkpointVerification,
    ...(envelope ? { envelope } : {}),
  });
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

function assertCheckpointDiscoveryBinding(
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  sourceUrl: URL,
  policySha256: string,
): void {
  if (
    discovery.sourceUrlSha256 !== sha256(sourceUrl.href) ||
    discovery.sourceOriginSha256 !== sha256(sourceUrl.origin) ||
    discovery.policySha256 !== policySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription discovery binding changed",
    );
  }
}

function assertRotationProposalDiscoveryBinding(
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  sourceUrl: URL,
  policySha256: string,
): void {
  if (
    discovery.sourceUrlSha256 !== sha256(sourceUrl.href) ||
    discovery.sourceOriginSha256 !== sha256(sourceUrl.origin) ||
    discovery.policySha256 !== policySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription discovery binding changed",
    );
  }
}

function validateTrustedReceiptVerification(
  value: unknown,
): TrustedReceiptVerification {
  if (!isRecord(value)) {
    throw new Error("Trusted receipt verification is invalid");
  }
  const verification = value as unknown as TrustedReceiptVerification;
  if (
    !validTrustedReceiptStatus(verification.status) ||
    !validTimestamp(verification.verifiedAt) ||
    !optionalSha256(verification.receiptContentSha256) ||
    !optionalSha256(verification.receiptArtifactSha256) ||
    !optionalSha256(verification.keyId) ||
    !optionalSha256(verification.envelopeSha256) ||
    !optionalSha256(verification.anchorDirectorySha256) ||
    !optionalSha256(verification.anchorDirectoryVerificationSha256) ||
    !optionalSha256(verification.anchorDirectoryPolicySha256) ||
    !optionalTimestamp(verification.anchorDirectoryGeneratedAt) ||
    (verification.anchorDirectoryAgeMs !== undefined &&
      !nonNegativeInteger(verification.anchorDirectoryAgeMs)) ||
    (verification.anchorDirectoryAnchorCount !== undefined &&
      !nonNegativeInteger(verification.anchorDirectoryAnchorCount)) ||
    (verification.anchorDirectorySource !== undefined &&
      verification.anchorDirectorySource !== "uploaded" &&
      verification.anchorDirectorySource !== "active_selection") ||
    (verification.anchorDirectorySelectionId !== undefined &&
      !/^trustqas_[a-z0-9]{8,80}$/.test(
        verification.anchorDirectorySelectionId,
      )) ||
    !optionalSha256(verification.anchorDirectorySelectionSha256) ||
    !optionalSha256(verification.anchorDirectorySelectionStateSha256) ||
    typeof verification.signatureValid !== "boolean" ||
    typeof verification.integrityValid !== "boolean" ||
    typeof verification.reason !== "string" ||
    verification.reason.length < 1 ||
    verification.reason.length > 500
  ) {
    throw new Error("Trusted receipt verification is invalid");
  }
  return structuredClone(verification);
}

function validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint verification is invalid",
    );
  }
  const verification =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification;
  if (
    verification.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-verification" ||
    verification.schemaVersion !== 1 ||
    verification.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(verification.verifiedAt) ||
    (verification.status !== "valid" &&
      verification.status !== "divergent" &&
      verification.status !== "invalid") ||
    !validDiagnostics(verification.diagnostics) ||
    !optionalSha256(verification.declaredContentSha256) ||
    !optionalSha256(verification.recomputedContentSha256) ||
    !SHA256_PATTERN.test(verification.currentContentSha256) ||
    !optionalSha256(verification.declaredSelectionSetSha256) ||
    !SHA256_PATTERN.test(verification.currentSelectionSetSha256) ||
    !optionalSha256(verification.declaredSelectionChainTailSha256) ||
    !optionalSha256(verification.currentSelectionChainTailSha256) ||
    (verification.declaredSelectionCount !== undefined &&
      !nonNegativeInteger(verification.declaredSelectionCount)) ||
    !nonNegativeInteger(verification.currentSelectionCount) ||
    (verification.declaredCurrentSelectionSha256 !== undefined &&
      verification.declaredCurrentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(verification.declaredCurrentSelectionSha256)) ||
    (verification.currentSelectionSha256 !== "" &&
      !SHA256_PATTERN.test(verification.currentSelectionSha256)) ||
    !SHA256_PATTERN.test(verification.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint verification is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = verification;
  if (sha256(canonicalJson(content)) !== verification.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint verification hash mismatch",
    );
  }
  return structuredClone(verification);
}

function createCheckpointRegistrySource(
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  policy: Required<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy>,
  generatedAtMs: number,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource {
  const discovery = subscription.lastGoodDiscovery;
  const tail = subscription.transparencyHistory.at(-1);
  const diagnostics: string[] = [];
  let status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySourceStatus =
    "eligible";
  if (subscription.status === "paused") {
    status = "paused";
    diagnostics.push("source_paused");
  } else if (!discovery || !tail || !subscription.transparencyTailSha256) {
    status = "missing_last_good";
    diagnostics.push("last_good_missing");
  } else if (
    policy.maxObservationAgeMs > 0 &&
    generatedAtMs - Date.parse(tail.observedAt) > policy.maxObservationAgeMs
  ) {
    status = "stale";
    diagnostics.push("observation_stale");
  }
  const content = {
    subscriptionId: subscription.id,
    subscriptionSha256: subscription.contentSha256,
    sourceUrlSha256: subscription.sourceUrlSha256,
    sourceOriginSha256: subscription.sourceOriginSha256,
    status,
    diagnostics,
    revision: subscription.revision,
    ...(tail ? { observedAt: tail.observedAt } : {}),
    ...(discovery ? { discoverySha256: discovery.contentSha256 } : {}),
    ...(discovery?.envelopeSha256
      ? { envelopeSha256: discovery.envelopeSha256 }
      : {}),
    ...(discovery?.checkpointSha256
      ? { checkpointSha256: discovery.checkpointSha256 }
      : {}),
    ...(discovery?.signerKeyId ? { signerKeyId: discovery.signerKeyId } : {}),
    ...(discovery?.selectionCount !== undefined
      ? { selectionCount: discovery.selectionCount }
      : {}),
    ...(discovery?.selectionSetSha256
      ? { selectionSetSha256: discovery.selectionSetSha256 }
      : {}),
    ...(discovery?.selectionChainTailSha256
      ? { selectionChainTailSha256: discovery.selectionChainTailSha256 }
      : {}),
    ...(subscription.transparencyTailSha256
      ? { transparencyTailSha256: subscription.transparencyTailSha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createCheckpointRegistryCandidate(
  checkpointSha256: string,
  sources: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource[],
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate {
  const sorted = [...sources].sort((left, right) =>
    left.subscriptionId.localeCompare(right.subscriptionId),
  );
  const sourceOrigins = [
    ...new Set(sorted.map((source) => source.sourceOriginSha256)),
  ].sort();
  const signerKeyIds = [
    ...new Set(sorted.flatMap((source) => (source.signerKeyId ? [source.signerKeyId] : []))),
  ].sort();
  const selectionSetSha256 = sorted[0]?.selectionSetSha256 ?? sha256(canonicalJson([]));
  const selectionChainTailSha256 = sorted[0]?.selectionChainTailSha256;
  const selectionCount = Math.max(...sorted.map((source) => source.selectionCount ?? 0));
  const content = {
    checkpointSha256,
    sourceCount: sorted.length,
    distinctSourceOriginCount: sourceOrigins.length,
    signerCount: signerKeyIds.length,
    subscriptionSetSha256: sha256(
      canonicalJson(sorted.map((source) => source.subscriptionId)),
    ),
    sourceOriginSetSha256: sha256(canonicalJson(sourceOrigins)),
    signerSetSha256: sha256(canonicalJson(signerKeyIds)),
    selectionCount,
    selectionSetSha256,
    ...(selectionChainTailSha256 ? { selectionChainTailSha256 } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateCheckpointRegistrySources(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource[] {
  if (!Array.isArray(value)) {
    throw new Error("Receipt trust checkpoint registry sources are invalid");
  }
  return value.map((source) => {
    if (!isRecord(source)) {
      throw new Error("Receipt trust checkpoint registry source is invalid");
    }
    assertAllowedKeys(source, [
      "subscriptionId",
      "subscriptionSha256",
      "sourceUrlSha256",
      "sourceOriginSha256",
      "status",
      "diagnostics",
      "revision",
      "observedAt",
      "discoverySha256",
      "envelopeSha256",
      "checkpointSha256",
      "signerKeyId",
      "selectionCount",
      "selectionSetSha256",
      "selectionChainTailSha256",
      "transparencyTailSha256",
      "contentSha256",
    ]);
    const record =
      source as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource;
    if (
      !/^trustcpsub_[a-z0-9]{8,80}$/.test(record.subscriptionId) ||
      !SHA256_PATTERN.test(record.subscriptionSha256) ||
      !SHA256_PATTERN.test(record.sourceUrlSha256) ||
      !SHA256_PATTERN.test(record.sourceOriginSha256) ||
      !validCheckpointRegistrySourceStatus(record.status) ||
      !validDiagnostics(record.diagnostics) ||
      !nonNegativeInteger(record.revision) ||
      !optionalTimestamp(record.observedAt) ||
      !optionalSha256(record.discoverySha256) ||
      !optionalSha256(record.envelopeSha256) ||
      !optionalSha256(record.checkpointSha256) ||
      !optionalSha256(record.signerKeyId) ||
      (record.selectionCount !== undefined &&
        !nonNegativeInteger(record.selectionCount)) ||
      !optionalSha256(record.selectionSetSha256) ||
      !optionalSha256(record.selectionChainTailSha256) ||
      !optionalSha256(record.transparencyTailSha256) ||
      !SHA256_PATTERN.test(record.contentSha256)
    ) {
      throw new Error("Receipt trust checkpoint registry source is invalid");
    }
    const { contentSha256: _contentSha256, ...content } = record;
    if (sha256(canonicalJson(content)) !== record.contentSha256) {
      throw new Error(
        "Receipt trust checkpoint registry source hash mismatch",
      );
    }
    return structuredClone(record);
  });
}

function validateCheckpointRegistryCandidates(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("Receipt trust checkpoint registry candidates are invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("Receipt trust checkpoint registry candidate is invalid");
    }
    assertAllowedKeys(candidate, [
      "checkpointSha256",
      "sourceCount",
      "distinctSourceOriginCount",
      "signerCount",
      "subscriptionSetSha256",
      "sourceOriginSetSha256",
      "signerSetSha256",
      "selectionCount",
      "selectionSetSha256",
      "selectionChainTailSha256",
      "contentSha256",
    ]);
    const record =
      candidate as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate;
    if (
      !SHA256_PATTERN.test(record.checkpointSha256) ||
      !nonNegativeInteger(record.sourceCount) ||
      !nonNegativeInteger(record.distinctSourceOriginCount) ||
      !nonNegativeInteger(record.signerCount) ||
      !SHA256_PATTERN.test(record.subscriptionSetSha256) ||
      !SHA256_PATTERN.test(record.sourceOriginSetSha256) ||
      !SHA256_PATTERN.test(record.signerSetSha256) ||
      !nonNegativeInteger(record.selectionCount) ||
      !SHA256_PATTERN.test(record.selectionSetSha256) ||
      !optionalSha256(record.selectionChainTailSha256) ||
      !SHA256_PATTERN.test(record.contentSha256)
    ) {
      throw new Error(
        "Receipt trust checkpoint registry candidate is invalid",
      );
    }
    const { contentSha256: _contentSha256, ...content } = record;
    if (sha256(canonicalJson(content)) !== record.contentSha256) {
      throw new Error(
        "Receipt trust checkpoint registry candidate hash mismatch",
      );
    }
    return structuredClone(record);
  });
}

function selectedCheckpointRegistryCandidate(
  quorum: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate {
  if (
    quorum.status !== "agreed" ||
    !quorum.selectedCheckpointSha256 ||
    !quorum.selectedSelectionSetSha256
  ) {
    throw new Error(
      "Receipt trust checkpoint registry quorum baseline requires an agreed quorum",
    );
  }
  const candidate = quorum.candidates.find(
    (item) => item.checkpointSha256 === quorum.selectedCheckpointSha256,
  );
  if (!candidate) {
    throw new Error(
      "Receipt trust checkpoint registry quorum selected candidate is missing",
    );
  }
  return candidate;
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
  const sourceWeights = normalizeQuorumSourceWeights(policy?.["sourceWeights"]);
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

function normalizeImportPolicyDuration(value: unknown, label: string): number {
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

function createCheckpointRegistryQuorumBaselineVerification(input: {
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification["status"];
  diagnostics: string[];
  baselineValid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  baseline?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum-baseline-verification" as const,
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
          quorumSha256: input.baseline.envelope.receipt.contentSha256,
          receiptArtifactSha256:
            input.baseline.envelope.signature.receiptArtifactSha256,
          keyId: input.baseline.envelope.signature.keyId,
          selectedCheckpointSha256:
            input.baseline.selectedCheckpointSha256,
          selectedSelectionSetSha256:
            input.baseline.selectedSelectionSetSha256,
          ...(input.baseline.selectedSelectionChainTailSha256
            ? {
                selectedSelectionChainTailSha256:
                  input.baseline.selectedSelectionChainTailSha256,
              }
            : {}),
          selectedSubscriptionSetSha256:
            input.baseline.selectedSubscriptionSetSha256,
          selectedSourceOriginSetSha256:
            input.baseline.selectedSourceOriginSetSha256,
          selectedSignerSetSha256: input.baseline.selectedSignerSetSha256,
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
          selectedSourceOriginCount: input.selectedSourceOrigins?.length ?? 0,
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

function createQuorumActivationSource(
  sourceOriginSha256: string,
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  subscription: ReceiptTrustAnchorDirectorySubscription | undefined,
): ReceiptTrustAnchorDirectoryQuorumActivationSource {
  if (!subscription) {
    return createQuorumActivationSourceContent({
      sourceOriginSha256,
      status: "missing_subscription",
    });
  }
  const currentDirectory = subscription.lastGoodDiscovery?.directory;
  if (!currentDirectory) {
    return createQuorumActivationSourceContent({
      sourceOriginSha256,
      status: "no_last_good",
      subscriptionId: subscription.id,
      subscriptionSha256: subscription.contentSha256,
    });
  }
  const status: ReceiptTrustAnchorDirectoryQuorumActivationSourceStatus =
    currentDirectory.anchorSetSha256 !== baseline.selectedAnchorSetSha256
      ? "anchor_set_drift"
      : currentDirectory.contentSha256 !== baseline.selectedDirectorySha256
        ? "directory_drift"
        : "aligned";
  return createQuorumActivationSourceContent({
    sourceOriginSha256,
    status,
    subscriptionId: subscription.id,
    subscriptionSha256: subscription.contentSha256,
    currentAnchorSetSha256: currentDirectory.anchorSetSha256,
    currentDirectorySha256: currentDirectory.contentSha256,
  });
}

function createQuorumActivationSourceContent(input: {
  sourceOriginSha256: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSourceStatus;
  subscriptionId?: string;
  subscriptionSha256?: string;
  currentAnchorSetSha256?: string;
  currentDirectorySha256?: string;
}): ReceiptTrustAnchorDirectoryQuorumActivationSource {
  const content = {
    sourceOriginSha256: input.sourceOriginSha256,
    status: input.status,
    ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
    ...(input.subscriptionSha256
      ? { subscriptionSha256: input.subscriptionSha256 }
      : {}),
    ...(input.currentAnchorSetSha256
      ? { currentAnchorSetSha256: input.currentAnchorSetSha256 }
      : {}),
    ...(input.currentDirectorySha256
      ? { currentDirectorySha256: input.currentDirectorySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateQuorumPromotionBaselineVerification(
  value: unknown,
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline verification is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "verifiedAt",
    "status",
    "diagnostics",
    "baselineValid",
    "signatureValid",
    "integrityValid",
    "baselineSha256",
    "envelopeSha256",
    "receiptSha256",
    "receiptArtifactSha256",
    "keyId",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedSubscriptionSetSha256",
    "selectedMetadataEnvelopeSetSha256",
    "anchorDirectorySha256",
    "anchorDirectoryVerificationSha256",
    "anchorDirectoryPolicySha256",
    "contentSha256",
  ]);
  const verification =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
  if (
    verification.kind !==
      "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-verification" ||
    verification.schemaVersion !== 1 ||
    verification.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(verification.verifiedAt) ||
    !validTrustedReceiptStatus(verification.status) ||
    !validDiagnostics(verification.diagnostics) ||
    typeof verification.baselineValid !== "boolean" ||
    typeof verification.signatureValid !== "boolean" ||
    typeof verification.integrityValid !== "boolean" ||
    verification.baselineSha256 !== baseline.contentSha256 ||
    verification.envelopeSha256 !== baseline.envelope.contentSha256 ||
    verification.receiptSha256 !== baseline.envelope.receipt.contentSha256 ||
    verification.receiptArtifactSha256 !==
      baseline.envelope.signature.receiptArtifactSha256 ||
    verification.keyId !== baseline.envelope.signature.keyId ||
    verification.selectedAnchorSetSha256 !== baseline.selectedAnchorSetSha256 ||
    verification.selectedDirectorySha256 !== baseline.selectedDirectorySha256 ||
    verification.selectedSubscriptionSetSha256 !==
      baseline.selectedSubscriptionSetSha256 ||
    verification.selectedMetadataEnvelopeSetSha256 !==
      baseline.selectedMetadataEnvelopeSetSha256 ||
    !optionalSha256(verification.anchorDirectorySha256) ||
    !optionalSha256(verification.anchorDirectoryVerificationSha256) ||
    !optionalSha256(verification.anchorDirectoryPolicySha256) ||
    !SHA256_PATTERN.test(verification.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline verification is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = verification;
  if (sha256(canonicalJson(content)) !== verification.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline verification hash mismatch",
    );
  }
  return structuredClone(verification);
}

function validateQuorumPromotionBaselineImportPolicyReview(
  value: unknown,
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline import policy review is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "reviewedAt",
    "status",
    "diagnostics",
    "policy",
    "policySha256",
    "baselineSha256",
    "envelopeSha256",
    "receiptSha256",
    "keyId",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedSourceOriginCount",
    "selectedSourceOriginSetSha256",
    "selectedMetadataPublisherCount",
    "selectedMetadataPublisherSetSha256",
    "selectedMetadataSignerCount",
    "selectedMetadataSignerSetSha256",
    "contentSha256",
  ]);
  const review =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
      review.policy,
    );
  if (
    review.kind !==
      "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-import-policy-review" ||
    review.schemaVersion !== 1 ||
    review.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(review.reviewedAt) ||
    (review.status !== "accepted" && review.status !== "rejected") ||
    !validDiagnostics(review.diagnostics) ||
    review.policySha256 !== sha256(canonicalJson(policy)) ||
    review.baselineSha256 !== baseline.contentSha256 ||
    review.envelopeSha256 !== baseline.envelope.contentSha256 ||
    review.receiptSha256 !== baseline.envelope.receipt.contentSha256 ||
    review.keyId !== baseline.envelope.signature.keyId ||
    review.selectedAnchorSetSha256 !== baseline.selectedAnchorSetSha256 ||
    review.selectedDirectorySha256 !== baseline.selectedDirectorySha256 ||
    !nonNegativeInteger(review.selectedSourceOriginCount) ||
    !SHA256_PATTERN.test(review.selectedSourceOriginSetSha256 ?? "") ||
    !nonNegativeInteger(review.selectedMetadataPublisherCount) ||
    !SHA256_PATTERN.test(review.selectedMetadataPublisherSetSha256 ?? "") ||
    !nonNegativeInteger(review.selectedMetadataSignerCount) ||
    !SHA256_PATTERN.test(review.selectedMetadataSignerSetSha256 ?? "") ||
    !SHA256_PATTERN.test(review.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline import policy review is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...review,
    policy,
  };
  if (sha256(canonicalJson(content)) !== review.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum promotion baseline import policy review hash mismatch",
    );
  }
  return structuredClone({
    ...review,
    policy,
  });
}

function validateReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
  value: unknown,
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
): ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source alignment is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "baselineSha256",
    "selectedAnchorSetSha256",
    "selectedDirectorySha256",
    "selectedSourceOriginCount",
    "selectedSourceOriginSetSha256",
    "alignedSourceCount",
    "driftedSourceCount",
    "missingSourceCount",
    "sources",
    "contentSha256",
  ]);
  const alignment =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment;
  const sources = validateQuorumActivationSources(alignment.sources);
  const selectedSourceOrigins = sources
    .map((source) => source.sourceOriginSha256)
    .sort();
  if (
    alignment.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-source-alignment" ||
    alignment.schemaVersion !== 1 ||
    alignment.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(alignment.generatedAt) ||
    alignment.baselineSha256 !== baseline.contentSha256 ||
    alignment.selectedAnchorSetSha256 !== baseline.selectedAnchorSetSha256 ||
    alignment.selectedDirectorySha256 !== baseline.selectedDirectorySha256 ||
    alignment.selectedSourceOriginCount !== sources.length ||
    alignment.selectedSourceOriginSetSha256 !==
      sha256(canonicalJson(selectedSourceOrigins)) ||
    alignment.alignedSourceCount !==
      sources.filter((source) => source.status === "aligned").length ||
    alignment.driftedSourceCount !==
      sources.filter(
        (source) =>
          source.status === "directory_drift" ||
          source.status === "anchor_set_drift",
      ).length ||
    alignment.missingSourceCount !==
      sources.filter(
        (source) =>
          source.status === "missing_subscription" ||
          source.status === "no_last_good",
      ).length ||
    !SHA256_PATTERN.test(alignment.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source alignment is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...alignment,
    sources,
  };
  if (sha256(canonicalJson(content)) !== alignment.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source alignment hash mismatch",
    );
  }
  return structuredClone({
    ...alignment,
    sources,
  });
}

function validateQuorumActivationSources(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSource[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation sources are invalid",
    );
  }
  const seen = new Set<string>();
  return value
    .map((item) => {
      const source = validateQuorumActivationSource(item);
      if (seen.has(source.sourceOriginSha256)) {
        throw new Error(
          "Receipt trust anchor directory quorum activation sources are invalid",
        );
      }
      seen.add(source.sourceOriginSha256);
      return source;
    })
    .sort((left, right) =>
      left.sourceOriginSha256.localeCompare(right.sourceOriginSha256),
    );
}

function validateQuorumActivationSource(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSource {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source is invalid",
    );
  }
  assertAllowedKeys(value, [
    "sourceOriginSha256",
    "status",
    "subscriptionId",
    "subscriptionSha256",
    "currentAnchorSetSha256",
    "currentDirectorySha256",
    "contentSha256",
  ]);
  const source =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSource;
  if (
    !SHA256_PATTERN.test(source.sourceOriginSha256) ||
    !validQuorumActivationSourceStatus(source.status) ||
    (source.subscriptionId !== undefined &&
      !SUBSCRIPTION_ID_PATTERN.test(source.subscriptionId)) ||
    !optionalSha256(source.subscriptionSha256) ||
    !optionalSha256(source.currentAnchorSetSha256) ||
    !optionalSha256(source.currentDirectorySha256) ||
    !SHA256_PATTERN.test(source.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = source;
  if (sha256(canonicalJson(content)) !== source.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation source hash mismatch",
    );
  }
  return structuredClone(source);
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
    throw new Error(
      "Receipt trust anchor directory quorum sources are invalid",
    );
  }
  return value
    .map(validateQuorumSource)
    .sort((left, right) =>
      left.subscriptionId.localeCompare(right.subscriptionId),
    );
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
  return value
    .map(validateQuorumCandidate)
    .sort(
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

function createCheckpointSubscriptionTransparencyEntry(input: {
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyStatus;
  observedAt: string;
  previousEntrySha256?: string;
  previousSequence?: number;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry {
  if (!input.discovery.envelope || !input.discovery.checkpointSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint transparency entry requires a signed checkpoint",
    );
  }
  const observedAt = requireTimestamp(
    input.observedAt,
    "checkpoint subscription transparency observation time",
  );
  if (
    input.previousEntrySha256 !== undefined &&
    !SHA256_PATTERN.test(input.previousEntrySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint transparency predecessor is invalid",
    );
  }
  const sequence = (input.previousSequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint transparency sequence is invalid",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription-transparency-entry" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    sequence,
    status: input.status,
    observedAt,
    discoverySha256: input.discovery.contentSha256,
    envelopeSha256: input.discovery.envelope.contentSha256,
    checkpointSha256: input.discovery.checkpointSha256,
    selectionCount: input.discovery.selectionCount ?? 0,
    selectionSetSha256:
      input.discovery.selectionSetSha256 ?? sha256(canonicalJson([])),
    ...(input.discovery.selectionChainTailSha256
      ? { selectionChainTailSha256: input.discovery.selectionChainTailSha256 }
      : {}),
    ...(input.previousEntrySha256
      ? { previousEntrySha256: input.previousEntrySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function appendCheckpointSubscriptionTransparencyEntry(
  history: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry[],
  entry: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry[] {
  return [...history, entry].slice(
    -MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTION_TRANSPARENCY_ENTRIES,
  );
}

function validateCheckpointSubscriptionTransparencyHistory(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry[] {
  if (
    !Array.isArray(value) ||
    value.length >
      MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTION_TRANSPARENCY_ENTRIES
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency history is invalid",
    );
  }
  const entries = value.map(validateCheckpointSubscriptionTransparencyEntry);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    if (previous) {
      if (
        entry.sequence !== previous.sequence + 1 ||
        entry.previousEntrySha256 !== previous.contentSha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency chain is invalid",
        );
      }
    } else if (
      (entry.sequence === 1 && entry.previousEntrySha256 !== undefined) ||
      (entry.sequence > 1 && !entry.previousEntrySha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency chain is invalid",
      );
    }
  }
  return entries;
}

function validateCheckpointSubscriptionTransparencyEntry(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency entry is invalid",
    );
  }
  const entry =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry;
  if (
    entry.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription-transparency-entry" ||
    entry.schemaVersion !== 1 ||
    entry.apiVersion !== NAPIER_API_VERSION ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    (entry.status !== "accepted" && entry.status !== "unchanged") ||
    !validTimestamp(entry.observedAt) ||
    !SHA256_PATTERN.test(entry.discoverySha256) ||
    !SHA256_PATTERN.test(entry.envelopeSha256) ||
    !SHA256_PATTERN.test(entry.checkpointSha256) ||
    !nonNegativeInteger(entry.selectionCount) ||
    !SHA256_PATTERN.test(entry.selectionSetSha256) ||
    !optionalSha256(entry.selectionChainTailSha256) ||
    !optionalSha256(entry.previousEntrySha256) ||
    !SHA256_PATTERN.test(entry.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency entry is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = entry;
  if (sha256(canonicalJson(content)) !== entry.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint subscription transparency entry hash mismatch",
    );
  }
  return structuredClone(entry);
}

function createRotationProposalSubscriptionTransparencyEntry(input: {
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyStatus;
  observedAt: string;
  previousEntrySha256?: string;
  previousSequence?: number;
}): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry {
  if (
    !input.discovery.envelope ||
    !input.discovery.proposalSha256 ||
    !input.discovery.preflight
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal transparency entry requires a signed proposal",
    );
  }
  const observedAt = requireTimestamp(
    input.observedAt,
    "rotation proposal subscription transparency observation time",
  );
  if (
    input.previousEntrySha256 !== undefined &&
    !SHA256_PATTERN.test(input.previousEntrySha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal transparency predecessor is invalid",
    );
  }
  const sequence = (input.previousSequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal transparency sequence is invalid",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-transparency-entry" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    sequence,
    status: input.status,
    observedAt,
    discoverySha256: input.discovery.contentSha256,
    envelopeSha256: input.discovery.envelope.contentSha256,
    proposalSha256: input.discovery.proposalSha256,
    preflightSha256: input.discovery.preflight.contentSha256,
    ...(input.previousEntrySha256
      ? { previousEntrySha256: input.previousEntrySha256 }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function appendRotationProposalSubscriptionTransparencyEntry(
  history: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry[],
  entry: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry[] {
  return [...history, entry].slice(
    -MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTION_TRANSPARENCY_ENTRIES,
  );
}

function validateRotationProposalSubscriptionTransparencyHistory(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry[] {
  if (
    !Array.isArray(value) ||
    value.length >
      MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTION_TRANSPARENCY_ENTRIES
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency history is invalid",
    );
  }
  const entries = value.map(validateRotationProposalSubscriptionTransparencyEntry);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    if (previous) {
      if (
        entry.sequence !== previous.sequence + 1 ||
        entry.previousEntrySha256 !== previous.contentSha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency chain is invalid",
        );
      }
    } else if (
      (entry.sequence === 1 && entry.previousEntrySha256 !== undefined) ||
      (entry.sequence > 1 && !entry.previousEntrySha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency chain is invalid",
      );
    }
  }
  return entries;
}

function validateRotationProposalSubscriptionTransparencyEntry(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency entry is invalid",
    );
  }
  const entry =
    value as unknown as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry;
  if (
    entry.kind !==
      "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-transparency-entry" ||
    entry.schemaVersion !== 1 ||
    entry.apiVersion !== NAPIER_API_VERSION ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    (entry.status !== "accepted" && entry.status !== "unchanged") ||
    !validTimestamp(entry.observedAt) ||
    !SHA256_PATTERN.test(entry.discoverySha256) ||
    !SHA256_PATTERN.test(entry.envelopeSha256) ||
    !SHA256_PATTERN.test(entry.proposalSha256) ||
    !SHA256_PATTERN.test(entry.preflightSha256) ||
    !optionalSha256(entry.previousEntrySha256) ||
    !SHA256_PATTERN.test(entry.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency entry is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = entry;
  if (sha256(canonicalJson(content)) !== entry.contentSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription transparency entry hash mismatch",
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

function checkpointSubscriptionContent(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): Omit<
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  "contentSha256"
> {
  const {
    contentSha256: _contentSha256,
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    ...content
  } = input as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription &
    Partial<PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription>;
  return content;
}

function hashCheckpointSubscriptionContent(value: object): string {
  return sha256(canonicalJson(value));
}

function rotationProposalSubscriptionContent(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
): Omit<
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  "contentSha256"
> {
  const {
    contentSha256: _contentSha256,
    sourceUrl: _sourceUrl,
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    pendingApprovalApply: _pendingApprovalApply,
    ...content
  } = input as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription &
    Partial<PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription>;
  return content;
}

function hashRotationProposalSubscriptionContent(value: object): string {
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

function validateOptionalRotationProposalApprovalApply(
  value: unknown,
):
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyState
  | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal approval apply state is invalid",
    );
  }
  const status = value["status"];
  const envelope = validateTrustedReceiptEnvelope(
    value["approvalEnvelope"],
  ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
  const claim = validateOptionalClaim(value["claim"]);
  const claimTokenSha256 = value["claimTokenSha256"];
  if (
    (status !== "pending" &&
      status !== "applied" &&
      status !== "rejected" &&
      status !== "failed") ||
    !validTimestamp(value["queuedAt"]) ||
    !validTimestamp(value["applyAfter"]) ||
    envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval" ||
    value["approvalEnvelopeSha256"] !== envelope.contentSha256 ||
    value["approvalSha256"] !== envelope.receipt.contentSha256 ||
    (claim === undefined) !== (claimTokenSha256 === undefined) ||
    (claimTokenSha256 !== undefined &&
      (typeof claimTokenSha256 !== "string" ||
        !SHA256_PATTERN.test(claimTokenSha256))) ||
    !optionalTimestamp(value["settledAt"]) ||
    !optionalSha256(value["resultSha256"]) ||
    !optionalSha256(value["failureSha256"])
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal approval apply state is invalid",
    );
  }
  return {
    status,
    queuedAt: value["queuedAt"],
    applyAfter: value["applyAfter"],
    approvalEnvelope: envelope,
    approvalEnvelopeSha256: envelope.contentSha256,
    approvalSha256: envelope.receipt.contentSha256,
    ...(claim ? { claim } : {}),
    ...(typeof claimTokenSha256 === "string" ? { claimTokenSha256 } : {}),
    ...(typeof value["settledAt"] === "string"
      ? { settledAt: value["settledAt"] }
      : {}),
    ...(typeof value["resultSha256"] === "string"
      ? { resultSha256: value["resultSha256"] }
      : {}),
    ...(typeof value["failureSha256"] === "string"
      ? { failureSha256: value["failureSha256"] }
      : {}),
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

function optionalCheckpointSubscriptionRefreshStatus(
  value: unknown,
): value is
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus
  | undefined {
  return (
    value === undefined ||
    value === "accepted" ||
    value === "unchanged" ||
    value === "rollback_rejected" ||
    value === "rejected" ||
    value === "failed"
  );
}

function optionalRotationProposalSubscriptionRefreshStatus(
  value: unknown,
): value is
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus
  | undefined {
  return (
    value === undefined ||
    value === "accepted" ||
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
        typeof diagnostic === "string" && /^[a-z0-9_]{1,80}$/.test(diagnostic),
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

function validateSha256List(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    !value.every((item) => typeof item === "string" && SHA256_PATTERN.test(item))
  ) {
    throw new Error(`${label} is invalid`);
  }
  const values = value as string[];
  const sorted = [...values].sort();
  if (
    values.length !== new Set(values).size ||
    values.some((item, index) => item !== sorted[index])
  ) {
    throw new Error(`${label} is invalid`);
  }
  return values;
}

function optionalTrustedReceiptStatus(value: unknown): boolean {
  return value === undefined || validTrustedReceiptStatus(value);
}

function validTrustedReceiptStatus(value: unknown): boolean {
  return (
    value === "trusted" ||
    value === "revoked" ||
    value === "unknown_key" ||
    value === "invalid"
  );
}

function validQuorumActivationSourceStatus(value: unknown): boolean {
  return (
    value === "aligned" ||
    value === "directory_drift" ||
    value === "anchor_set_drift" ||
    value === "no_last_good" ||
    value === "missing_subscription"
  );
}

function validActivationSelectionDriftStatus(value: unknown): boolean {
  return (
    value === "missing_selection" ||
    value === "aligned" ||
    value === "directory_drift" ||
    value === "anchor_set_drift" ||
    value === "quorum_unavailable"
  );
}

function validRotationReviewStatus(value: unknown): boolean {
  return (
    value === "eligible" ||
    value === "already_active" ||
    value === "blocked" ||
    value === "stale_selection" ||
    value === "missing_decision"
  );
}

function validRotationProposalStatus(value: unknown): boolean {
  return (
    value === "proposed" ||
    value === "blocked" ||
    value === "stale_selection" ||
    value === "missing_decision" ||
    value === "already_active" ||
    value === "missing_checkpoint_registry_baseline"
  );
}

function validQuorumStatus(value: unknown): boolean {
  return (
    value === "agreed" ||
    value === "insufficient_sources" ||
    value === "split" ||
    value === "policy_failed"
  );
}

function validCheckpointRegistryQuorumStatus(value: unknown): boolean {
  return (
    value === "agreed" ||
    value === "insufficient_sources" ||
    value === "split" ||
    value === "policy_failed" ||
    value === "stale"
  );
}

function validCheckpointRegistrySourceStatus(value: unknown): boolean {
  return (
    value === "eligible" ||
    value === "paused" ||
    value === "missing_last_good" ||
    value === "stale"
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
