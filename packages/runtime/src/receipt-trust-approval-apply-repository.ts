import {
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  type TrustedReceiptEnvelope,
} from "@napier/contracts";
import {
  normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim,
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import { validateTrustedReceiptEnvelope } from "./receipt-trust-envelopes.js";
import { normalizeLeaseOwner } from "./run-lease-renewal.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";
import {
  assertApprovalApplyLeaseToken as assertLeaseToken,
  createApprovalApplyLeaseToken as createLeaseToken,
  isApprovalApplySha256 as isSha256,
  validateApprovalApplyLeaseTtl as validateLeaseTtl,
  type DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims,
  type DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims,
} from "./receipt-trust-approval-apply-claims.js";

export type {
  DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims,
  DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims,
} from "./receipt-trust-approval-apply-claims.js";

export class ReceiptTrustApprovalApplyRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    expectedSubscriptionSha256: string,
    approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>,
    applyAfter = new Date().toISOString(),
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return this.host.stateQueue.run(async () => {
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply audit thread changed",
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply revision changed",
        );
      }
      if (subscription.contentSha256 !== expectedSubscriptionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply precondition failed",
        );
      }
      if (!Number.isFinite(Date.parse(applyAfter))) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply time is invalid",
        );
      }
      if (subscription.pendingApprovalPolicyApply?.status === "pending") {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal policy approval apply is already pending",
        );
      }
      const envelope = validateTrustedReceiptEnvelope(
        approvalEnvelope,
      ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
      if (
        envelope.receiptKind !==
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval receipt kind is invalid",
        );
      }
      subscription.pendingApprovalApply = {
        status: "pending",
        queuedAt: new Date().toISOString(),
        applyAfter,
        approvalEnvelope: envelope,
        approvalEnvelopeSha256: envelope.contentSha256,
        approvalSha256: envelope.receipt.contentSha256,
      };
      await this.host.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApply(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    expectedSubscriptionSha256: string,
    approvalEnvelopes: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>[],
    approvalPolicyInput: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
    approvalPolicyBaselineSha256: string,
    applyAfter = new Date().toISOString(),
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    if (!isSha256(approvalPolicyBaselineSha256)) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline hash is invalid",
      );
    }
    const approvalPolicy =
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy(
        approvalPolicyInput,
      );
    const approvalPolicySha256 = sha256(canonicalJson(approvalPolicy));
    if (!Number.isFinite(Date.parse(applyAfter))) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply time is invalid",
      );
    }
    return this.host.stateQueue.run(async () => {
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply audit thread changed",
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply revision changed",
        );
      }
      if (subscription.contentSha256 !== expectedSubscriptionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply precondition failed",
        );
      }
      if (subscription.pendingApprovalApply?.status === "pending") {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply is already pending",
        );
      }
      const approvalPolicyBaseline =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (candidate) =>
            candidate.contentSha256 === approvalPolicyBaselineSha256,
        );
      if (!approvalPolicyBaseline) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline not found",
        );
      }
      if (
        approvalPolicyBaseline.approvalPolicySha256 !== approvalPolicySha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline mismatch",
        );
      }
      if (
        !Array.isArray(approvalEnvelopes) ||
        approvalEnvelopes.length === 0 ||
        approvalEnvelopes.length > 20
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply envelopes are invalid",
        );
      }
      const envelopes = approvalEnvelopes
        .map((approvalEnvelope) => {
          const envelope = validateTrustedReceiptEnvelope(
            approvalEnvelope,
          ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
          if (
            envelope.receiptKind !==
            "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
          ) {
            throw new Error(
              "Receipt trust anchor directory quorum activation selection rotation proposal approval receipt kind is invalid",
            );
          }
          return envelope;
        })
        .sort((left, right) =>
          left.contentSha256.localeCompare(right.contentSha256),
        );
      subscription.pendingApprovalPolicyApply = {
        status: "pending",
        queuedAt: new Date().toISOString(),
        applyAfter,
        approvalEnvelopes: envelopes,
        approvalEnvelopeSha256s: envelopes.map(
          (envelope) => envelope.contentSha256,
        ),
        approvalPolicy,
        approvalPolicySha256,
        approvalPolicyBaselineSha256,
      };
      await this.host.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.host.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim[] =
        [];
      const due =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .filter((subscription) => {
            const pending = subscription.pendingApprovalApply;
            return (
              subscription.status === "active" &&
              pending?.status === "pending" &&
              Date.parse(pending.applyAfter) <= now.getTime()
            );
          })
          .sort((left, right) =>
            (left.pendingApprovalApply?.applyAfter ?? "").localeCompare(
              right.pendingApprovalApply?.applyAfter ?? "",
            ),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        const pending = subscription.pendingApprovalApply;
        if (!pending) continue;
        if (
          pending.claim &&
          Date.parse(pending.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        pending.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        pending.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          approvalEnvelope: pending.approvalEnvelope,
          token,
        });
      }
      if (claims.length > 0) await this.host.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription?.pendingApprovalApply) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim is not active",
        );
      }
      const pending = subscription.pendingApprovalApply;
      assertLeaseToken(pending.claimTokenSha256, token);
      if (!pending.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim is not active",
        );
      }
      if (Date.parse(pending.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim expired",
        );
      }
      if (
        "resultSha256" in outcome &&
        !/^[a-f0-9]{64}$/.test(outcome.resultSha256)
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply result hash is invalid",
        );
      }
      if (
        "failureSha256" in outcome &&
        !/^[a-f0-9]{64}$/.test(outcome.failureSha256)
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply failure hash is invalid",
        );
      }
      subscription.pendingApprovalApply = {
        ...pending,
        status: "resultSha256" in outcome ? "applied" : "failed",
        settledAt: new Date().toISOString(),
        ...("resultSha256" in outcome
          ? { resultSha256: outcome.resultSha256 }
          : { failureSha256: outcome.failureSha256 }),
      };
      delete subscription.pendingApprovalApply.claim;
      delete subscription.pendingApprovalApply.claimTokenSha256;
      await this.host.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.host.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim[] =
        [];
      const due =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .filter((subscription) => {
            const pending = subscription.pendingApprovalPolicyApply;
            return (
              subscription.status === "active" &&
              pending?.status === "pending" &&
              Date.parse(pending.applyAfter) <= now.getTime()
            );
          })
          .sort((left, right) =>
            (left.pendingApprovalPolicyApply?.applyAfter ?? "").localeCompare(
              right.pendingApprovalPolicyApply?.applyAfter ?? "",
            ),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        const pending = subscription.pendingApprovalPolicyApply;
        if (!pending) continue;
        if (
          pending.claim &&
          Date.parse(pending.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        pending.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        pending.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          approvalEnvelopes: pending.approvalEnvelopes,
          approvalPolicy: pending.approvalPolicy,
          approvalPolicyBaselineSha256: pending.approvalPolicyBaselineSha256,
          token,
        });
      }
      if (claims.length > 0) await this.host.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription?.pendingApprovalPolicyApply) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim is not active",
        );
      }
      const pending = subscription.pendingApprovalPolicyApply;
      assertLeaseToken(pending.claimTokenSha256, token);
      if (!pending.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim is not active",
        );
      }
      if (Date.parse(pending.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim expired",
        );
      }
      if ("resultSha256" in outcome && !isSha256(outcome.resultSha256)) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply result hash is invalid",
        );
      }
      if ("failureSha256" in outcome && !isSha256(outcome.failureSha256)) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply failure hash is invalid",
        );
      }
      subscription.pendingApprovalPolicyApply = {
        ...pending,
        status: "resultSha256" in outcome ? "applied" : "failed",
        settledAt: new Date().toISOString(),
        ...("resultSha256" in outcome
          ? { resultSha256: outcome.resultSha256 }
          : { failureSha256: outcome.failureSha256 }),
      };
      delete subscription.pendingApprovalPolicyApply.claim;
      delete subscription.pendingApprovalPolicyApply.claimTokenSha256;
      await this.host.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }
}
