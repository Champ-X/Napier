import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim,
} from "./receipt-trust-directory-subscriptions.js";
export {
  assertRepositoryLeaseToken as assertApprovalApplyLeaseToken,
  createRepositoryLeaseToken as createApprovalApplyLeaseToken,
  validateRepositoryLeaseTtl as validateApprovalApplyLeaseTtl,
} from "./repository-lease.js";

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim[];
}

export function isApprovalApplySha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
