import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim,
} from "./receipt-trust-directory-subscriptions.js";
import { storeSha256 as sha256 } from "./store-hashing.js";

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim[];
}

export function createApprovalApplyLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

export function assertApprovalApplyLeaseToken(
  expectedSha256: string | undefined,
  token: string | undefined,
): void {
  if (!expectedSha256 || !token) throw new Error("Lease token is required");
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Lease token is invalid");
  }
}

export function validateApprovalApplyLeaseTtl(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 10 * 60_000) {
    throw new Error("Lease TTL must be an integer from 5000 to 600000 ms");
  }
  return value;
}

export function isApprovalApplySha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
