import { isNonNegativeInteger, isSha256Hex, parseReceiptTrustAnchorDirectoryVerificationPolicy } from "./receipt-trust-http-validation-primitives.js";
import { parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy } from "./receipt-trust-http-validation-discovery-policy.js";
import { requestRecord, validThreadId } from "./http-request-validation.js";
import { parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest } from "./receipt-trust-http-validation-core.js";
import { parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy, parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy } from "./receipt-trust-http-validation-subscriptions.js";
import type { DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest, DiscoverReceiptTrustAnchorDirectoryRequest, EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest, ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest, ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest, PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest, ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest, ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest, SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest, SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest, SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest, VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest, VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest, VerifyReceiptTrustAnchorDirectoryRequest } from "@napier/contracts";

export function parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(input: unknown): ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest | undefined {
  const record = requestRecord(input, ["activationDecisionRecordId", "expectedCurrentSelectionSha256", "checkpointRegistryQuorumPolicy"]);
  const activationDecisionRecordId = record?.["activationDecisionRecordId"];
  const expectedCurrentSelectionSha256 = record?.["expectedCurrentSelectionSha256"];
  const checkpointRegistryQuorumPolicyInput = record?.["checkpointRegistryQuorumPolicy"];
  const checkpointRegistryQuorumPolicy = checkpointRegistryQuorumPolicyInput === undefined ? undefined : parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(checkpointRegistryQuorumPolicyInput);
  if (!record || (checkpointRegistryQuorumPolicyInput !== undefined && !checkpointRegistryQuorumPolicy) || typeof activationDecisionRecordId !== "string" || !/^trustqad_[a-z0-9]{8,80}$/.test(activationDecisionRecordId) || typeof expectedCurrentSelectionSha256 !== "string" || (expectedCurrentSelectionSha256 !== "" && !isSha256Hex(expectedCurrentSelectionSha256))) {
    return undefined;
  }
  return {
    activationDecisionRecordId,
    expectedCurrentSelectionSha256,
    ...(checkpointRegistryQuorumPolicyInput !== undefined && checkpointRegistryQuorumPolicy ? { checkpointRegistryQuorumPolicy } : {}),
  };
}

export function parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(input: unknown): ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest | undefined {
  const record = requestRecord(input, ["activationDecisionRecordId", "expectedCurrentSelectionSha256", "checkpointRegistryQuorumPolicy", "checkpointRegistryQuorumBaselineId", "expectedCheckpointRegistryQuorumBaselineSha256"]);
  const reviewRequest = record
    ? parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest({
        activationDecisionRecordId: record["activationDecisionRecordId"],
        expectedCurrentSelectionSha256: record["expectedCurrentSelectionSha256"],
        ...(record["checkpointRegistryQuorumPolicy"] !== undefined
          ? {
              checkpointRegistryQuorumPolicy: record["checkpointRegistryQuorumPolicy"],
            }
          : {}),
      })
    : undefined;
  const checkpointRegistryQuorumBaselineId = record?.["checkpointRegistryQuorumBaselineId"];
  const expectedCheckpointRegistryQuorumBaselineSha256 = record?.["expectedCheckpointRegistryQuorumBaselineSha256"];
  if (!record || !reviewRequest || (checkpointRegistryQuorumBaselineId !== undefined && (typeof checkpointRegistryQuorumBaselineId !== "string" || !/^trustcpqb_[a-z0-9]{8,80}$/.test(checkpointRegistryQuorumBaselineId))) || (expectedCheckpointRegistryQuorumBaselineSha256 !== undefined && (typeof expectedCheckpointRegistryQuorumBaselineSha256 !== "string" || !isSha256Hex(expectedCheckpointRegistryQuorumBaselineSha256)))) {
    return undefined;
  }
  return {
    ...reviewRequest,
    ...(typeof checkpointRegistryQuorumBaselineId === "string" ? { checkpointRegistryQuorumBaselineId } : {}),
    ...(typeof expectedCheckpointRegistryQuorumBaselineSha256 === "string" ? { expectedCheckpointRegistryQuorumBaselineSha256 } : {}),
  };
}

export function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input: unknown): SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "activationDecisionRecordId", "expectedCurrentSelectionSha256", "checkpointRegistryQuorumPolicy", "checkpointRegistryQuorumBaselineId", "expectedCheckpointRegistryQuorumBaselineSha256"]);
  const proposalRequest = record
    ? parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest({
        activationDecisionRecordId: record["activationDecisionRecordId"],
        expectedCurrentSelectionSha256: record["expectedCurrentSelectionSha256"],
        ...(record["checkpointRegistryQuorumPolicy"] !== undefined
          ? {
              checkpointRegistryQuorumPolicy: record["checkpointRegistryQuorumPolicy"],
            }
          : {}),
        ...(record["checkpointRegistryQuorumBaselineId"] !== undefined
          ? {
              checkpointRegistryQuorumBaselineId: record["checkpointRegistryQuorumBaselineId"],
            }
          : {}),
        ...(record["expectedCheckpointRegistryQuorumBaselineSha256"] !== undefined
          ? {
              expectedCheckpointRegistryQuorumBaselineSha256: record["expectedCheckpointRegistryQuorumBaselineSha256"],
            }
          : {}),
      })
    : undefined;
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (!record || !proposalRequest || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^trustkey_[a-f0-9]{20}$/.test(trustAnchorId)) {
    return undefined;
  }
  return {
    ...proposalRequest,
    threadId,
    trustAnchorId,
  };
}

export function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(input: unknown): SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "expectedSubscriptionRevision", "expectedSubscriptionSha256", "expectedDiscoverySha256", "expectedEnvelopeSha256", "expectedProposalSha256", "expiresAt", "queueForApply", "applyAfter"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  const expectedDiscoverySha256 = record?.["expectedDiscoverySha256"];
  const expectedEnvelopeSha256 = record?.["expectedEnvelopeSha256"];
  const expectedProposalSha256 = record?.["expectedProposalSha256"];
  const expiresAt = record?.["expiresAt"];
  const queueForApply = record?.["queueForApply"];
  const applyAfter = record?.["applyAfter"];
  if (!record || !validThreadId(threadId) || !validReceiptTrustAnchorId(trustAnchorId) || !validPositiveInteger(expectedSubscriptionRevision) || !isSha256Hex(expectedSubscriptionSha256) || !validOptionalSha256(expectedDiscoverySha256) || !validOptionalSha256(expectedEnvelopeSha256) || !validOptionalSha256(expectedProposalSha256) || !validOptionalIsoDate(expiresAt) || !validOptionalBoolean(queueForApply) || !validOptionalIsoDate(applyAfter)) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    ...(typeof expectedDiscoverySha256 === "string" ? { expectedDiscoverySha256 } : {}),
    ...(typeof expectedEnvelopeSha256 === "string" ? { expectedEnvelopeSha256 } : {}),
    ...(typeof expectedProposalSha256 === "string" ? { expectedProposalSha256 } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
    ...(typeof queueForApply === "boolean" ? { queueForApply } : {}),
    ...(typeof applyAfter === "string" ? { applyAfter } : {}),
  };
}

function validReceiptTrustAnchorId(value: unknown): value is string {
  return typeof value === "string" && /^trustkey_[a-f0-9]{20}$/.test(value);
}

function validPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value >= 1;
}

function validOptionalSha256(value: unknown): value is string | undefined {
  return value === undefined || isSha256Hex(value);
}

function validOptionalIsoDate(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function validOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

export function parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input: unknown): DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest | undefined {
  const record = requestRecord(input, ["threadId", "sourceUrl", "policy"]);
  const threadId = record?.["threadId"];
  const sourceUrl = record?.["sourceUrl"];
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(record?.["policy"]);
  if (!record || !validThreadId(threadId) || typeof sourceUrl !== "string" || sourceUrl.length === 0 || sourceUrl.length > 2_048 || (record["policy"] !== undefined && !policy)) {
    return undefined;
  }
  return {
    threadId,
    sourceUrl,
    ...(policy ? { policy } : {}),
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest | undefined {
  return parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(input) as VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest | undefined;
}

export function parseImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(input: unknown): ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest | undefined {
  const record = requestRecord(input, ["baseline", "threadId", "expectedCurrentBaselineSha256", "importPolicy", "trustDirectory", "trustDirectoryPolicy"]);
  const threadId = record?.["threadId"];
  const expectedCurrentBaselineSha256 = record?.["expectedCurrentBaselineSha256"];
  const importPolicy = parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(record?.["importPolicy"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || record["baseline"] === undefined || !validThreadId(threadId) || typeof expectedCurrentBaselineSha256 !== "string" || (expectedCurrentBaselineSha256 !== "" && !isSha256Hex(expectedCurrentBaselineSha256)) || (record["importPolicy"] !== undefined && !importPolicy) || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    threadId,
    expectedCurrentBaselineSha256,
    ...(importPolicy ? { importPolicy } : {}),
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parseSignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest(input: unknown): SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "baselineId", "importPolicy", "trustDirectory", "trustDirectoryPolicy"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const baselineId = record?.["baselineId"];
  const importPolicy = parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(record?.["importPolicy"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || (baselineId !== undefined && (typeof baselineId !== "string" || !/^trustqpb_[a-z0-9]{8,80}$/.test(baselineId))) || !importPolicy || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    ...(typeof baselineId === "string" ? { baselineId } : {}),
    importPolicy,
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryRequest | undefined {
  const record = requestRecord(input, ["directory", "policy"]);
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["policy"]);
  if (!record || record["directory"] === undefined || (record["policy"] !== undefined && !policy)) {
    return undefined;
  }
  return {
    directory: record["directory"],
    ...(policy ? { policy } : {}),
  };
}

export function parseDiscoverReceiptTrustAnchorDirectoryRequest(input: unknown): DiscoverReceiptTrustAnchorDirectoryRequest | undefined {
  const record = requestRecord(input, ["sourceUrl", "policy"]);
  const sourceUrl = record?.["sourceUrl"];
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["policy"]);
  if (!record || typeof sourceUrl !== "string" || sourceUrl.length === 0 || sourceUrl.length > 2_048 || (record["policy"] !== undefined && !policy)) {
    return undefined;
  }
  return {
    sourceUrl,
    ...(policy ? { policy } : {}),
  };
}

export function parseEvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest(input: unknown): EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest | undefined {
  const record = requestRecord(input, ["policy"]);
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(record?.["policy"]);
  if (!record || (record["policy"] !== undefined && !policy)) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
  };
}

export function parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input: unknown): PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest | undefined {
  const record = requestRecord(input, ["policy", "threadId", "trustAnchorId"]);
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(record?.["policy"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (!record || (record["policy"] !== undefined && !policy) || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
    threadId,
    trustAnchorId,
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest | undefined {
  const record = requestRecord(input, ["baseline", "trustDirectory", "trustDirectoryPolicy"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || record["baseline"] === undefined || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input: unknown): ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest | undefined {
  const record = requestRecord(input, ["baseline", "threadId", "expectedCurrentBaselineSha256", "trustDirectory", "trustDirectoryPolicy"]);
  const verifyRequest = record
    ? parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest({
        baseline: record["baseline"],
        ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
        ...(record["trustDirectoryPolicy"] !== undefined ? { trustDirectoryPolicy: record["trustDirectoryPolicy"] } : {}),
      })
    : undefined;
  const threadId = record?.["threadId"];
  const expectedCurrentBaselineSha256 = record?.["expectedCurrentBaselineSha256"];
  if (!record || !verifyRequest || !validThreadId(threadId) || typeof expectedCurrentBaselineSha256 !== "string" || (expectedCurrentBaselineSha256 !== "" && !isSha256Hex(expectedCurrentBaselineSha256))) {
    return undefined;
  }
  return {
    ...verifyRequest,
    threadId,
    expectedCurrentBaselineSha256,
  };
}
