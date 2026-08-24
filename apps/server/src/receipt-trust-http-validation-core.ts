import { isSha256Hex, isNonNegativeInteger, parseReceiptTrustAnchorDirectoryVerificationPolicy } from "./receipt-trust-http-validation-primitives.js";
import { requestRecord, validThreadId } from "./http-request-validation.js";
import { parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy } from "./receipt-trust-http-validation-discovery-policy.js";
import type { ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest, ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest, ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest, CreateReceiptTrustAnchorRequest, DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest, ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest, PromoteEvaluationQualificationBaselineRequest, PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest, QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval, ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest, RevokeReceiptTrustAnchorRequest, SignReceiptTrustAnchorDirectoryMetadataRequest, SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest, SignTrustedReceiptRequest, TrustedReceiptEnvelope, VerifyReceiptTrustAnchorDirectoryMetadataRequest, VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest, VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest, VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest, VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest, VerifyTrustedReceiptRequest } from "@napier/contracts";

export function parseCreateReceiptTrustAnchorRequest(input: unknown): CreateReceiptTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "source"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const source = requestRecord(record?.["source"], ["type", "variable", "publicKeySpki"]);
  const type = source?.["type"];
  if (!record || typeof threadId !== "string" || !/^thread_[a-z0-9]{8,80}$/.test(threadId) || typeof label !== "string" || !label.replace(/\s+/g, " ").trim() || label.replace(/\s+/g, " ").trim().length > 100 || !source || (type !== "environment" && type !== "public_key")) {
    return undefined;
  }
  if (type === "environment") {
    const variable = source["variable"];
    if (Object.keys(source).some((key) => key !== "type" && key !== "variable") || typeof variable !== "string" || !/^[A-Z_][A-Z0-9_]{1,127}$/.test(variable.trim().toUpperCase())) {
      return undefined;
    }
    return {
      threadId,
      label,
      source: { type, variable },
    };
  }
  const publicKeySpki = source["publicKeySpki"];
  if (Object.keys(source).some((key) => key !== "type" && key !== "publicKeySpki") || typeof publicKeySpki !== "string" || publicKeySpki.length === 0 || publicKeySpki.length > 4_096) {
    return undefined;
  }
  return {
    threadId,
    label,
    source: { type, publicKeySpki },
  };
}

export function parseRevokeReceiptTrustAnchorRequest(input: unknown): RevokeReceiptTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && typeof threadId === "string" && /^thread_[a-z0-9]{8,80}$/.test(threadId) ? { threadId } : undefined;
}

export function parseSignTrustedReceiptRequest(input: unknown, requireThreadId: boolean): SignTrustedReceiptRequest | undefined {
  const record = requestRecord(input, requireThreadId ? ["trustAnchorId", "threadId"] : ["trustAnchorId"]);
  const trustAnchorId = record?.["trustAnchorId"];
  const threadId = record?.["threadId"];
  if (!record || typeof trustAnchorId !== "string" || !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || (requireThreadId && (typeof threadId !== "string" || !/^thread_[a-z0-9]{8,80}$/.test(threadId)))) {
    return undefined;
  }
  return {
    trustAnchorId,
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseSignReceiptTrustAnchorDirectoryMetadataRequest(input: unknown): SignReceiptTrustAnchorDirectoryMetadataRequest | undefined {
  const record = requestRecord(input, ["trustAnchorId", "threadId", "publisher", "sourceUrlSha256", "sourceOriginSha256", "expiresAt"]);
  const trustAnchorId = record?.["trustAnchorId"];
  const threadId = record?.["threadId"];
  const publisher = record?.["publisher"];
  const sourceUrlSha256 = record?.["sourceUrlSha256"];
  const sourceOriginSha256 = record?.["sourceOriginSha256"];
  const expiresAt = record?.["expiresAt"];
  const normalizedPublisher = typeof publisher === "string" ? publisher.replace(/\s+/g, " ").trim() : undefined;
  if (!record || typeof trustAnchorId !== "string" || !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || !validThreadId(threadId) || !normalizedPublisher || normalizedPublisher.length > 120 || /[\u0000-\u001f\u007f<>]/.test(normalizedPublisher) || (sourceUrlSha256 === undefined) !== (sourceOriginSha256 === undefined) || (sourceUrlSha256 !== undefined && !isSha256Hex(sourceUrlSha256)) || (sourceOriginSha256 !== undefined && !isSha256Hex(sourceOriginSha256)) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    trustAnchorId,
    threadId,
    publisher: normalizedPublisher,
    ...(typeof sourceUrlSha256 === "string" ? { sourceUrlSha256 } : {}),
    ...(typeof sourceOriginSha256 === "string" ? { sourceOriginSha256 } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parsePromoteEvaluationQualificationBaselineRequest(input: unknown): PromoteEvaluationQualificationBaselineRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  return record && typeof threadId === "string" && /^thread_[a-z0-9]{8,80}$/.test(threadId) && typeof trustAnchorId === "string" && /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ? { threadId, trustAnchorId } : undefined;
}

export function parseVerifyTrustedReceiptRequest(input: unknown): VerifyTrustedReceiptRequest | undefined {
  const record = requestRecord(input, ["envelope", "directory", "directoryPolicy"]);
  const directoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["directoryPolicy"]);
  if (!record || record["envelope"] === undefined || (record["directoryPolicy"] !== undefined && record["directory"] === undefined) || (record["directoryPolicy"] !== undefined && !directoryPolicy)) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(record["directory"] !== undefined ? { directory: record["directory"] } : {}),
    ...(directoryPolicy ? { directoryPolicy } : {}),
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryMetadataRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryMetadataRequest | undefined {
  const record = requestRecord(input, ["envelope", "directory", "directoryPolicy", "trustDirectory", "trustDirectoryPolicy"]);
  const directoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["directoryPolicy"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || record["envelope"] === undefined || record["directory"] === undefined || (record["directoryPolicy"] !== undefined && !directoryPolicy) || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    directory: record["directory"],
    ...(directoryPolicy ? { directoryPolicy } : {}),
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest | undefined {
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

export function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return {
    history: record["history"],
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest | undefined {
  const record = requestRecord(input, ["checkpoint"]);
  if (!record || record["checkpoint"] === undefined) return undefined;
  return {
    checkpoint: record["checkpoint"],
  };
}

export function parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input: unknown): DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest | undefined {
  const record = requestRecord(input, ["sourceUrl", "policy", "trustDirectory", "trustDirectoryPolicy"]);
  const policy = parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(record?.["policy"]);
  const trustDirectoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(record?.["trustDirectoryPolicy"]);
  if (!record || typeof record["sourceUrl"] !== "string" || record["sourceUrl"].length === 0 || record["sourceUrl"].length > 2_048 || (record["policy"] !== undefined && !policy) || (record["trustDirectoryPolicy"] !== undefined && record["trustDirectory"] === undefined) || (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)) {
    return undefined;
  }
  return {
    sourceUrl: record["sourceUrl"],
    ...(policy ? { policy } : {}),
    ...(record["trustDirectory"] !== undefined ? { trustDirectory: record["trustDirectory"] } : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

export function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input: unknown): SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^trustkey_[a-f0-9]{20}$/.test(trustAnchorId)) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
  };
}

export function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(input: unknown): ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest | undefined {
  const record = requestRecord(input, ["threadId", "activationDecisionRecordId", "expectedCurrentSelectionSha256", "rotationProposalEnvelope"]);
  const threadId = record?.["threadId"];
  const activationDecisionRecordId = record?.["activationDecisionRecordId"];
  const expectedCurrentSelectionSha256 = record?.["expectedCurrentSelectionSha256"];
  if (!record || !validThreadId(threadId) || typeof activationDecisionRecordId !== "string" || !/^trustqad_[a-z0-9]{8,80}$/.test(activationDecisionRecordId) || typeof expectedCurrentSelectionSha256 !== "string" || (expectedCurrentSelectionSha256 !== "" && !isSha256Hex(expectedCurrentSelectionSha256))) {
    return undefined;
  }
  return {
    threadId,
    activationDecisionRecordId,
    expectedCurrentSelectionSha256,
    ...(record["rotationProposalEnvelope"] !== undefined
      ? {
          rotationProposalEnvelope: record["rotationProposalEnvelope"] as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>,
        }
      : {}),
  };
}

export function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(input: unknown): ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedSubscriptionRevision", "expectedSubscriptionSha256", "approvalEnvelope"]);
  const threadId = record?.["threadId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  if (!record || !validThreadId(threadId) || !isNonNegativeInteger(expectedSubscriptionRevision) || expectedSubscriptionRevision < 1 || typeof expectedSubscriptionSha256 !== "string" || !isSha256Hex(expectedSubscriptionSha256) || record["approvalEnvelope"] === undefined) {
    return undefined;
  }
  return {
    threadId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    approvalEnvelope: record["approvalEnvelope"] as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>,
  };
}

export function parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(input: unknown): ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedSubscriptionRevision", "expectedSubscriptionSha256", "approvalEnvelopes", "approvalPolicy"]);
  const threadId = record?.["threadId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  const approvalEnvelopes = record?.["approvalEnvelopes"];
  const approvalPolicyRecord = requestRecord(record?.["approvalPolicy"], ["minimumDistinctSignerCount", "requiredSignerKeyIds"]);
  const minimumDistinctSignerCount = approvalPolicyRecord?.["minimumDistinctSignerCount"];
  const requiredSignerKeyIds = approvalPolicyRecord?.["requiredSignerKeyIds"];
  if (!record || !validThreadId(threadId) || !isNonNegativeInteger(expectedSubscriptionRevision) || expectedSubscriptionRevision < 1 || typeof expectedSubscriptionSha256 !== "string" || !isSha256Hex(expectedSubscriptionSha256) || !Array.isArray(approvalEnvelopes) || approvalEnvelopes.length < 1 || approvalEnvelopes.length > 10 || !approvalPolicyRecord || !isNonNegativeInteger(minimumDistinctSignerCount) || minimumDistinctSignerCount < 1 || minimumDistinctSignerCount > 10 || (requiredSignerKeyIds !== undefined && (!Array.isArray(requiredSignerKeyIds) || requiredSignerKeyIds.length > 10 || !requiredSignerKeyIds.every(isSha256Hex)))) {
    return undefined;
  }
  const uniqueRequiredSignerKeyIds = requiredSignerKeyIds === undefined ? [] : Array.from(new Set(requiredSignerKeyIds as string[])).sort();
  return {
    threadId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    approvalEnvelopes: approvalEnvelopes as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>[],
    approvalPolicy: {
      minimumDistinctSignerCount,
      ...(uniqueRequiredSignerKeyIds.length > 0 ? { requiredSignerKeyIds: uniqueRequiredSignerKeyIds } : {}),
    },
  };
}

export function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(input: unknown): ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest | undefined {
  return parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(input);
}

export function parseQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest(input: unknown): QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedSubscriptionRevision", "expectedSubscriptionSha256", "approvalEnvelopes", "approvalPolicy", "approvalPolicyBaselineSha256", "applyAfter"]);
  const reviewRequest = parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
    record
      ? {
          threadId: record["threadId"],
          expectedSubscriptionRevision: record["expectedSubscriptionRevision"],
          expectedSubscriptionSha256: record["expectedSubscriptionSha256"],
          approvalEnvelopes: record["approvalEnvelopes"],
          approvalPolicy: record["approvalPolicy"],
        }
      : undefined,
  );
  const approvalPolicyBaselineSha256 = record?.["approvalPolicyBaselineSha256"];
  const applyAfter = record?.["applyAfter"];
  if (!reviewRequest || typeof approvalPolicyBaselineSha256 !== "string" || !/^[a-f0-9]{64}$/.test(approvalPolicyBaselineSha256) || (applyAfter !== undefined && (typeof applyAfter !== "string" || !Number.isFinite(Date.parse(applyAfter))))) {
    return undefined;
  }
  return {
    ...reviewRequest,
    approvalPolicyBaselineSha256,
    ...(typeof applyAfter === "string" ? { applyAfter } : {}),
  };
}

export function parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input: unknown): PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "expectedSubscriptionRevision", "expectedSubscriptionSha256", "approvalEnvelopes", "approvalPolicy"]);
  const reviewRequest = parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
    record
      ? {
          threadId: record["threadId"],
          expectedSubscriptionRevision: record["expectedSubscriptionRevision"],
          expectedSubscriptionSha256: record["expectedSubscriptionSha256"],
          approvalEnvelopes: record["approvalEnvelopes"],
          approvalPolicy: record["approvalPolicy"],
        }
      : undefined,
  );
  const trustAnchorId = record?.["trustAnchorId"];
  if (!reviewRequest || typeof trustAnchorId !== "string" || !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)) {
    return undefined;
  }
  return {
    ...reviewRequest,
    trustAnchorId,
  };
}

export function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input: unknown): VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest | undefined {
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

export function parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input: unknown): ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest | undefined {
  const record = requestRecord(input, ["baseline", "threadId", "expectedCurrentBaselineSha256", "trustDirectory", "trustDirectoryPolicy"]);
  const verifyRequest = record
    ? parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest({
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
