import {
  type PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  type TrustedReceiptEnvelope,
} from "@napier/contracts";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
} from "./receipt-trust-directory-subscriptions.js";
import { verifyTrustedReceiptEnvelope } from "./receipt-trust-envelopes.js";
import {
  appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
} from "./receipt-trust-store-records.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export function receiptTrustCheckpointRegistryQuorumBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
): string {
  const receipt = envelope.receipt;
  const candidate = receipt.candidates.find(
    (item) => item.checkpointSha256 === receipt.selectedCheckpointSha256,
  );
  return [
    receipt.selectedCheckpointSha256 ?? "",
    receipt.selectedSelectionSetSha256 ?? "",
    receipt.selectedSelectionChainTailSha256 ?? "",
    candidate?.subscriptionSetSha256 ?? "",
    candidate?.sourceOriginSetSha256 ?? "",
    candidate?.signerSetSha256 ?? "",
    envelope.signature.keyId,
  ].join(":");
}

export function receiptTrustRotationApprovalPolicyBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
): string {
  const receipt = envelope.receipt;
  return [
    receipt.approvalPolicySha256,
    receipt.subscriptionSha256,
    receipt.acceptedApprovalEnvelopeSetSha256,
    receipt.signerSetSha256,
    receipt.requiredSignerSetSha256 ?? "",
    envelope.signature.keyId,
  ].join(":");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export class ReceiptTrustCheckpointBaselineRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
      this.host.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(),
      policy,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult> {
    this.host.assertInitialized();
    this.host.getThread(promotedByThreadId);
    return this.host.stateQueue.run(async () => {
      const anchor = this.host.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust checkpoint registry quorum baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      if (envelope.receipt.status !== "agreed") {
        throw new Error(
          "Receipt trust checkpoint registry quorum baseline requires an agreed quorum",
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.find(
          (baseline) =>
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              baseline.envelope,
            ) === receiptTrustCheckpointRegistryQuorumBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline =
        appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          this.host.state,
          promotedByThreadId,
          envelope,
        );
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
    imported: boolean;
    previousBaselineSha256?: string;
  }> {
    this.host.assertInitialized();
    this.host.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust checkpoint registry quorum baseline import precondition is invalid",
      );
    }
    return this.host.stateQueue.run(async () => {
      const current =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.at(
          -1,
        );
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust checkpoint registry quorum baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          importedBaseline,
          trustedAnchors,
        );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust checkpoint registry quorum baseline import is not trusted: ${verification.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.find(
          (baseline) =>
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline =
        appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          this.host.state,
          importedByThreadId,
          importedBaseline.envelope,
        );
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
    created: boolean;
  }> {
    this.host.assertInitialized();
    this.host.getThread(promotedByThreadId);
    return this.host.stateQueue.run(async () => {
      const anchor = this.host.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust rotation approval policy baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      if (envelope.receipt.status !== "accepted") {
        throw new Error(
          "Receipt trust rotation approval policy baseline requires an accepted review",
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (baseline) =>
            receiptTrustRotationApprovalPolicyBaselineKey(baseline.envelope) ===
            receiptTrustRotationApprovalPolicyBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline =
        appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          this.host.state,
          promotedByThreadId,
          envelope,
        );
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async importReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
    imported: boolean;
    previousBaselineSha256?: string;
  }> {
    this.host.assertInitialized();
    this.host.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust rotation approval policy baseline import precondition is invalid",
      );
    }
    return this.host.stateQueue.run(async () => {
      const current =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.at(
          -1,
        );
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust rotation approval policy baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          importedBaseline,
          trustedAnchors,
        );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust rotation approval policy baseline import is not trusted: ${verification.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (baseline) =>
            receiptTrustRotationApprovalPolicyBaselineKey(baseline.envelope) ===
            receiptTrustRotationApprovalPolicyBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline =
        appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          this.host.state,
          importedByThreadId,
          importedBaseline.envelope,
        );
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }
}
