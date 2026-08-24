import {
  type CreateReceiptTrustAnchorRequest,
  type PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectory,
  type ReceiptTrustAnchorDirectoryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectoryVerification,
  type ReceiptTrustAnchorDirectoryVerificationPolicy,
  type TrustedReceiptEnvelope,
} from "@napier/contracts";
import {
  createReceiptTrustAnchorDirectorySubscriptionQuorum,
  reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  stripReceiptTrustAnchorDirectorySubscriptionSecrets,
  validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
} from "./receipt-trust-directory-subscriptions.js";
import {
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchor as createReceiptTrustAnchorRecord,
  MAX_RECEIPT_TRUST_ANCHORS,
  revokeReceiptTrustAnchor as revokeReceiptTrustAnchorRecord,
  verifyReceiptTrustAnchorDirectory,
  verifyTrustedReceiptEnvelope,
} from "./receipt-trust-envelopes.js";
import { appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline } from "./receipt-trust-store-records.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export function receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
): string {
  const receipt = envelope.receipt;
  return [
    receipt.selectedAnchorSetSha256,
    receipt.selectedDirectorySha256,
    receipt.selectedSubscriptionSetSha256,
    envelope.signature.keyId,
  ].join(":");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export class ReceiptTrustAnchorRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listReceiptTrustAnchors(): ReceiptTrustAnchor[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.receiptTrustAnchors
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getReceiptTrustAnchorDirectory(): ReceiptTrustAnchorDirectory {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectory(this.listReceiptTrustAnchors());
  }

  verifyReceiptTrustAnchorDirectory(
    input: unknown,
    policy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
  ): ReceiptTrustAnchorDirectoryVerification {
    this.host.assertInitialized();
    return verifyReceiptTrustAnchorDirectory(input, policy);
  }

  getReceiptTrustAnchor(anchorId: string): ReceiptTrustAnchor {
    this.host.assertInitialized();
    const anchor = this.host.state.receiptTrustAnchors.find(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchor) {
      throw new Error(`Receipt trust anchor not found: ${anchorId}`);
    }
    return structuredClone(anchor);
  }

  async createReceiptTrustAnchor(
    request: CreateReceiptTrustAnchorRequest,
  ): Promise<ReceiptTrustAnchor> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const anchor = createReceiptTrustAnchorRecord(request);
    return this.host.stateQueue.run(async () => {
      if (
        this.host.state.receiptTrustAnchors.length >= MAX_RECEIPT_TRUST_ANCHORS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_ANCHORS} receipt trust anchors`,
        );
      }
      if (
        this.host.state.receiptTrustAnchors.some(
          (candidate) => candidate.keyId === anchor.keyId,
        )
      ) {
        throw new Error(
          `Receipt trust anchor already exists for key: ${anchor.keyId}`,
        );
      }
      if (
        anchor.signingSource &&
        this.host.state.receiptTrustAnchors.some(
          (candidate) =>
            candidate.signingSource?.variable ===
            anchor.signingSource?.variable,
        )
      ) {
        throw new Error(
          `Receipt signing source already exists: ${anchor.signingSource.variable}`,
        );
      }
      this.host.state.receiptTrustAnchors.push(anchor);
      await this.host.persistState();
      return structuredClone(anchor);
    });
  }

  async revokeReceiptTrustAnchor(
    anchorId: string,
  ): Promise<ReceiptTrustAnchor> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.receiptTrustAnchors.findIndex(
        (candidate) => candidate.id === anchorId,
      );
      const current = this.host.state.receiptTrustAnchors[index];
      if (!current) {
        throw new Error(`Receipt trust anchor not found: ${anchorId}`);
      }
      const updated = revokeReceiptTrustAnchorRecord(current);
      this.host.state.receiptTrustAnchors[index] = updated;
      if (updated.status !== current.status) await this.host.persistState();
      return structuredClone(updated);
    });
  }

  listReceiptTrustAnchorDirectorySubscriptions(): ReceiptTrustAnchorDirectorySubscription[] {
    this.host.assertInitialized();
    return this.host.state.receiptTrustAnchorDirectorySubscriptions
      .map(stripReceiptTrustAnchorDirectorySubscriptionSecrets)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectorySubscription {
    this.host.assertInitialized();
    const subscription =
      this.host.state.receiptTrustAnchorDirectorySubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
      );
    }
    return stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription);
  }

  getReceiptTrustAnchorDirectorySubscriptionQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumPolicy,
    metadataEvidence?: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[],
  ): ReceiptTrustAnchorDirectoryQuorum {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectorySubscriptionQuorum(
      this.listReceiptTrustAnchorDirectorySubscriptions(),
      policy,
      metadataEvidence,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult> {
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
          `Receipt trust anchor directory quorum promotion baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.find(
          (baseline) =>
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline = appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
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

  async importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
    importPolicy?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
    imported: boolean;
    policyReview?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
    previousBaselineSha256?: string;
  }> {
    this.host.assertInitialized();
    this.host.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum promotion baseline import precondition is invalid",
      );
    }
    return this.host.stateQueue.run(async () => {
      const current =
        this.host.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.at(
          -1,
        );
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum promotion baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification = verifyTrustedReceiptEnvelope(
        importedBaseline.envelope,
        trustedAnchors,
      );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust anchor directory quorum promotion baseline import is not trusted: ${verification.reason}`,
        );
      }
      const policyReview =
        importPolicy === undefined
          ? undefined
          : reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
              importedBaseline,
              importPolicy,
            );
      if (policyReview?.status === "rejected") {
        throw new Error(
          `Receipt trust anchor directory quorum promotion baseline import policy rejected: ${policyReview.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.find(
          (baseline) =>
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(policyReview ? { policyReview } : {}),
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline = appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        this.host.state,
        importedByThreadId,
        importedBaseline.envelope,
      );
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(policyReview ? { policyReview } : {}),
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }
}
