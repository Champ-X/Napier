import { isNonNegativeInteger, isSha256Hex, MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT, parseReceiptTrustAnchorDirectoryVerificationPolicy, validSha256List } from "./receipt-trust-http-validation-primitives.js";
import { requestRecord, validThreadId } from "./http-request-validation.js";
import { sha256Json, sha256Text } from "./http-response-evidence.js";
import { parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy, parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy } from "./receipt-trust-http-validation-discovery-policy.js";
import type { NapierServices } from "./server-composition-root.js";
import type { CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest, CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest, CreateReceiptTrustAnchorDirectorySubscriptionRequest, EvaluateReceiptTrustAnchorDirectoryQuorumRequest, PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest, PromoteReceiptTrustAnchorDirectoryQuorumRequest, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy, ReceiptTrustAnchorDirectoryQuorumMetadataEvidence, ReceiptTrustAnchorDirectoryQuorumMetadataInput, ReceiptTrustAnchorDirectoryQuorumPolicy, ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy, RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest, RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest, RefreshReceiptTrustAnchorDirectorySubscriptionRequest, UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest, UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest, UpdateReceiptTrustAnchorDirectorySubscriptionRequest } from "@napier/contracts";
import {
  MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS,
  MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
  MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS,
  receiptTrustAnchorsFromDirectory,
  verifyReceiptTrustAnchorDirectoryMetadata,
} from "@napier/runtime/governance";

export function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(input: unknown): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["minimumSources", "minimumAgreementCount", "minimumDistinctSourceOrigins", "maxObservationAgeMs", "expectedCheckpointSha256", "expectedSelectionSetSha256", "expectedSelectionChainTailSha256", "minimumSelectionCount", "requiredSourceOriginSha256s", "requiredSignerKeyIds"]);
  if (!record) return undefined;
  const minimumSources = record["minimumSources"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const maxObservationAgeMs = record["maxObservationAgeMs"];
  const expectedCheckpointSha256 = record["expectedCheckpointSha256"];
  const expectedSelectionSetSha256 = record["expectedSelectionSetSha256"];
  const expectedSelectionChainTailSha256 = record["expectedSelectionChainTailSha256"];
  const minimumSelectionCount = record["minimumSelectionCount"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  if (
    !validOptionalPositiveCount(minimumSources) ||
    !validOptionalPositiveCount(minimumAgreementCount) ||
    !validOptionalPositiveCount(minimumDistinctSourceOrigins) ||
    !validOptionalNonNegativeAtMost(maxObservationAgeMs, 365 * 24 * 60 * 60 * 1_000) ||
    !validOptionalSha256OrEmpty(expectedCheckpointSha256) ||
    !validOptionalSha256OrEmpty(expectedSelectionSetSha256) ||
    !validOptionalSha256OrEmpty(expectedSelectionChainTailSha256) ||
    !validOptionalNonNegativeAtMost(minimumSelectionCount, MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT) ||
    !validSha256List(requiredSourceOriginSha256s, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validSha256List(requiredSignerKeyIds, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)
  ) {
    return undefined;
  }
  return {
    ...(minimumSources !== undefined ? { minimumSources } : {}),
    ...(minimumAgreementCount !== undefined ? { minimumAgreementCount } : {}),
    ...(minimumDistinctSourceOrigins !== undefined ? { minimumDistinctSourceOrigins } : {}),
    ...(maxObservationAgeMs !== undefined ? { maxObservationAgeMs } : {}),
    ...(typeof expectedCheckpointSha256 === "string" ? { expectedCheckpointSha256 } : {}),
    ...(typeof expectedSelectionSetSha256 === "string" ? { expectedSelectionSetSha256 } : {}),
    ...(typeof expectedSelectionChainTailSha256 === "string" ? { expectedSelectionChainTailSha256 } : {}),
    ...(minimumSelectionCount !== undefined ? { minimumSelectionCount } : {}),
    ...(requiredSourceOriginSha256s !== undefined
      ? {
          requiredSourceOriginSha256s: Array.from(new Set(requiredSourceOriginSha256s as string[])).sort(),
        }
      : {}),
    ...(requiredSignerKeyIds !== undefined
      ? {
          requiredSignerKeyIds: Array.from(new Set(requiredSignerKeyIds as string[])).sort(),
        }
      : {}),
  };
}

export function parseCreateReceiptTrustAnchorDirectorySubscriptionRequest(input: unknown): CreateReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "sourceUrl", "refreshIntervalMs", "policy"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["policy"]);
  if (!record || !validThreadId(threadId) || typeof label !== "string" || label.trim().length < 1 || label.trim().length > 100 || typeof sourceUrl !== "string" || sourceUrl.length < 1 || sourceUrl.length > 2_048 || !isNonNegativeInteger(refreshIntervalMs) || refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || !policy) {
    return undefined;
  }
  return {
    threadId,
    label,
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

export function parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input: unknown): CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "sourceUrl", "refreshIntervalMs", "policy"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(record?.["policy"]);
  if (!record || record["policy"] === undefined || !validThreadId(threadId) || typeof label !== "string" || label.trim().length < 1 || label.trim().length > 100 || typeof sourceUrl !== "string" || sourceUrl.length < 1 || sourceUrl.length > 2_048 || !isNonNegativeInteger(refreshIntervalMs) || refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || !policy) {
    return undefined;
  }
  return {
    threadId,
    label: label.trim(),
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

export function parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input: unknown): CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "sourceUrl", "refreshIntervalMs", "policy"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(record?.["policy"]);
  if (!record || record["policy"] === undefined || !validThreadId(threadId) || typeof label !== "string" || label.trim().length < 1 || label.trim().length > 100 || typeof sourceUrl !== "string" || sourceUrl.length < 1 || sourceUrl.length > 2_048 || !isNonNegativeInteger(refreshIntervalMs) || refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS || !policy) {
    return undefined;
  }
  return {
    threadId,
    label: label.trim(),
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

export function parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(input: unknown): EvaluateReceiptTrustAnchorDirectoryQuorumRequest | undefined {
  const record = requestRecord(input, ["policy", "metadata", "trustDirectory", "trustDirectoryPolicy"]);
  const policy = parseReceiptTrustAnchorDirectoryQuorumPolicy(record?.["policy"]);
  const metadata = parseReceiptTrustAnchorDirectoryQuorumMetadataInputs(record?.["metadata"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || (record["policy"] !== undefined && !policy) || (record["metadata"] !== undefined && !metadata) || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
    ...(metadata ? { metadata } : {}),
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parsePromoteReceiptTrustAnchorDirectoryQuorumRequest(input: unknown): PromoteReceiptTrustAnchorDirectoryQuorumRequest | undefined {
  return parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(input);
}

export function parsePromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest(input: unknown): PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest | undefined {
  const record = requestRecord(input, ["policy", "metadata", "trustDirectory", "trustDirectoryPolicy", "threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const quorumRequest = record
    ? parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest({
        ...(record["policy"] !== undefined ? { policy: record["policy"] } : {}),
        ...(record["metadata"] !== undefined ? { metadata: record["metadata"] } : {}),
        ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
        ...(record["trustDirectoryPolicy"] !== undefined ? { trustDirectoryPolicy: record["trustDirectoryPolicy"] } : {}),
      })
    : undefined;
  return record && quorumRequest && validThreadId(threadId) && typeof trustAnchorId === "string" && /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
    ? {
        ...quorumRequest,
        threadId,
        trustAnchorId,
      }
    : undefined;
}

export function parseReceiptTrustAnchorDirectoryQuorumMetadataInputs(input: unknown): ReceiptTrustAnchorDirectoryQuorumMetadataInput[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) {
    return undefined;
  }
  const seen = new Set<string>();
  const metadata: ReceiptTrustAnchorDirectoryQuorumMetadataInput[] = [];
  for (const item of input) {
    const record = requestRecord(item, ["subscriptionId", "envelope"]);
    const subscriptionId = record?.["subscriptionId"];
    if (!record || typeof subscriptionId !== "string" || !/^trustdir_[a-f0-9]{20}$/.test(subscriptionId) || record["envelope"] === undefined || seen.has(subscriptionId)) {
      return undefined;
    }
    seen.add(subscriptionId);
    metadata.push({ subscriptionId, envelope: record["envelope"] });
  }
  return metadata.sort((left, right) => left.subscriptionId.localeCompare(right.subscriptionId));
}

export function createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(services: NapierServices, request: EvaluateReceiptTrustAnchorDirectoryQuorumRequest): ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[] {
  if (!request.metadata?.length) return [];
  const trustDirectoryVerification = request.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(request.trustDirectory, request.trustDirectoryPolicy);
  const anchors = request.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(request.trustDirectory) : [];
  return request.metadata.map((metadata) => {
    const subscription = services.store.getReceiptTrustAnchorDirectorySubscription(metadata.subscriptionId);
    const directory = subscription.lastGoodDiscovery?.directory;
    if (!directory) {
      throw new Error("Receipt trust anchor directory quorum metadata subscription has no last-good directory");
    }
    const verification = verifyReceiptTrustAnchorDirectoryMetadata(metadata.envelope, directory, anchors, {
      directoryPolicy: subscription.policy,
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    return {
      subscriptionId: metadata.subscriptionId,
      status: verification.status,
      signatureValid: verification.signatureValid,
      integrityValid: verification.integrityValid,
      directoryBindingValid: verification.directoryBindingValid,
      diagnosticCount: verification.diagnostics.length,
      diagnosticsSha256: sha256Json(verification.diagnostics),
      ...(verification.publisher ? { publisherSha256: sha256Text(verification.publisher) } : {}),
      ...(verification.signerKeyId ? { signerKeyId: verification.signerKeyId } : {}),
      ...(verification.envelopeSha256 ? { envelopeSha256: verification.envelopeSha256 } : {}),
      verificationSha256: verification.contentSha256,
    };
  });
}

export function parseReceiptTrustAnchorDirectoryQuorumPolicy(input: unknown): ReceiptTrustAnchorDirectoryQuorumPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, ["minimumSources", "minimumAgreementCount", "minimumDistinctSourceOrigins", "minimumAgreementWeight", "minimumMetadataPublisherCount", "expectedAnchorSetSha256", "requiredSourceOriginSha256s", "requiredMetadataPublisherSha256s", "sourceWeights"]);
  if (!record) return undefined;
  const minimumSources = record["minimumSources"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const minimumAgreementWeight = record["minimumAgreementWeight"];
  const minimumMetadataPublisherCount = record["minimumMetadataPublisherCount"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredMetadataPublisherSha256s = record["requiredMetadataPublisherSha256s"];
  const sourceWeights = record["sourceWeights"];
  const effectiveMinimumSources = typeof minimumSources === "number" ? minimumSources : 2;
  if (
    !validOptionalPositiveCount(minimumSources) ||
    !validOptionalPositiveCount(minimumAgreementCount) ||
    !validOptionalPositiveCount(minimumDistinctSourceOrigins) ||
    !validOptionalNonNegativeAtMost(minimumAgreementWeight, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS * MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT, true) ||
    !validOptionalNonNegativeAtMost(minimumMetadataPublisherCount, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    (minimumAgreementCount !== undefined && minimumAgreementCount > effectiveMinimumSources) ||
    !validOptionalSha256OrEmpty(expectedAnchorSetSha256) ||
    !validSha256List(requiredSourceOriginSha256s, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validSha256List(requiredMetadataPublisherSha256s, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validOptionalSourceWeights(sourceWeights)
  ) {
    return undefined;
  }
  const policy: ReceiptTrustAnchorDirectoryQuorumPolicy = {};
  assignDefined(policy, "minimumSources", minimumSources);
  assignDefined(policy, "minimumAgreementCount", minimumAgreementCount);
  assignDefined(policy, "minimumDistinctSourceOrigins", minimumDistinctSourceOrigins);
  assignDefined(policy, "minimumAgreementWeight", minimumAgreementWeight);
  assignDefined(policy, "minimumMetadataPublisherCount", minimumMetadataPublisherCount);
  assignDefined(policy, "expectedAnchorSetSha256", expectedAnchorSetSha256);
  assignDefined(policy, "requiredSourceOriginSha256s", normalizeOptionalSha256List(requiredSourceOriginSha256s));
  assignDefined(policy, "requiredMetadataPublisherSha256s", normalizeOptionalSha256List(requiredMetadataPublisherSha256s));
  assignDefined(policy, "sourceWeights", normalizeOptionalSourceWeights(sourceWeights));
  return policy;
}

export function parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(input: unknown): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, ["maxBaselineAgeMs", "maxReceiptAgeMs", "maxSourceObservedAgeMs", "minimumAgreementCount", "minimumAgreementWeight", "minimumDistinctSourceOrigins", "minimumMetadataPublisherCount", "minimumSelectedMetadataCount", "expectedAnchorSetSha256", "expectedDirectorySha256", "requiredSourceOriginSha256s", "requiredMetadataPublisherSha256s", "requiredMetadataSignerKeyIds"]);
  if (!record) return undefined;
  const maxBaselineAgeMs = record["maxBaselineAgeMs"];
  const maxReceiptAgeMs = record["maxReceiptAgeMs"];
  const maxSourceObservedAgeMs = record["maxSourceObservedAgeMs"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumAgreementWeight = record["minimumAgreementWeight"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const minimumMetadataPublisherCount = record["minimumMetadataPublisherCount"];
  const minimumSelectedMetadataCount = record["minimumSelectedMetadataCount"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const expectedDirectorySha256 = record["expectedDirectorySha256"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredMetadataPublisherSha256s = record["requiredMetadataPublisherSha256s"];
  const requiredMetadataSignerKeyIds = record["requiredMetadataSignerKeyIds"];
  if (
    !validOptionalNonNegative(maxBaselineAgeMs) ||
    !validOptionalNonNegative(maxReceiptAgeMs) ||
    !validOptionalNonNegative(maxSourceObservedAgeMs) ||
    !validOptionalNonNegativeAtMost(minimumAgreementCount, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validOptionalNonNegativeAtMost(minimumAgreementWeight, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS * MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT) ||
    !validOptionalNonNegativeAtMost(minimumDistinctSourceOrigins, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validOptionalNonNegativeAtMost(minimumMetadataPublisherCount, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validOptionalNonNegativeAtMost(minimumSelectedMetadataCount, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validOptionalSha256OrEmpty(expectedAnchorSetSha256) ||
    !validOptionalSha256OrEmpty(expectedDirectorySha256) ||
    !validSha256List(requiredSourceOriginSha256s, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validSha256List(requiredMetadataPublisherSha256s, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    !validSha256List(requiredMetadataSignerKeyIds, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)
  ) {
    return undefined;
  }
  const policy: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy = {};
  assignDefined(policy, "maxBaselineAgeMs", maxBaselineAgeMs);
  assignDefined(policy, "maxReceiptAgeMs", maxReceiptAgeMs);
  assignDefined(policy, "maxSourceObservedAgeMs", maxSourceObservedAgeMs);
  assignDefined(policy, "minimumAgreementCount", minimumAgreementCount);
  assignDefined(policy, "minimumAgreementWeight", minimumAgreementWeight);
  assignDefined(policy, "minimumDistinctSourceOrigins", minimumDistinctSourceOrigins);
  assignDefined(policy, "minimumMetadataPublisherCount", minimumMetadataPublisherCount);
  assignDefined(policy, "minimumSelectedMetadataCount", minimumSelectedMetadataCount);
  assignDefined(policy, "expectedAnchorSetSha256", expectedAnchorSetSha256);
  assignDefined(policy, "expectedDirectorySha256", expectedDirectorySha256);
  assignDefined(policy, "requiredSourceOriginSha256s", normalizeOptionalSha256List(requiredSourceOriginSha256s));
  assignDefined(policy, "requiredMetadataPublisherSha256s", normalizeOptionalSha256List(requiredMetadataPublisherSha256s));
  assignDefined(policy, "requiredMetadataSignerKeyIds", normalizeOptionalSha256List(requiredMetadataSignerKeyIds));
  return policy;
}

function validOptionalPositiveCount(value: unknown): value is number | undefined {
  return value === undefined || (isNonNegativeInteger(value) && value >= 1 && value <= MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS);
}

function validOptionalNonNegative(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function validOptionalNonNegativeAtMost(
  value: unknown,
  maximum: number,
  requirePositive = false,
): value is number | undefined {
  return value === undefined || (isNonNegativeInteger(value) && (!requirePositive || value >= 1) && value <= maximum);
}

function validOptionalSha256OrEmpty(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && (value === "" || isSha256Hex(value)));
}

function validOptionalSourceWeights(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) return false;
  const origins = new Set<string>();
  return value.every((item) => {
    const record = requestRecord(item, ["sourceOriginSha256", "weight"]);
    const sourceOriginSha256 = record?.["sourceOriginSha256"];
    const weight = record?.["weight"];
    if (!record || !isSha256Hex(sourceOriginSha256) || !isNonNegativeInteger(weight) || weight < 1 || weight > MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT || origins.has(sourceOriginSha256)) {
      return false;
    }
    origins.add(sourceOriginSha256);
    return true;
  });
}

function assignDefined(target: object, key: string, value: unknown): void {
  if (value !== undefined) Object.assign(target, { [key]: value });
}

function normalizeOptionalSha256List(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.from(new Set(value as string[])).sort();
}

function normalizeOptionalSourceWeights(
  value: unknown,
): ReceiptTrustAnchorDirectoryQuorumPolicy["sourceWeights"] | undefined {
  if (value === undefined) return undefined;
  return (value as Record<string, unknown>[])
    .map((item) => ({
      sourceOriginSha256: item["sourceOriginSha256"] as string,
      weight: item["weight"] as number,
    }))
    .sort((left, right) =>
      left.sourceOriginSha256.localeCompare(right.sourceOriginSha256),
    );
}

export function parseRefreshReceiptTrustAnchorDirectorySubscriptionRequest(input: unknown): RefreshReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 ? { threadId, expectedRevision } : undefined;
}

export function parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input: unknown): RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 ? { threadId, expectedRevision } : undefined;
}

export function parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input: unknown): RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 ? { threadId, expectedRevision } : undefined;
}

export function parseUpdateReceiptTrustAnchorDirectorySubscriptionRequest(input: unknown): UpdateReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision", "status"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 && (status === "active" || status === "paused") ? { threadId, expectedRevision, status } : undefined;
}

export function parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input: unknown): UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision", "status"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 && (status === "active" || status === "paused") ? { threadId, expectedRevision, status } : undefined;
}

export function parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input: unknown): UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision", "status"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record && validThreadId(threadId) && isNonNegativeInteger(expectedRevision) && expectedRevision >= 1 && (status === "active" || status === "paused") ? { threadId, expectedRevision, status } : undefined;
}

