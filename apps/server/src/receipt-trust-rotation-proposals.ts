import type {
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
} from "@napier/contracts";
import { NAPIER_API_VERSION } from "@napier/contracts";
import {
  canonicalJson,
  type LocalStore,
  receiptTrustAnchorsFromDirectory,
  sha256,
  validateTrustedReceiptEnvelope,
  verifyTrustedReceiptEnvelope,
} from "@napier/runtime";

import type { ReceiptTrustAnchorDirectoryHostedJsonSource } from "./receipt-trust-directory-discovery.js";

type RotationProposalGateResult =
  | {
      status: "accepted";
      envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
      proposal: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
      verification: TrustedReceiptVerification;
    }
  | {
      status: "rejected";
      reason: string;
      diagnostics?: string[];
      envelope?: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
      proposal?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
      verification?: TrustedReceiptVerification;
    };

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
  store: LocalStore,
  request: VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight {
  const checkedAt = new Date().toISOString();
  const selectionState =
    store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
  const activeSelection = selectionState.selection;
  const base = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-preflight" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    checkedAt,
    activationDecisionRecordId: request.activationDecisionRecordId,
    expectedCurrentSelectionSha256: request.expectedCurrentSelectionSha256,
    currentSelectionSha256: selectionState.currentSelectionSha256,
    ...(activeSelection
      ? { activeSelectionSha256: activeSelection.contentSha256 }
      : {}),
  };
  if (
    request.expectedCurrentSelectionSha256 !==
    selectionState.currentSelectionSha256
  ) {
    return withRotationProposalPreflightHash({
      ...base,
      status: "rejected",
      diagnostics: ["selection_precondition_failed"],
      reason:
        "Receipt trust anchor directory quorum activation selection precondition failed",
    });
  }
  if (!activeSelection) {
    return withRotationProposalPreflightHash({
      ...base,
      status: "not_required",
      diagnostics: ["active_selection_missing"],
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal is not required before the first selection",
    });
  }
  if (
    activeSelection.activationDecisionRecordId ===
    request.activationDecisionRecordId
  ) {
    return withRotationProposalPreflightHash({
      ...base,
      status: "not_required",
      diagnostics: ["selection_already_active"],
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal is not required for an idempotent reapply",
    });
  }
  const gate =
    verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate(
      store,
      request,
    );
  if (gate.status === "accepted") {
    return withRotationProposalPreflightHash({
      ...base,
      status: "accepted",
      diagnostics: [],
      rotationProposalEnvelopeSha256: gate.envelope.contentSha256,
      rotationProposalSha256: gate.proposal.contentSha256,
      rotationProposalReviewSha256: gate.proposal.rotationReviewSha256,
      ...(gate.proposal.checkpointRegistryQuorumBaselineSha256
        ? {
            rotationProposalCheckpointRegistryQuorumBaselineSha256:
              gate.proposal.checkpointRegistryQuorumBaselineSha256,
          }
        : {}),
      trustedReceiptVerificationStatus: gate.verification.status,
      trustedReceiptVerificationReason: gate.verification.reason,
      ...(gate.verification.keyId
        ? { trustedReceiptVerificationKeyId: gate.verification.keyId }
        : {}),
      ...(gate.verification.envelopeSha256
        ? {
            trustedReceiptVerificationEnvelopeSha256:
              gate.verification.envelopeSha256,
          }
        : {}),
    });
  }
  return withRotationProposalPreflightHash({
    ...base,
    status: "rejected",
    diagnostics: gate.diagnostics ?? ["rotation_proposal_gate_rejected"],
    reason: gate.reason,
    ...(gate.envelope
      ? { rotationProposalEnvelopeSha256: gate.envelope.contentSha256 }
      : {}),
    ...(gate.proposal
      ? {
          rotationProposalSha256: gate.proposal.contentSha256,
          rotationProposalReviewSha256: gate.proposal.rotationReviewSha256,
          ...(gate.proposal.checkpointRegistryQuorumBaselineSha256
            ? {
                rotationProposalCheckpointRegistryQuorumBaselineSha256:
                  gate.proposal.checkpointRegistryQuorumBaselineSha256,
              }
            : {}),
        }
      : {}),
    ...(gate.verification
      ? {
          trustedReceiptVerificationStatus: gate.verification.status,
          trustedReceiptVerificationReason: gate.verification.reason,
          ...(gate.verification.keyId
            ? { trustedReceiptVerificationKeyId: gate.verification.keyId }
            : {}),
          ...(gate.verification.envelopeSha256
            ? {
                trustedReceiptVerificationEnvelopeSha256:
                  gate.verification.envelopeSha256,
              }
            : {}),
        }
      : {}),
  });
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
  store: LocalStore,
  request: DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  source: ReceiptTrustAnchorDirectoryHostedJsonSource,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery {
  const generatedAt = new Date().toISOString();
  const policy = request.policy ?? {};
  const policySha256 = sha256(canonicalJson(policy));
  const diagnostics: string[] = [];
  let envelope:
    | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>
    | undefined;
  let preflight:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight
    | undefined;
  try {
    envelope = validateTrustedReceiptEnvelope(
      source.value,
    ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
  } catch {
    diagnostics.push("envelope_invalid");
  }
  if (envelope) {
    preflight =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
        store,
        {
          threadId: request.threadId,
          activationDecisionRecordId:
            envelope.receipt.activationDecisionRecordId,
          expectedCurrentSelectionSha256:
            envelope.receipt.expectedCurrentSelectionSha256,
          rotationProposalEnvelope: envelope,
        },
      );
    if (preflight.status !== "accepted") {
      diagnostics.push(`preflight_${preflight.status}`);
      diagnostics.push(...preflight.diagnostics);
    }
    if (
      policy.expectedEnvelopeSha256 &&
      envelope.contentSha256 !== policy.expectedEnvelopeSha256
    ) {
      diagnostics.push("envelope_hash_mismatch");
    }
    if (
      policy.expectedProposalSha256 &&
      envelope.receipt.contentSha256 !== policy.expectedProposalSha256
    ) {
      diagnostics.push("proposal_hash_mismatch");
    }
    if (
      policy.expectedActivationDecisionRecordId &&
      envelope.receipt.activationDecisionRecordId !==
        policy.expectedActivationDecisionRecordId
    ) {
      diagnostics.push("activation_decision_mismatch");
    }
    if (
      policy.expectedCurrentSelectionSha256 !== undefined &&
      envelope.receipt.expectedCurrentSelectionSha256 !==
        policy.expectedCurrentSelectionSha256
    ) {
      diagnostics.push("expected_selection_mismatch");
    }
    if (
      policy.requiredSignerKeyIds &&
      !policy.requiredSignerKeyIds.includes(envelope.signature.keyId)
    ) {
      diagnostics.push("signer_not_allowed");
    }
    if (policy.maxEnvelopeAgeMs !== undefined) {
      const signedAtMs = Date.parse(envelope.signature.signedAt);
      const generatedAtMs = Date.parse(generatedAt);
      if (signedAtMs > generatedAtMs + 5 * 60 * 1_000) {
        diagnostics.push("envelope_signed_in_future");
      } else if (generatedAtMs - signedAtMs > policy.maxEnvelopeAgeMs) {
        diagnostics.push("envelope_expired");
      }
    }
  }
  const uniqueDiagnostics = Array.from(new Set(diagnostics));
  const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery["status"] =
    envelope && preflight?.status === "accepted" && uniqueDiagnostics.length === 0
      ? "valid"
      : "invalid";
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-discovery" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    generatedAt,
    status,
    diagnostics: uniqueDiagnostics,
    sourceUrlSha256: source.sourceUrlSha256,
    sourceOriginSha256: source.sourceOriginSha256,
    httpStatus: source.httpStatus,
    responseMediaType: source.responseMediaType,
    responseBytes: source.responseBytes,
    responseBodySha256: source.responseBodySha256,
    policy,
    policySha256,
    ...(preflight ? { preflight } : {}),
    ...(envelope
      ? {
          envelopeSha256: envelope.contentSha256,
          proposalSha256: envelope.receipt.contentSha256,
          proposalReviewSha256: envelope.receipt.rotationReviewSha256,
          ...(envelope.receipt.checkpointRegistryQuorumBaselineSha256
            ? {
                checkpointRegistryQuorumBaselineSha256:
                  envelope.receipt.checkpointRegistryQuorumBaselineSha256,
              }
            : {}),
          activationDecisionRecordId:
            envelope.receipt.activationDecisionRecordId,
          expectedCurrentSelectionSha256:
            envelope.receipt.expectedCurrentSelectionSha256,
          signerKeyId: envelope.signature.keyId,
          signedAt: envelope.signature.signedAt,
          envelope,
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval(
  store: LocalStore,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  request: SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval {
  if (subscription.auditThreadId !== request.threadId) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval audit thread changed",
    );
  }
  if (subscription.revision !== request.expectedSubscriptionRevision) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval revision changed",
    );
  }
  if (subscription.contentSha256 !== request.expectedSubscriptionSha256) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval precondition failed",
    );
  }
  const discovery = subscription.lastGoodDiscovery;
  const envelope = discovery?.envelope;
  const proposal = envelope?.receipt;
  if (
    !discovery ||
    discovery.status !== "valid" ||
    !envelope ||
    !proposal ||
    !discovery.proposalSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval requires a valid last-good proposal",
    );
  }
  if (
    request.expectedDiscoverySha256 &&
    discovery.contentSha256 !== request.expectedDiscoverySha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval discovery precondition failed",
    );
  }
  if (
    request.expectedEnvelopeSha256 &&
    envelope.contentSha256 !== request.expectedEnvelopeSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval envelope precondition failed",
    );
  }
  if (
    request.expectedProposalSha256 &&
    proposal.contentSha256 !== request.expectedProposalSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval proposal precondition failed",
    );
  }
  const preflight =
    createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
      store,
      {
        threadId: request.threadId,
        activationDecisionRecordId: proposal.activationDecisionRecordId,
        expectedCurrentSelectionSha256: proposal.expectedCurrentSelectionSha256,
        rotationProposalEnvelope: envelope,
      },
    );
  if (preflight.status !== "accepted") {
    throw new Error(
      `Receipt trust anchor directory quorum activation selection rotation proposal subscription approval preflight rejected: ${preflight.diagnostics.join(", ")}`,
    );
  }
  const approvedAt = new Date().toISOString();
  if (
    request.expiresAt !== undefined &&
    Date.parse(request.expiresAt) <= Date.parse(approvedAt)
  ) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval expiry is invalid",
    );
  }
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    approvedAt,
    approvedByThreadId: request.threadId,
    subscriptionId: subscription.id,
    subscriptionRevision: subscription.revision,
    subscriptionSha256: subscription.contentSha256,
    sourceUrlSha256: subscription.sourceUrlSha256,
    sourceOriginSha256: subscription.sourceOriginSha256,
    policySha256: subscription.policySha256,
    discoverySha256: discovery.contentSha256,
    envelopeSha256: envelope.contentSha256,
    proposalSha256: proposal.contentSha256,
    proposalReviewSha256: proposal.rotationReviewSha256,
    approvalPreflightSha256: preflight.contentSha256,
    activationDecisionRecordId: proposal.activationDecisionRecordId,
    expectedCurrentSelectionSha256: proposal.expectedCurrentSelectionSha256,
    ...(proposal.checkpointRegistryQuorumBaselineSha256
      ? {
          checkpointRegistryQuorumBaselineSha256:
            proposal.checkpointRegistryQuorumBaselineSha256,
        }
      : {}),
    proposalSignerKeyId: envelope.signature.keyId,
    proposalSignedAt: envelope.signature.signedAt,
    ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate(
  store: LocalStore,
  request: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
): RotationProposalGateResult {
  if (request.rotationProposalEnvelope === undefined) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection requires a signed fresh rotation proposal",
    };
  }
  let envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
  try {
    envelope = validateTrustedReceiptEnvelope(
      request.rotationProposalEnvelope,
    ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
  } catch {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal envelope is invalid",
    };
  }
  const selectionState =
    store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
  const activeSelection = selectionState.selection;
  if (!activeSelection) {
    return {
      status: "accepted",
      envelope,
      proposal: envelope.receipt,
      verification: verifyTrustedReceiptEnvelope(
        envelope,
        store.listReceiptTrustAnchors(),
      ),
    };
  }
  const directoryVerification = store.verifyReceiptTrustAnchorDirectory(
    activeSelection.selectedDirectory,
    {
      expectedAnchorSetSha256: activeSelection.selectedAnchorSetSha256,
    },
  );
  if (directoryVerification.status === "invalid") {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection active verifier directory is invalid",
    };
  }
  const verification = verifyTrustedReceiptEnvelope(
    envelope,
    receiptTrustAnchorsFromDirectory(activeSelection.selectedDirectory),
  );
  if (verification.status !== "trusted") {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal is not trusted",
      diagnostics: [`trusted_receipt_${verification.status}`],
      envelope,
      proposal: envelope.receipt,
      verification,
    };
  }
  const proposal = envelope.receipt;
  const currentProposal =
    store.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
      proposal.activationDecisionRecordId,
      proposal.expectedCurrentSelectionSha256,
      {
        ...(proposal.checkpointRegistryQuorumBaselineId
          ? {
              checkpointRegistryQuorumBaselineId:
                proposal.checkpointRegistryQuorumBaselineId,
            }
          : {}),
        ...(proposal.expectedCheckpointRegistryQuorumBaselineSha256
          ? {
              expectedCheckpointRegistryQuorumBaselineSha256:
                proposal.expectedCheckpointRegistryQuorumBaselineSha256,
            }
          : {}),
        ...(proposal.rotationReview.checkpointRegistryQuorum
          ? {
              checkpointRegistryQuorumPolicy:
                proposal.rotationReview.checkpointRegistryQuorum.policy,
            }
          : {}),
      },
    );
  const staleDiagnostics: string[] = [];
  const requireMatch = (condition: boolean, diagnostic: string): void => {
    if (!condition) staleDiagnostics.push(diagnostic);
  };
  requireMatch(proposal.status === "proposed", "proposal_not_proposed");
  requireMatch(
    currentProposal.status === "proposed",
    `current_proposal_${currentProposal.status}`,
  );
  if (currentProposal.status !== "proposed") {
    staleDiagnostics.push(...currentProposal.diagnostics);
  }
  requireMatch(
    proposal.activationDecisionRecordId === request.activationDecisionRecordId,
    "request_activation_decision_mismatch",
  );
  requireMatch(
    proposal.activationDecisionRecordId ===
      currentProposal.activationDecisionRecordId,
    "current_activation_decision_mismatch",
  );
  requireMatch(
    proposal.expectedCurrentSelectionSha256 ===
      request.expectedCurrentSelectionSha256,
    "request_expected_selection_mismatch",
  );
  requireMatch(
    proposal.expectedCurrentSelectionSha256 ===
      currentProposal.expectedCurrentSelectionSha256,
    "current_expected_selection_mismatch",
  );
  requireMatch(
    proposal.currentSelectionSha256 === selectionState.currentSelectionSha256,
    "active_selection_mismatch",
  );
  requireMatch(
    proposal.currentSelectionSha256 === currentProposal.currentSelectionSha256,
    "current_selection_mismatch",
  );
  requireMatch(
    proposal.rotationReview.status === "eligible",
    `rotation_review_${proposal.rotationReview.status}`,
  );
  requireMatch(
    proposal.checkpointRegistryQuorumBaselineId ===
      currentProposal.checkpointRegistryQuorumBaselineId,
    "checkpoint_registry_quorum_baseline_id_mismatch",
  );
  requireMatch(
    proposal.checkpointRegistryQuorumBaselineSha256 ===
      currentProposal.checkpointRegistryQuorumBaselineSha256,
    "checkpoint_registry_quorum_baseline_hash_mismatch",
  );
  requireMatch(
    proposal.checkpointRegistryQuorumSha256 ===
      currentProposal.checkpointRegistryQuorumSha256,
    "checkpoint_registry_quorum_hash_mismatch",
  );
  requireMatch(
    proposal.selectedCheckpointSha256 ===
      currentProposal.selectedCheckpointSha256,
    "selected_checkpoint_mismatch",
  );
  requireMatch(
    proposal.selectedSelectionSetSha256 ===
      currentProposal.selectedSelectionSetSha256,
    "selected_selection_set_mismatch",
  );
  requireMatch(
    (proposal.selectedSelectionChainTailSha256 ?? "") ===
      (currentProposal.selectedSelectionChainTailSha256 ?? ""),
    "selected_selection_chain_tail_mismatch",
  );
  requireMatch(
    proposal.selectedSubscriptionSetSha256 ===
      currentProposal.selectedSubscriptionSetSha256,
    "selected_subscription_set_mismatch",
  );
  requireMatch(
    proposal.selectedSourceOriginSetSha256 ===
      currentProposal.selectedSourceOriginSetSha256,
    "selected_source_origin_set_mismatch",
  );
  requireMatch(
    proposal.selectedSignerSetSha256 === currentProposal.selectedSignerSetSha256,
    "selected_signer_set_mismatch",
  );
  requireMatch(
    proposal.currentCheckpointSha256 === currentProposal.currentCheckpointSha256,
    "current_checkpoint_mismatch",
  );
  requireMatch(
    proposal.currentSelectionSetSha256 ===
      currentProposal.currentSelectionSetSha256,
    "current_selection_set_mismatch",
  );
  requireMatch(
    (proposal.currentSelectionChainTailSha256 ?? "") ===
      (currentProposal.currentSelectionChainTailSha256 ?? ""),
    "current_selection_chain_tail_mismatch",
  );
  if (staleDiagnostics.length > 0) {
    return {
      status: "rejected",
      reason: `Receipt trust anchor directory quorum activation selection rotation proposal is stale: ${staleDiagnostics.join(", ")}`,
      diagnostics: staleDiagnostics,
      envelope,
      proposal,
      verification,
    };
  }
  return {
    status: "accepted",
    envelope,
    proposal,
    verification,
  };
}

function withRotationProposalPreflightHash(
  content: Omit<
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
    "contentSha256"
  >,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}
