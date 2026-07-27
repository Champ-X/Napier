import { createHash } from "node:crypto";

import type {
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  JsonValue,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  TrustedReceiptEnvelope,
} from "@napier/contracts";
import {
  canonicalJson,
  createId,
  hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
  LocalStore,
  normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
  receiptTrustAnchorsFromDirectory,
  sha256,
  validateTrustedReceiptEnvelope,
  verifyTrustedReceiptEnvelope,
} from "@napier/runtime";

import {
  ReceiptTrustAnchorDirectoryDiscoveryError,
  ReceiptTrustAnchorDirectoryDiscoveryService,
  type ReceiptTrustAnchorDirectoryHostedJsonSource,
} from "./receipt-trust-directory-discovery.js";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate,
} from "./receipt-trust-rotation-proposals.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_CLAIM_LEASE_MS = 30_000;

export interface ReceiptTrustAnchorDirectorySubscriptionServiceOptions {
  pollIntervalMs?: number;
  claimLeaseMs?: number;
  workerId?: string;
}

export class ReceiptTrustAnchorDirectorySubscriptionService {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly claimLeaseMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly store: LocalStore,
    private readonly discovery: ReceiptTrustAnchorDirectoryDiscoveryService,
    options: ReceiptTrustAnchorDirectorySubscriptionServiceOptions = {},
  ) {
    this.workerId = options.workerId ?? createId("trustrefresh");
    this.pollIntervalMs = normalizePositiveInteger(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "poll interval",
    );
    this.claimLeaseMs = normalizePositiveInteger(
      options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS,
      "claim lease",
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleTick(), this.pollIntervalMs);
    this.timer.unref();
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeTick;
  }

  async refresh(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    this.store.getThread(threadId);
    const subscription =
      this.store.getReceiptTrustAnchorDirectorySubscription(subscriptionId);
    if (subscription.auditThreadId !== threadId) {
      throw new Error(
        "Receipt trust anchor directory subscription audit thread changed",
      );
    }
    const claim = await this.store.claimReceiptTrustAnchorDirectorySubscription(
      subscriptionId,
      expectedRevision,
      this.workerId,
      { leaseMs: this.claimLeaseMs },
    );
    return this.refreshClaim(claim);
  }

  async refreshDue(now = new Date()): Promise<number> {
    const { claims: directoryClaims } =
      await this.store.claimDueReceiptTrustAnchorDirectorySubscriptions(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    const { claims: checkpointClaims } =
      await this.store.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    const { claims: rotationProposalClaims } =
      await this.store.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    const { claims: approvalApplyClaims } =
      await this.store.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    const { claims: approvalPolicyApplyClaims } =
      await this.store.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    await Promise.all([
      ...directoryClaims.map((claim) => this.refreshClaim(claim)),
      ...checkpointClaims.map((claim) => this.refreshCheckpointClaim(claim)),
      ...rotationProposalClaims.map((claim) =>
        this.refreshRotationProposalClaim(claim),
      ),
      ...approvalApplyClaims.map((claim) =>
        this.applyRotationProposalApprovalClaim(claim),
      ),
      ...approvalPolicyApplyClaims.map((claim) =>
        this.applyRotationProposalApprovalPolicyClaim(claim),
      ),
    ]);
    return (
      directoryClaims.length +
      checkpointClaims.length +
      rotationProposalClaims.length +
      approvalApplyClaims.length +
      approvalPolicyApplyClaims.length
    );
  }

  private scheduleTick(): void {
    if (this.activeTick) return;
    this.activeTick = this.refreshDue()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.activeTick = undefined;
      });
  }

  private async refreshClaim(
    claim: Awaited<
      ReturnType<LocalStore["claimReceiptTrustAnchorDirectorySubscription"]>
    >,
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    let result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    try {
      const discovery = await this.discovery.discover({
        sourceUrl: claim.sourceUrl,
        policy: claim.subscription.policy,
      });
      result =
        await this.store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { discovery },
        );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      result =
        await this.store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { failureSha256 },
        );
    }
    await this.appendRefreshEvent(result);
    return result;
  }

  async refreshCheckpoint(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult> {
    this.store.getThread(threadId);
    const subscription =
      this.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        subscriptionId,
      );
    if (subscription.auditThreadId !== threadId) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint subscription audit thread changed",
      );
    }
    const claim =
      await this.store.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        subscriptionId,
        expectedRevision,
        this.workerId,
        { leaseMs: this.claimLeaseMs },
      );
    return this.refreshCheckpointClaim(claim);
  }

  private async refreshCheckpointClaim(
    claim: Awaited<
      ReturnType<
        LocalStore["claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription"]
      >
    >,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult> {
    let result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult;
    try {
      const source = await this.discovery.fetchJson(claim.sourceUrl);
      const discovery =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
          this.store,
          source,
          {
            sourceUrl: claim.sourceUrl,
            policy: claim.subscription.policy,
          },
        );
      result =
        await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { discovery },
        );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      result =
        await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { failureSha256 },
        );
    }
    await this.appendCheckpointRefreshEvent(result);
    return result;
  }

  async refreshRotationProposal(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
    this.store.getThread(threadId);
    const subscription =
      this.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
        subscriptionId,
      );
    if (subscription.auditThreadId !== threadId) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription audit thread changed",
      );
    }
    const claim =
      await this.store.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
        subscriptionId,
        expectedRevision,
        this.workerId,
        { leaseMs: this.claimLeaseMs },
      );
    return this.refreshRotationProposalClaim(claim);
  }

  private async refreshRotationProposalClaim(
    claim: Awaited<
      ReturnType<
        LocalStore["claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription"]
      >
    >,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
    let result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult;
    try {
      const source = await this.discovery.fetchJson(claim.sourceUrl);
      const discovery =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
          this.store,
          {
            threadId: claim.subscription.auditThreadId,
            sourceUrl: claim.sourceUrl,
            policy: claim.subscription.policy,
          },
          source,
        );
      result =
        await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { discovery },
        );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      result =
        await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { failureSha256 },
        );
    }
    await this.appendRotationProposalRefreshEvent(result);
    return result;
  }

  private async applyRotationProposalApprovalClaim(
    claim: Awaited<
      ReturnType<
        LocalStore["claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies"]
      >
    >["claims"][number],
  ): Promise<void> {
    let result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult;
    try {
      const subscription =
        this.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          claim.subscription.id,
        );
      const approvalGate =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate(
          this.store,
          subscription,
          {
            threadId: subscription.auditThreadId,
            expectedSubscriptionRevision: subscription.revision,
            expectedSubscriptionSha256: subscription.contentSha256,
            approvalEnvelope: claim.approvalEnvelope,
          },
        );
      if (approvalGate.status === "rejected") {
        throw new Error(approvalGate.reason);
      }
      result =
        await this.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
          subscription.auditThreadId,
          approvalGate.proposal.activationDecisionRecordId,
          approvalGate.proposal.expectedCurrentSelectionSha256,
        );
      await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
        subscription.id,
        claim.token,
        { resultSha256: result.contentSha256 },
      );
      await this.appendRotationProposalApprovalApplyEvent(
        result,
        approvalGate.approvalEnvelope.contentSha256,
        approvalGate.approval.contentSha256,
        approvalGate.proposal.contentSha256,
        approvalGate.preflight.contentSha256,
        subscription,
      );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
        claim.subscription.id,
        claim.token,
        { failureSha256 },
      );
      await this.appendRotationProposalApprovalApplyFailureEvent(
        claim.subscription,
        claim.approvalEnvelope.contentSha256,
        claim.approvalEnvelope.receipt.contentSha256,
        failureSha256,
      );
    }
  }

  private async applyRotationProposalApprovalPolicyClaim(
    claim: Awaited<
      ReturnType<
        LocalStore["claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies"]
      >
    >["claims"][number],
  ): Promise<void> {
    try {
      const subscription =
        this.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          claim.subscription.id,
        );
      const policyReview =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
          this.store,
          subscription,
          {
            threadId: subscription.auditThreadId,
            expectedSubscriptionRevision: subscription.revision,
            expectedSubscriptionSha256: subscription.contentSha256,
            approvalEnvelopes: claim.approvalEnvelopes,
            approvalPolicy: claim.approvalPolicy,
          },
        );
      if (
        policyReview.review.status !== "accepted" ||
        policyReview.acceptedGates.length === 0
      ) {
        throw new Error(
          `approval policy review rejected: ${policyReview.review.diagnostics.join(",")}`,
        );
      }
      const baselineGate =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate(
          this.store,
          policyReview.review,
          claim.approvalPolicyBaselineSha256,
        );
      if (baselineGate.status === "rejected") {
        throw new Error(
          `approval policy baseline rejected: ${baselineGate.diagnostics.join(",")}`,
        );
      }
      const approvalGate = policyReview.acceptedGates[0]!;
      const result =
        await this.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
          subscription.auditThreadId,
          approvalGate.proposal.activationDecisionRecordId,
          approvalGate.proposal.expectedCurrentSelectionSha256,
        );
      const applyResult =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult(
          policyReview.review,
          result,
        );
      await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
        subscription.id,
        claim.token,
        { resultSha256: applyResult.contentSha256 },
      );
      await this.appendRotationProposalApprovalPolicyApplyEvent(
        result,
        applyResult.contentSha256,
        policyReview.review.contentSha256,
        claim.approvalPolicyBaselineSha256,
        subscription,
      );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      await this.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
        claim.subscription.id,
        claim.token,
        { failureSha256 },
      );
      await this.appendRotationProposalApprovalPolicyApplyFailureEvent(
        claim.subscription,
        claim.approvalPolicyBaselineSha256,
        sha256(
          canonicalJson(
            claim.approvalEnvelopes
              .map((envelope) => envelope.contentSha256)
              .sort(),
          ),
        ),
        sha256(canonicalJson(claim.approvalPolicy)),
        failureSha256,
      );
    }
  }

  private async appendRefreshEvent(
    result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ): Promise<void> {
    const subscription = result.subscription;
    const payload: Record<string, JsonValue> = {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      refreshStatus: result.status,
      refreshResultSha256: result.contentSha256,
      transparencyEntryCount: subscription.transparencyEntryCount,
      transparencyTailSha256: subscription.transparencyTailSha256 ?? "",
      activeDirectorySha256:
        subscription.lastGoodDiscovery?.directory?.contentSha256 ?? "",
      activeAnchorSetSha256:
        subscription.lastGoodDiscovery?.directory?.anchorSetSha256 ?? "",
      ...(result.discovery
        ? { discoverySha256: result.discovery.contentSha256 }
        : {}),
      ...(result.failureSha256 ? { failureSha256: result.failureSha256 } : {}),
    };
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_directory_subscription.refreshed",
      category: "evaluation",
      visibility: "user",
      payload,
    });
  }

  private async appendCheckpointRefreshEvent(
    result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  ): Promise<void> {
    const subscription = result.subscription;
    const payload: Record<string, JsonValue> = {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      refreshStatus: result.status,
      refreshResultSha256: result.contentSha256,
      transparencyEntryCount: subscription.transparencyEntryCount,
      transparencyTailSha256: subscription.transparencyTailSha256 ?? "",
      activeEnvelopeSha256:
        subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
      activeCheckpointSha256:
        subscription.lastGoodDiscovery?.checkpointSha256 ?? "",
      activeSelectionCount: subscription.lastGoodDiscovery?.selectionCount ?? 0,
      activeSelectionChainTailSha256:
        subscription.lastGoodDiscovery?.selectionChainTailSha256 ?? "",
      ...(result.discovery
        ? { discoverySha256: result.discovery.contentSha256 }
        : {}),
      ...(result.failureSha256 ? { failureSha256: result.failureSha256 } : {}),
    };
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_checkpoint_subscription.refreshed",
      category: "evaluation",
      visibility: "user",
      payload,
    });
  }

  private async appendRotationProposalRefreshEvent(
    result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  ): Promise<void> {
    const subscription = result.subscription;
    const payload: Record<string, JsonValue> = {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      refreshStatus: result.status,
      refreshResultSha256: result.contentSha256,
      transparencyEntryCount: subscription.transparencyEntryCount,
      transparencyTailSha256: subscription.transparencyTailSha256 ?? "",
      activeEnvelopeSha256:
        subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
      activeProposalSha256:
        subscription.lastGoodDiscovery?.proposalSha256 ?? "",
      activePreflightSha256:
        subscription.lastGoodDiscovery?.preflight?.contentSha256 ?? "",
      ...(result.discovery
        ? { discoverySha256: result.discovery.contentSha256 }
        : {}),
      ...(result.failureSha256 ? { failureSha256: result.failureSha256 } : {}),
    };
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_rotation_proposal_subscription.refreshed",
      category: "evaluation",
      visibility: "user",
      payload,
    });
  }

  private async appendRotationProposalApprovalApplyEvent(
    result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
    approvalEnvelopeSha256: string,
    approvalSha256: string,
    proposalSha256: string,
    preflightSha256: string,
    subscription: ReturnType<
      LocalStore["getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription"]
    >,
  ): Promise<void> {
    const payload: Record<string, JsonValue> = {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      approvalEnvelopeSha256,
      approvalSha256,
      proposalSha256,
      preflightSha256,
      resultSha256: result.contentSha256,
      applied: result.applied,
      selectionSha256: result.selection.contentSha256,
      selectionStateSha256: result.selectionState.contentSha256,
      activationDecisionRecordId: result.selection.activationDecisionRecordId,
      ...(result.previousSelectionSha256
        ? { previousSelectionSha256: result.previousSelectionSha256 }
        : {}),
    };
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_rotation_proposal_approval_apply.applied",
      category: "evaluation",
      visibility: "user",
      payload,
    });
  }

  private async appendRotationProposalApprovalApplyFailureEvent(
    subscription: ReturnType<
      LocalStore["getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription"]
    >,
    approvalEnvelopeSha256: string,
    approvalSha256: string,
    failureSha256: string,
  ): Promise<void> {
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_rotation_proposal_approval_apply.failed",
      category: "evaluation",
      visibility: "user",
      payload: {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        approvalEnvelopeSha256,
        approvalSha256,
        failureSha256,
      },
    });
  }

  private async appendRotationProposalApprovalPolicyApplyEvent(
    result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
    applyResultSha256: string,
    policyReviewSha256: string,
    approvalPolicyBaselineSha256: string,
    subscription: ReturnType<
      LocalStore["getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription"]
    >,
  ): Promise<void> {
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_rotation_proposal_approval_policy_apply.applied",
      category: "evaluation",
      visibility: "user",
      payload: {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        policyReviewSha256,
        approvalPolicyBaselineSha256,
        resultSha256: result.contentSha256,
        applyResultSha256,
        applied: result.applied,
        selectionSha256: result.selection.contentSha256,
        selectionStateSha256: result.selectionState.contentSha256,
        activationDecisionRecordId: result.selection.activationDecisionRecordId,
        ...(result.previousSelectionSha256
          ? { previousSelectionSha256: result.previousSelectionSha256 }
          : {}),
      },
    });
  }

  private async appendRotationProposalApprovalPolicyApplyFailureEvent(
    subscription: ReturnType<
      LocalStore["getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription"]
    >,
    approvalPolicyBaselineSha256: string,
    approvalEnvelopeSetSha256: string,
    approvalPolicySha256: string,
    failureSha256: string,
  ): Promise<void> {
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_rotation_proposal_approval_policy_apply.failed",
      category: "evaluation",
      visibility: "user",
      payload: {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        approvalPolicyBaselineSha256,
        approvalEnvelopeSetSha256,
        approvalPolicySha256,
        failureSha256,
      },
    });
  }
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
  store: LocalStore,
  source: ReceiptTrustAnchorDirectoryHostedJsonSource,
  request: DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery {
  const generatedAt = new Date().toISOString();
  const policy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      request.policy,
    );
  const currentCheckpoint =
    store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
  const activeSelectionState =
    request.trustDirectory === undefined
      ? store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState()
      : undefined;
  const activeSelection = activeSelectionState?.selection;
  const selectedDirectory =
    request.trustDirectory !== undefined
      ? request.trustDirectory
      : activeSelection?.selectedDirectory;
  const trustDirectoryVerification =
    selectedDirectory === undefined
      ? undefined
      : store.verifyReceiptTrustAnchorDirectory(
          selectedDirectory,
          request.trustDirectoryPolicy,
        );
  const anchors =
    selectedDirectory === undefined
      ? store.listReceiptTrustAnchors()
      : trustDirectoryVerification?.status === "valid"
        ? receiptTrustAnchorsFromDirectory(
            selectedDirectory as ReceiptTrustAnchorDirectory,
          )
        : [];
  const trustedReceiptVerification = verifyTrustedReceiptEnvelope(
    source.value,
    anchors,
  );
  let envelope:
    | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>
    | undefined;
  try {
    const parsed = validateTrustedReceiptEnvelope(source.value);
    if (
      parsed.receiptKind ===
      "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint"
    ) {
      envelope =
        parsed as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>;
    }
  } catch {
    envelope = undefined;
  }
  const checkpointVerification =
    store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      envelope?.receipt ?? source.value,
    );
  const diagnostics: string[] = [];
  if (trustedReceiptVerification.status !== "trusted") {
    diagnostics.push("checkpoint_receipt_untrusted");
  }
  if (!envelope) diagnostics.push("checkpoint_receipt_kind_mismatch");
  if (checkpointVerification.status === "invalid") {
    diagnostics.push("checkpoint_invalid");
  } else if (checkpointVerification.status === "divergent") {
    diagnostics.push("checkpoint_divergent");
  }
  const checkpoint = envelope?.receipt;
  const signedAtMs = envelope ? Date.parse(envelope.signature.signedAt) : NaN;
  if (
    envelope &&
    policy.maxEnvelopeAgeMs > 0 &&
    Number.isFinite(signedAtMs) &&
    Date.parse(generatedAt) - signedAtMs > policy.maxEnvelopeAgeMs
  ) {
    diagnostics.push("checkpoint_signature_stale");
  }
  if (
    policy.requiredSignerKeyIds.length > 0 &&
    (!envelope ||
      !policy.requiredSignerKeyIds.includes(envelope.signature.keyId))
  ) {
    diagnostics.push("required_signer_missing");
  }
  if (
    policy.expectedCheckpointSha256 &&
    checkpoint?.contentSha256 !== policy.expectedCheckpointSha256
  ) {
    diagnostics.push("checkpoint_hash_mismatch");
  }
  if (
    policy.expectedSelectionSetSha256 &&
    checkpoint?.selectionSetSha256 !== policy.expectedSelectionSetSha256
  ) {
    diagnostics.push("selection_set_mismatch");
  }
  if (
    policy.expectedSelectionChainTailSha256 &&
    checkpoint?.selectionChainTailSha256 !==
      policy.expectedSelectionChainTailSha256
  ) {
    diagnostics.push("selection_chain_tail_mismatch");
  }
  if (checkpoint && checkpoint.selectionCount < policy.minimumSelectionCount) {
    diagnostics.push("selection_count_below_minimum");
  }
  if (
    policy.rejectRollback &&
    checkpoint &&
    checkpoint.selectionCount < currentCheckpoint.selectionCount
  ) {
    diagnostics.push("selection_count_rollback");
  }
  if (
    policy.rejectRollback &&
    checkpoint &&
    checkpoint.selectionCount === currentCheckpoint.selectionCount &&
    checkpoint.selectionChainTailSha256 !==
      currentCheckpoint.selectionChainTailSha256
  ) {
    diagnostics.push("selection_chain_tail_rollback");
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-discovery" as const,
    schemaVersion: 1 as const,
    apiVersion: "2026-07-25",
    generatedAt,
    status:
      diagnostics.length === 0 ? ("valid" as const) : ("invalid" as const),
    diagnostics,
    sourceUrlSha256: source.sourceUrlSha256,
    sourceOriginSha256: source.sourceOriginSha256,
    httpStatus: source.httpStatus,
    responseMediaType: source.responseMediaType,
    responseBytes: source.responseBytes,
    responseBodySha256: source.responseBodySha256,
    policy,
    policySha256:
      hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
        policy,
      ),
    trustedReceiptVerification,
    checkpointVerification,
    ...(envelope
      ? {
          envelopeSha256: envelope.contentSha256,
          checkpointSha256: envelope.receipt.contentSha256,
          signerKeyId: envelope.signature.keyId,
          signedAt: envelope.signature.signedAt,
          selectionCount: envelope.receipt.selectionCount,
          selectionSetSha256: envelope.receipt.selectionSetSha256,
          ...(envelope.receipt.selectionChainTailSha256
            ? {
                selectionChainTailSha256:
                  envelope.receipt.selectionChainTailSha256,
              }
            : {}),
          envelope,
        }
      : {}),
    currentSelectionCount: currentCheckpoint.selectionCount,
    ...(currentCheckpoint.selectionChainTailSha256
      ? {
          currentSelectionChainTailSha256:
            currentCheckpoint.selectionChainTailSha256,
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function hashRefreshFailure(error: unknown): string {
  const evidence =
    error instanceof ReceiptTrustAnchorDirectoryDiscoveryError
      ? `${error.status}:${error.message}`
      : "unexpected-discovery-failure";
  return createHash("sha256").update(evidence).digest("hex");
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `Receipt trust anchor directory subscription ${label} is invalid`,
    );
  }
  return value;
}
