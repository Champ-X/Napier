import type {
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
} from "@napier/contracts";
import { NAPIER_API_VERSION } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";
import { type LocalStore } from "@napier/runtime/store";
import {
  normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  receiptTrustAnchorsFromDirectory,
  validateApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
  validateTrustedReceiptEnvelope,
  verifyTrustedReceiptEnvelope,
} from "@napier/runtime/governance";

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

export type RotationProposalSubscriptionApprovalApplyGateResult =
  | {
      status: "accepted";
      approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
      approval: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval;
      proposalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
      proposal: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
      preflight: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight;
      verification: TrustedReceiptVerification;
    }
  | {
      status: "rejected";
      reason: string;
      diagnostics?: string[];
      approvalEnvelope?: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
      approval?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval;
      proposalEnvelope?: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
      proposal?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
      preflight?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight;
      verification?: TrustedReceiptVerification;
    };

export interface RotationProposalSubscriptionApprovalPolicyReviewResult {
  review: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview;
  acceptedGates: Extract<
    RotationProposalSubscriptionApprovalApplyGateResult,
    { status: "accepted" }
  >[];
}

export type RotationProposalSubscriptionApprovalPolicyBaselineGateResult =
  | {
      status: "accepted";
      baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
      diagnostics: string[];
    }
  | {
      status: "rejected";
      diagnostics: string[];
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
    envelope &&
    preflight?.status === "accepted" &&
    uniqueDiagnostics.length === 0
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

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate(
  store: LocalStore,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  request: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
): RotationProposalSubscriptionApprovalApplyGateResult {
  if (subscription.auditThreadId !== request.threadId) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval audit thread changed",
    };
  }
  if (subscription.revision !== request.expectedSubscriptionRevision) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval revision changed",
    };
  }
  if (subscription.contentSha256 !== request.expectedSubscriptionSha256) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval precondition failed",
    };
  }
  let approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
  try {
    const envelope = validateTrustedReceiptEnvelope(request.approvalEnvelope);
    if (
      envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
    ) {
      return {
        status: "rejected",
        reason:
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval receipt kind is invalid",
      };
    }
    approvalEnvelope =
      envelope as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
  } catch {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval envelope is invalid",
    };
  }
  const approval = approvalEnvelope.receipt;
  const selectionState =
    store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
  const activeSelection = selectionState.selection;
  if (!activeSelection) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval requires an active verifier selection",
      approvalEnvelope,
      approval,
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
      approvalEnvelope,
      approval,
    };
  }
  const verification = verifyTrustedReceiptEnvelope(
    approvalEnvelope,
    receiptTrustAnchorsFromDirectory(activeSelection.selectedDirectory),
  );
  if (verification.status !== "trusted") {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval is not trusted",
      diagnostics: [`trusted_receipt_${verification.status}`],
      approvalEnvelope,
      approval,
      verification,
    };
  }
  if (
    approval.expiresAt !== undefined &&
    Date.parse(approval.expiresAt) <= Date.now()
  ) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval is expired",
      diagnostics: ["approval_expired"],
      approvalEnvelope,
      approval,
      verification,
    };
  }
  const discovery = subscription.lastGoodDiscovery;
  const proposalEnvelope = discovery?.envelope;
  const proposal = proposalEnvelope?.receipt;
  if (
    !discovery ||
    discovery.status !== "valid" ||
    !proposalEnvelope ||
    !proposal
  ) {
    return {
      status: "rejected",
      reason:
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval requires a valid last-good proposal",
      approvalEnvelope,
      approval,
      verification,
    };
  }
  const diagnostics: string[] = [];
  const requireMatch = (condition: boolean, diagnostic: string): void => {
    if (!condition) diagnostics.push(diagnostic);
  };
  requireMatch(
    approval.approvedByThreadId === request.threadId,
    "approval_thread_mismatch",
  );
  requireMatch(
    approval.subscriptionId === subscription.id,
    "approval_subscription_id_mismatch",
  );
  requireMatch(
    approval.subscriptionRevision === subscription.revision,
    "approval_subscription_revision_mismatch",
  );
  requireMatch(
    approval.subscriptionSha256 === subscription.contentSha256,
    "approval_subscription_hash_mismatch",
  );
  requireMatch(
    approval.sourceUrlSha256 === subscription.sourceUrlSha256,
    "approval_source_url_hash_mismatch",
  );
  requireMatch(
    approval.sourceOriginSha256 === subscription.sourceOriginSha256,
    "approval_source_origin_hash_mismatch",
  );
  requireMatch(
    approval.policySha256 === subscription.policySha256,
    "approval_policy_hash_mismatch",
  );
  requireMatch(
    approval.discoverySha256 === discovery.contentSha256,
    "approval_discovery_hash_mismatch",
  );
  requireMatch(
    approval.envelopeSha256 === proposalEnvelope.contentSha256,
    "approval_proposal_envelope_hash_mismatch",
  );
  requireMatch(
    approval.proposalSha256 === proposal.contentSha256,
    "approval_proposal_hash_mismatch",
  );
  requireMatch(
    approval.proposalReviewSha256 === proposal.rotationReviewSha256,
    "approval_proposal_review_hash_mismatch",
  );
  requireMatch(
    approval.activationDecisionRecordId === proposal.activationDecisionRecordId,
    "approval_activation_decision_mismatch",
  );
  requireMatch(
    approval.expectedCurrentSelectionSha256 ===
      proposal.expectedCurrentSelectionSha256,
    "approval_expected_selection_mismatch",
  );
  requireMatch(
    (approval.checkpointRegistryQuorumBaselineSha256 ?? "") ===
      (proposal.checkpointRegistryQuorumBaselineSha256 ?? ""),
    "approval_checkpoint_registry_quorum_baseline_hash_mismatch",
  );
  requireMatch(
    approval.proposalSignerKeyId === proposalEnvelope.signature.keyId,
    "approval_proposal_signer_mismatch",
  );
  requireMatch(
    approval.proposalSignedAt === proposalEnvelope.signature.signedAt,
    "approval_proposal_signed_at_mismatch",
  );
  const preflight =
    createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
      store,
      {
        threadId: request.threadId,
        activationDecisionRecordId: proposal.activationDecisionRecordId,
        expectedCurrentSelectionSha256: proposal.expectedCurrentSelectionSha256,
        rotationProposalEnvelope: proposalEnvelope,
      },
    );
  if (preflight.status !== "accepted") {
    diagnostics.push(`preflight_${preflight.status}`);
    diagnostics.push(...preflight.diagnostics);
  }
  if (diagnostics.length > 0) {
    return {
      status: "rejected",
      reason: `Receipt trust anchor directory quorum activation selection rotation proposal subscription approval is stale: ${Array.from(new Set(diagnostics)).join(", ")}`,
      diagnostics: Array.from(new Set(diagnostics)),
      approvalEnvelope,
      approval,
      proposalEnvelope,
      proposal,
      preflight,
      verification,
    };
  }
  return {
    status: "accepted",
    approvalEnvelope,
    approval,
    proposalEnvelope,
    proposal,
    preflight,
    verification,
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
  store: LocalStore,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  request: ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,
): RotationProposalSubscriptionApprovalPolicyReviewResult {
  const reviewedAt = new Date().toISOString();
  const approvalPolicy =
    normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy(
      request.approvalPolicy,
    );
  const approvalEnvelopeSha256s = request.approvalEnvelopes
    .map((envelope) =>
      typeof envelope?.contentSha256 === "string"
        ? envelope.contentSha256
        : sha256(canonicalJson(envelope)),
    )
    .sort();
  const diagnostics: string[] = [];
  const acceptedBySigner = new Map<
    string,
    Extract<
      RotationProposalSubscriptionApprovalApplyGateResult,
      { status: "accepted" }
    >
  >();

  request.approvalEnvelopes.forEach((approvalEnvelope, index) => {
    const gate =
      verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate(
        store,
        subscription,
        {
          threadId: request.threadId,
          expectedSubscriptionRevision: request.expectedSubscriptionRevision,
          expectedSubscriptionSha256: request.expectedSubscriptionSha256,
          approvalEnvelope,
        },
      );
    if (gate.status === "accepted") {
      const signerKeyId = gate.approvalEnvelope.signature.keyId;
      const previous = acceptedBySigner.get(signerKeyId);
      if (
        !previous ||
        gate.approvalEnvelope.contentSha256 <
          previous.approvalEnvelope.contentSha256
      ) {
        acceptedBySigner.set(signerKeyId, gate);
      }
      return;
    }
    diagnostics.push(`approval_${index}_rejected`);
    if (gate.diagnostics) diagnostics.push(...gate.diagnostics);
  });

  const acceptedGates = Array.from(acceptedBySigner.values()).sort(
    (left, right) => {
      const signerOrder = left.approvalEnvelope.signature.keyId.localeCompare(
        right.approvalEnvelope.signature.keyId,
      );
      if (signerOrder !== 0) return signerOrder;
      return left.approvalEnvelope.contentSha256.localeCompare(
        right.approvalEnvelope.contentSha256,
      );
    },
  );
  const acceptedApprovalEnvelopeSha256s = acceptedGates
    .map((gate) => gate.approvalEnvelope.contentSha256)
    .sort();
  const acceptedApprovalSignerKeyIds = acceptedGates
    .map((gate) => gate.approvalEnvelope.signature.keyId)
    .sort();
  const requiredSignerKeyIds = approvalPolicy.requiredSignerKeyIds ?? [];
  if (
    acceptedApprovalSignerKeyIds.length <
    approvalPolicy.minimumDistinctSignerCount
  ) {
    diagnostics.push("approval_distinct_signer_count_below_policy");
  }
  const acceptedSignerSet = new Set(acceptedApprovalSignerKeyIds);
  for (const requiredSignerKeyId of requiredSignerKeyIds) {
    if (!acceptedSignerSet.has(requiredSignerKeyId)) {
      diagnostics.push("required_signer_missing");
      break;
    }
  }
  if (acceptedGates.length === 0) diagnostics.push("approval_quorum_empty");

  const primaryGate = acceptedGates[0];
  const uniqueDiagnostics = Array.from(new Set(diagnostics));
  const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview["status"] =
    uniqueDiagnostics.length === 0 ? "accepted" : "rejected";
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-review" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    reviewedAt,
    status,
    diagnostics: uniqueDiagnostics,
    subscriptionId: subscription.id,
    subscriptionRevision: subscription.revision,
    subscriptionSha256: subscription.contentSha256,
    sourceUrlSha256: subscription.sourceUrlSha256,
    sourceOriginSha256: subscription.sourceOriginSha256,
    subscriptionPolicySha256: subscription.policySha256,
    expectedSubscriptionRevision: request.expectedSubscriptionRevision,
    expectedSubscriptionSha256: request.expectedSubscriptionSha256,
    approvalPolicy,
    approvalPolicySha256: sha256(canonicalJson(approvalPolicy)),
    approvalEnvelopeCount: request.approvalEnvelopes.length,
    acceptedApprovalCount: acceptedApprovalEnvelopeSha256s.length,
    distinctSignerCount: acceptedApprovalSignerKeyIds.length,
    requiredSignerCount: requiredSignerKeyIds.length,
    approvalEnvelopeSetSha256: sha256(canonicalJson(approvalEnvelopeSha256s)),
    acceptedApprovalEnvelopeSetSha256: sha256(
      canonicalJson(acceptedApprovalEnvelopeSha256s),
    ),
    signerSetSha256: sha256(canonicalJson(acceptedApprovalSignerKeyIds)),
    ...(requiredSignerKeyIds.length > 0
      ? { requiredSignerSetSha256: sha256(canonicalJson(requiredSignerKeyIds)) }
      : {}),
    approvalEnvelopeSha256s,
    acceptedApprovalEnvelopeSha256s,
    acceptedApprovalSignerKeyIds,
    ...(primaryGate
      ? {
          activationDecisionRecordId:
            primaryGate.proposal.activationDecisionRecordId,
          expectedCurrentSelectionSha256:
            primaryGate.proposal.expectedCurrentSelectionSha256,
          proposalEnvelopeSha256: primaryGate.proposalEnvelope.contentSha256,
          proposalSha256: primaryGate.proposal.contentSha256,
          proposalReviewSha256: primaryGate.proposal.rotationReviewSha256,
          currentPreflightSha256: primaryGate.preflight.contentSha256,
          ...(primaryGate.proposal.checkpointRegistryQuorumBaselineSha256
            ? {
                checkpointRegistryQuorumBaselineSha256:
                  primaryGate.proposal.checkpointRegistryQuorumBaselineSha256,
              }
            : {}),
        }
      : {}),
  };
  const review =
    validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
      {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      },
    );
  return { review, acceptedGates };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult(
  policyReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
): ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-apply" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    appliedAt: new Date().toISOString(),
    policyReview,
    policyReviewSha256: policyReview.contentSha256,
    result,
    resultSha256: result.contentSha256,
  };
  return validateApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult(
    {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  );
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate(
  store: LocalStore,
  policyReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  approvalPolicyBaselineSha256: string,
): RotationProposalSubscriptionApprovalPolicyBaselineGateResult {
  const diagnostics: string[] = [];
  if (!/^[a-f0-9]{64}$/.test(approvalPolicyBaselineSha256)) {
    diagnostics.push("approval_policy_baseline_hash_invalid");
  }
  const baseline = store
    .listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines()
    .find(
      (candidate) => candidate.contentSha256 === approvalPolicyBaselineSha256,
    );
  if (!baseline) {
    diagnostics.push("approval_policy_baseline_missing");
  }
  if (policyReview.status !== "accepted") {
    diagnostics.push("approval_policy_review_not_accepted");
  }
  if (baseline) {
    if (baseline.envelope.receipt.status !== "accepted") {
      diagnostics.push("approval_policy_baseline_review_not_accepted");
    }
    if (baseline.approvalPolicySha256 !== policyReview.approvalPolicySha256) {
      diagnostics.push("approval_policy_baseline_policy_mismatch");
    }
    if (baseline.subscriptionSha256 !== policyReview.subscriptionSha256) {
      diagnostics.push("approval_policy_baseline_subscription_mismatch");
    }
    if (
      (baseline.proposalSha256 ?? "") !== (policyReview.proposalSha256 ?? "")
    ) {
      diagnostics.push("approval_policy_baseline_proposal_mismatch");
    }
    if (
      baseline.acceptedApprovalEnvelopeSetSha256 !==
      policyReview.acceptedApprovalEnvelopeSetSha256
    ) {
      diagnostics.push("approval_policy_baseline_approval_set_mismatch");
    }
    if (baseline.signerSetSha256 !== policyReview.signerSetSha256) {
      diagnostics.push("approval_policy_baseline_signer_set_mismatch");
    }
    if (
      (baseline.requiredSignerSetSha256 ?? "") !==
      (policyReview.requiredSignerSetSha256 ?? "")
    ) {
      diagnostics.push("approval_policy_baseline_required_signer_set_mismatch");
    }
  }
  const uniqueDiagnostics = Array.from(new Set(diagnostics));
  if (!baseline || uniqueDiagnostics.length > 0) {
    return { status: "rejected", diagnostics: uniqueDiagnostics };
  }
  return { status: "accepted", baseline, diagnostics: [] };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyQueueResult(
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  policyReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  approvalPolicyBaselineSha256: string,
  applyAfter: string,
): QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult {
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-apply-queue" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    queuedAt: new Date().toISOString(),
    applyAfter,
    subscription,
    subscriptionSha256: subscription.contentSha256,
    policyReview,
    policyReviewSha256: policyReview.contentSha256,
    approvalPolicyBaselineSha256,
    approvalPolicySha256: policyReview.approvalPolicySha256,
    approvalEnvelopeSetSha256: policyReview.approvalEnvelopeSetSha256,
    acceptedApprovalEnvelopeSetSha256:
      policyReview.acceptedApprovalEnvelopeSetSha256,
    signerSetSha256: policyReview.signerSetSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay(
  store: LocalStore,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  request: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay {
  const replayedAt = new Date().toISOString();
  const selectionState =
    store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
  const activeSelection = selectionState.selection;
  const diagnostics: string[] = [];
  const requireMatch = (condition: boolean, diagnostic: string): void => {
    if (!condition) diagnostics.push(diagnostic);
  };

  requireMatch(
    subscription.auditThreadId === request.threadId,
    "subscription_thread_mismatch",
  );
  requireMatch(
    subscription.revision === request.expectedSubscriptionRevision,
    "subscription_revision_mismatch",
  );
  requireMatch(
    subscription.contentSha256 === request.expectedSubscriptionSha256,
    "subscription_hash_mismatch",
  );

  let approvalEnvelope:
    | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>
    | undefined;
  let approval:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval
    | undefined;
  let verification: TrustedReceiptVerification | undefined;
  let approvalVerifierSelection:
    | ReturnType<
        LocalStore["getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256"]
      >
    | undefined;
  try {
    const envelope = validateTrustedReceiptEnvelope(request.approvalEnvelope);
    if (
      envelope.receiptKind !==
      "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
    ) {
      diagnostics.push("approval_receipt_kind_invalid");
    } else {
      approvalEnvelope =
        envelope as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
      approval = approvalEnvelope.receipt;
    }
  } catch {
    diagnostics.push("approval_envelope_invalid");
  }

  if (!activeSelection) {
    diagnostics.push("active_selection_missing");
  }

  if (approval) {
    approvalVerifierSelection =
      approval.expectedCurrentSelectionSha256 === ""
        ? undefined
        : store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256(
            approval.expectedCurrentSelectionSha256,
          );
  }
  if (approval && !approvalVerifierSelection) {
    diagnostics.push("approval_selection_missing");
  }
  if (approvalEnvelope && approvalVerifierSelection) {
    const directoryVerification = store.verifyReceiptTrustAnchorDirectory(
      approvalVerifierSelection.selectedDirectory,
      {
        expectedAnchorSetSha256:
          approvalVerifierSelection.selectedAnchorSetSha256,
      },
    );
    if (directoryVerification.status === "invalid") {
      diagnostics.push("approval_verifier_directory_invalid");
    } else {
      verification = verifyTrustedReceiptEnvelope(
        approvalEnvelope,
        receiptTrustAnchorsFromDirectory(
          approvalVerifierSelection.selectedDirectory,
        ),
      );
      if (verification.status !== "trusted") {
        diagnostics.push(`trusted_receipt_${verification.status}`);
      }
    }
  }

  const discovery = subscription.lastGoodDiscovery;
  const proposalEnvelope = discovery?.envelope;
  const proposal = proposalEnvelope?.receipt;
  if (
    !discovery ||
    discovery.status !== "valid" ||
    !proposalEnvelope ||
    !proposal
  ) {
    diagnostics.push("last_good_proposal_missing");
  }

  if (approval) {
    requireMatch(
      approval.approvedByThreadId === request.threadId,
      "approval_thread_mismatch",
    );
    requireMatch(
      approval.subscriptionId === subscription.id,
      "approval_subscription_id_mismatch",
    );
    requireMatch(
      approval.subscriptionRevision === subscription.revision,
      "approval_subscription_revision_mismatch",
    );
    requireMatch(
      approval.subscriptionSha256 === subscription.contentSha256,
      "approval_subscription_hash_mismatch",
    );
    requireMatch(
      approval.sourceUrlSha256 === subscription.sourceUrlSha256,
      "approval_source_url_hash_mismatch",
    );
    requireMatch(
      approval.sourceOriginSha256 === subscription.sourceOriginSha256,
      "approval_source_origin_hash_mismatch",
    );
    requireMatch(
      approval.policySha256 === subscription.policySha256,
      "approval_policy_hash_mismatch",
    );
    if (discovery) {
      requireMatch(
        approval.discoverySha256 === discovery.contentSha256,
        "approval_discovery_hash_mismatch",
      );
    }
    if (proposalEnvelope && proposal) {
      requireMatch(
        approval.envelopeSha256 === proposalEnvelope.contentSha256,
        "approval_proposal_envelope_hash_mismatch",
      );
      requireMatch(
        approval.proposalSha256 === proposal.contentSha256,
        "approval_proposal_hash_mismatch",
      );
      requireMatch(
        approval.proposalReviewSha256 === proposal.rotationReviewSha256,
        "approval_proposal_review_hash_mismatch",
      );
      requireMatch(
        approval.activationDecisionRecordId ===
          proposal.activationDecisionRecordId,
        "approval_activation_decision_mismatch",
      );
      requireMatch(
        approval.expectedCurrentSelectionSha256 ===
          proposal.expectedCurrentSelectionSha256,
        "approval_expected_selection_mismatch",
      );
      requireMatch(
        (approval.checkpointRegistryQuorumBaselineSha256 ?? "") ===
          (proposal.checkpointRegistryQuorumBaselineSha256 ?? ""),
        "approval_checkpoint_registry_quorum_baseline_hash_mismatch",
      );
      requireMatch(
        approval.proposalSignerKeyId === proposalEnvelope.signature.keyId,
        "approval_proposal_signer_mismatch",
      );
      requireMatch(
        approval.proposalSignedAt === proposalEnvelope.signature.signedAt,
        "approval_proposal_signed_at_mismatch",
      );
    }
    if (
      approval.expiresAt !== undefined &&
      Date.parse(approval.expiresAt) <= Date.now()
    ) {
      diagnostics.push("approval_expired");
    }
  }

  if (approval && activeSelection) {
    requireMatch(
      activeSelection.activationDecisionRecordId ===
        approval.activationDecisionRecordId,
      "active_selection_decision_mismatch",
    );
    requireMatch(
      selectionState.currentSelectionSha256 !==
        approval.expectedCurrentSelectionSha256,
      "active_selection_not_advanced",
    );
  }

  const uniqueDiagnostics = Array.from(new Set(diagnostics));
  const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay["status"] =
    uniqueDiagnostics.length > 0
      ? approvalEnvelope
        ? "divergent"
        : "invalid"
      : "aligned";
  const content = {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-apply-replay" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    replayedAt,
    status,
    diagnostics: uniqueDiagnostics,
    subscriptionId: subscription.id,
    subscriptionRevision: subscription.revision,
    subscriptionSha256: subscription.contentSha256,
    sourceUrlSha256: subscription.sourceUrlSha256,
    sourceOriginSha256: subscription.sourceOriginSha256,
    policySha256: subscription.policySha256,
    expectedSubscriptionRevision: request.expectedSubscriptionRevision,
    expectedSubscriptionSha256: request.expectedSubscriptionSha256,
    currentSelectionSha256: selectionState.currentSelectionSha256,
    selectionStateSha256: selectionState.contentSha256,
    ...(activeSelection
      ? {
          activeSelectionSha256: activeSelection.contentSha256,
          activeActivationDecisionRecordId:
            activeSelection.activationDecisionRecordId,
        }
      : {}),
    ...(approvalVerifierSelection
      ? {
          approvalVerifierSelectionSha256:
            approvalVerifierSelection.contentSha256,
          approvalVerifierDirectorySha256:
            approvalVerifierSelection.selectedDirectorySha256,
        }
      : {}),
    ...(approvalEnvelope
      ? {
          approvalEnvelopeSha256: approvalEnvelope.contentSha256,
          approvalSha256: approvalEnvelope.receipt.contentSha256,
        }
      : {}),
    ...(verification
      ? {
          approvalTrustedReceiptVerificationStatus: verification.status,
          ...(verification.reason
            ? { approvalTrustedReceiptVerificationReason: verification.reason }
            : {}),
          ...(verification.keyId
            ? { approvalTrustedReceiptVerificationKeyId: verification.keyId }
            : {}),
        }
      : {}),
    ...(proposalEnvelope
      ? { proposalEnvelopeSha256: proposalEnvelope.contentSha256 }
      : {}),
    ...(proposal
      ? {
          proposalSha256: proposal.contentSha256,
          proposalReviewSha256: proposal.rotationReviewSha256,
          activationDecisionRecordId: proposal.activationDecisionRecordId,
          expectedCurrentSelectionSha256:
            proposal.expectedCurrentSelectionSha256,
          ...(proposal.checkpointRegistryQuorumBaselineSha256
            ? {
                checkpointRegistryQuorumBaselineSha256:
                  proposal.checkpointRegistryQuorumBaselineSha256,
              }
            : {}),
        }
      : {}),
    ...(approval
      ? { approvalPreflightSha256: approval.approvalPreflightSha256 }
      : {}),
  };
  return validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay(
    {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  );
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
    proposal.selectedSignerSetSha256 ===
      currentProposal.selectedSignerSetSha256,
    "selected_signer_set_mismatch",
  );
  requireMatch(
    proposal.currentCheckpointSha256 ===
      currentProposal.currentCheckpointSha256,
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
