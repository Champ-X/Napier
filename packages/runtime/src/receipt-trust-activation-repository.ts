import {
  NAPIER_API_VERSION,
  type ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  type SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelection,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS,
} from "./receipt-trust-directory-subscriptions.js";
import { verifyTrustedReceiptEnvelope } from "./receipt-trust-envelopes.js";
import { appendReceiptTrustAnchorDirectoryQuorumActivationDecision } from "./receipt-trust-store-records.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import { ReceiptTrustActivationReadRepository } from "./receipt-trust-activation-read-repository.js";

export class ReceiptTrustActivationRepository extends ReceiptTrustActivationReadRepository {
  constructor(host: StoreRepositoryHost) {
    super(host);
  }

  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
    checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview {
    this.host.assertInitialized();
    const reviewedAt = new Date().toISOString();
    const currentSelection =
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelection;
    const currentSelectionSha256 = currentSelection?.contentSha256 ?? "";
    const driftAudit =
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit();
    const checkpointRegistryQuorum =
      checkpointRegistryQuorumPolicy !== undefined
        ? this.host.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
            checkpointRegistryQuorumPolicy,
          )
        : undefined;
    const record =
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
        (candidate) => candidate.id === activationDecisionRecordId,
      );
    const diagnostics: string[] = [];
    if (expectedCurrentSelectionSha256 !== currentSelectionSha256) {
      diagnostics.push("selection_precondition_failed");
    }
    if (!record) {
      diagnostics.push("activation_decision_missing");
    }
    if (
      checkpointRegistryQuorum &&
      checkpointRegistryQuorum.status !== "agreed"
    ) {
      diagnostics.push("checkpoint_registry_quorum_not_agreed");
    }
    if (currentSelection?.activationDecisionRecordId === record?.id) {
      diagnostics.push("selection_already_active");
    }
    let currentSourceAlignmentSha256: string | undefined;
    if (record) {
      const currentSourceAlignment =
        createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
          record.baseline,
          this.host.state.receiptTrustAnchorDirectorySubscriptions,
        );
      currentSourceAlignmentSha256 = currentSourceAlignment.contentSha256;
      if (record.envelope.receipt.decision !== "approved") {
        diagnostics.push("activation_decision_not_approved");
      }
      if (
        currentSourceAlignment.selectedSourceOriginSetSha256 !==
          record.sourceAlignment.selectedSourceOriginSetSha256 ||
        currentSourceAlignment.alignedSourceCount !==
          record.sourceAlignment.alignedSourceCount ||
        currentSourceAlignment.driftedSourceCount !== 0 ||
        currentSourceAlignment.missingSourceCount !== 0
      ) {
        diagnostics.push("source_alignment_drifted");
      }
    }
    const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview["status"] =
      expectedCurrentSelectionSha256 !== currentSelectionSha256
        ? "stale_selection"
        : !record
          ? "missing_decision"
          : currentSelection?.activationDecisionRecordId === record.id
            ? "already_active"
            : diagnostics.length > 0
              ? "blocked"
              : "eligible";
    const content = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-review" as const,
      schemaVersion: 1 as const,
      apiVersion: NAPIER_API_VERSION,
      reviewedAt,
      status,
      diagnostics,
      expectedCurrentSelectionSha256,
      currentSelectionSha256,
      activationDecisionRecordId,
      ...(record
        ? {
            activationDecisionRecordSha256: record.contentSha256,
            baselineSha256: record.baseline.contentSha256,
            sourceAlignmentSha256: record.sourceAlignment.contentSha256,
          }
        : {}),
      ...(currentSourceAlignmentSha256 ? { currentSourceAlignmentSha256 } : {}),
      driftAudit,
      ...(checkpointRegistryQuorum ? { checkpointRegistryQuorum } : {}),
    };
    return {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
    options: {
      checkpointRegistryQuorumBaselineId?: string;
      expectedCheckpointRegistryQuorumBaselineSha256?: string;
      checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy;
    } = {},
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal {
    this.host.assertInitialized();
    const proposedAt = nowIso();
    const rotationReview =
      this.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationDecisionRecordId,
        expectedCurrentSelectionSha256,
        options.checkpointRegistryQuorumPolicy,
      );
    const currentCheckpoint =
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
    const checkpointRegistryQuorumBaselines =
      this.host.state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines;
    const checkpointRegistryQuorumBaseline =
      options.checkpointRegistryQuorumBaselineId === undefined
        ? checkpointRegistryQuorumBaselines.at(-1)
        : checkpointRegistryQuorumBaselines.find(
            (baseline) =>
              baseline.id === options.checkpointRegistryQuorumBaselineId,
          );
    const diagnostics = rotationReview.diagnostics.slice();
    if (rotationReview.status !== "eligible") {
      diagnostics.push(`rotation_review_${rotationReview.status}`);
    }
    if (!checkpointRegistryQuorumBaseline) {
      diagnostics.push("checkpoint_registry_quorum_baseline_missing");
    } else {
      if (
        options.expectedCheckpointRegistryQuorumBaselineSha256 !== undefined &&
        checkpointRegistryQuorumBaseline.contentSha256 !==
          options.expectedCheckpointRegistryQuorumBaselineSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_precondition_failed",
        );
      }
      if (
        checkpointRegistryQuorumBaseline.envelope.receipt.status !== "agreed"
      ) {
        diagnostics.push("checkpoint_registry_quorum_baseline_not_agreed");
      }
      if (
        checkpointRegistryQuorumBaseline.selectedCheckpointSha256 !==
        currentCheckpoint.contentSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_checkpoint_mismatch",
        );
      }
      if (
        checkpointRegistryQuorumBaseline.selectedSelectionSetSha256 !==
        currentCheckpoint.selectionSetSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_selection_set_mismatch",
        );
      }
      if (
        (checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256 ??
          "") !== (currentCheckpoint.selectionChainTailSha256 ?? "")
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_selection_chain_tail_mismatch",
        );
      }
    }
    const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal["status"] =
      rotationReview.status === "stale_selection"
        ? "stale_selection"
        : rotationReview.status === "missing_decision"
          ? "missing_decision"
          : rotationReview.status === "already_active"
            ? "already_active"
            : !checkpointRegistryQuorumBaseline
              ? "missing_checkpoint_registry_baseline"
              : diagnostics.length > 0
                ? "blocked"
                : "proposed";
    const content = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal" as const,
      schemaVersion: 1 as const,
      apiVersion: NAPIER_API_VERSION,
      proposedAt,
      status,
      diagnostics,
      activationDecisionRecordId,
      ...(rotationReview.activationDecisionRecordSha256
        ? {
            activationDecisionRecordSha256:
              rotationReview.activationDecisionRecordSha256,
          }
        : {}),
      expectedCurrentSelectionSha256,
      currentSelectionSha256: rotationReview.currentSelectionSha256,
      rotationReview,
      rotationReviewSha256: rotationReview.contentSha256,
      ...(options.checkpointRegistryQuorumBaselineId
        ? {
            checkpointRegistryQuorumBaselineId:
              options.checkpointRegistryQuorumBaselineId,
          }
        : checkpointRegistryQuorumBaseline
          ? {
              checkpointRegistryQuorumBaselineId:
                checkpointRegistryQuorumBaseline.id,
            }
          : {}),
      ...(options.expectedCheckpointRegistryQuorumBaselineSha256
        ? {
            expectedCheckpointRegistryQuorumBaselineSha256:
              options.expectedCheckpointRegistryQuorumBaselineSha256,
          }
        : {}),
      ...(checkpointRegistryQuorumBaseline
        ? {
            checkpointRegistryQuorumBaselineSha256:
              checkpointRegistryQuorumBaseline.contentSha256,
            checkpointRegistryQuorumBaselineEnvelopeSha256:
              checkpointRegistryQuorumBaseline.envelope.contentSha256,
            checkpointRegistryQuorumSha256:
              checkpointRegistryQuorumBaseline.envelope.receipt.contentSha256,
            selectedCheckpointSha256:
              checkpointRegistryQuorumBaseline.selectedCheckpointSha256,
            selectedSelectionSetSha256:
              checkpointRegistryQuorumBaseline.selectedSelectionSetSha256,
            ...(checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256
              ? {
                  selectedSelectionChainTailSha256:
                    checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256,
                }
              : {}),
            selectedSubscriptionSetSha256:
              checkpointRegistryQuorumBaseline.selectedSubscriptionSetSha256,
            selectedSourceOriginSetSha256:
              checkpointRegistryQuorumBaseline.selectedSourceOriginSetSha256,
            selectedSignerSetSha256:
              checkpointRegistryQuorumBaseline.selectedSignerSetSha256,
            checkpointRegistryQuorumBaseline,
          }
        : {}),
      currentCheckpointSha256: currentCheckpoint.contentSha256,
      currentSelectionSetSha256: currentCheckpoint.selectionSetSha256,
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

  async applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
    threadId: string,
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
  ): Promise<ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return this.host.stateQueue.run(async () => {
      const currentSelection =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelection;
      const currentSelectionSha256 = currentSelection?.contentSha256 ?? "";
      if (expectedCurrentSelectionSha256 !== currentSelectionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection precondition failed",
        );
      }
      const record =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (candidate) => candidate.id === activationDecisionRecordId,
        );
      if (!record) {
        throw new Error(
          `Receipt trust anchor directory quorum activation decision not found: ${activationDecisionRecordId}`,
        );
      }
      if (currentSelection?.activationDecisionRecordId === record.id) {
        const selectionState =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
            currentSelection,
          );
        const content = {
          applied: false,
          expectedCurrentSelectionSha256,
          selection: structuredClone(currentSelection),
          selectionState,
          ...(currentSelection.previousSelectionSha256
            ? {
                previousSelectionSha256:
                  currentSelection.previousSelectionSha256,
              }
            : {}),
        };
        return {
          ...content,
          contentSha256: sha256(canonicalJson(content)),
        };
      }
      const currentSourceAlignment =
        createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
          record.baseline,
          this.host.state.receiptTrustAnchorDirectorySubscriptions,
        );
      if (
        currentSourceAlignment.selectedSourceOriginSetSha256 !==
          record.sourceAlignment.selectedSourceOriginSetSha256 ||
        currentSourceAlignment.alignedSourceCount !==
          record.sourceAlignment.alignedSourceCount ||
        currentSourceAlignment.driftedSourceCount !== 0 ||
        currentSourceAlignment.missingSourceCount !== 0
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection source alignment drifted",
        );
      }
      if (
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelections
          .length >= MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
      ) {
        throw new Error(
          `Receipt trust anchor directory quorum activation exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS} selections`,
        );
      }
      const selection =
        createReceiptTrustAnchorDirectoryQuorumActivationSelection({
          activatedByThreadId: threadId,
          activationDecisionRecord: record,
          ...(currentSelectionSha256
            ? { previousSelectionSha256: currentSelectionSha256 }
            : {}),
        });
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelection =
        selection;
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelections.push(
        selection,
      );
      await this.host.persistState();
      const selectionState =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
          selection,
        );
      const content = {
        applied: true,
        expectedCurrentSelectionSha256,
        selection: structuredClone(selection),
        selectionState,
        ...(currentSelectionSha256
          ? { previousSelectionSha256: currentSelectionSha256 }
          : {}),
      };
      return {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      };
    });
  }

  async recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
    signedByThreadId: string,
    result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord> {
    this.host.assertInitialized();
    this.host.getThread(signedByThreadId);
    return this.host.stateQueue.run(async () => {
      const anchor = this.host.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === result.envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${result.envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(result.envelope, [
        anchor,
      ]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust anchor directory quorum activation decision is not trusted: ${verification.reason}`,
        );
      }
      const existing =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (record) =>
            record.envelope.contentSha256 === result.envelope.contentSha256,
        );
      if (existing) return structuredClone(existing);
      const record = appendReceiptTrustAnchorDirectoryQuorumActivationDecision(
        this.host.state,
        signedByThreadId,
        result,
      );
      await this.host.persistState();
      return structuredClone(record);
    });
  }
}
