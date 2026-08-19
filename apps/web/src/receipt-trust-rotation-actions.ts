import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  preflightReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation,
  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation,
  signReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
} from "./receipt-trust-api";
import { downloadReceiptTrustJson } from "./receipt-trust-helpers";

export async function reviewActivationSelectionRotation(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const record = context.projection.latestApprovedActivationRecord;
  if (!record || !context.projection.canReviewActivationSelectionRotation)
    return;
  clearRotationEvidence(context, true);
  const review = await context.operation.run(
    "review-activation-selection-rotation",
    () =>
      reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation({
        activationDecisionRecordId: record.id,
        expectedCurrentSelectionSha256:
          context.state.baselineActivationSelectionState
            ?.currentSelectionSha256 ?? "",
        ...(context.state.checkpointSubscriptions.length > 0
          ? { checkpointRegistryQuorumPolicy: {} }
          : {}),
      }),
  );
  if (!review) return;
  context.patch({
    baselineActivationRotationReview: review,
    baselineActivationSelectionDriftAudit: review.driftAudit,
    ...(review.checkpointRegistryQuorum
      ? { checkpointRegistryQuorum: review.checkpointRegistryQuorum }
      : {}),
  });
}

export async function proposeActivationSelectionRotation(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const record = context.projection.latestApprovedActivationRecord;
  if (!record || !context.projection.canReviewActivationSelectionRotation)
    return;
  clearRotationEvidence(context, false);
  const proposal = await context.operation.run(
    "propose-activation-selection-rotation",
    () =>
      proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation({
        activationDecisionRecordId: record.id,
        expectedCurrentSelectionSha256:
          context.state.baselineActivationSelectionState
            ?.currentSelectionSha256 ?? "",
        ...checkpointRegistryBaselineInput(context),
        ...(context.state.checkpointSubscriptions.length > 0
          ? { checkpointRegistryQuorumPolicy: {} }
          : {}),
      }),
  );
  if (!proposal) return;
  context.patch({
    baselineActivationRotationProposal: proposal,
    baselineActivationRotationReview: proposal.rotationReview,
    baselineActivationSelectionDriftAudit: proposal.rotationReview.driftAudit,
    ...(proposal.rotationReview.checkpointRegistryQuorum
      ? {
          checkpointRegistryQuorum:
            proposal.rotationReview.checkpointRegistryQuorum,
        }
      : {}),
  });
}

export async function signActivationSelectionRotationProposal(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const record = context.projection.latestApprovedActivationRecord;
  if (
    !record ||
    !context.projection.canSignActivationSelectionRotationProposal ||
    context.state.baselineActivationRotationProposal?.status !== "proposed"
  )
    return;
  context.patch({
    baselineActivationRotationProposalEnvelope: undefined,
    baselineActivationRotationProposalPreflight: undefined,
  });
  const envelope = await context.operation.run(
    "sign-activation-selection-rotation-proposal",
    () =>
      signReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal({
        threadId: context.props.threadId,
        trustAnchorId: context.props.selectedAnchorId,
        activationDecisionRecordId: record.id,
        expectedCurrentSelectionSha256:
          context.state.baselineActivationSelectionState
            ?.currentSelectionSha256 ?? "",
        ...checkpointRegistryBaselineInput(context),
        ...(context.state.checkpointSubscriptions.length > 0
          ? { checkpointRegistryQuorumPolicy: {} }
          : {}),
      }),
  );
  if (!envelope) return;
  context.patch({
    baselineActivationRotationProposalEnvelope: envelope,
    baselineActivationRotationProposal: envelope.receipt,
  });
  downloadReceiptTrustJson(
    envelope,
    `napier-signed-quorum-activation-selection-rotation-proposal-${envelope.contentSha256.slice(0, 12)}.json`,
  );
}

export async function preflightActivationSelectionRotationProposal(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const record = context.projection.latestApprovedActivationRecord;
  const envelope = context.state.baselineActivationRotationProposalEnvelope;
  if (
    !record ||
    !envelope ||
    !context.projection.canPreflightActivationSelectionRotationProposal
  )
    return;
  context.patch({ baselineActivationRotationProposalPreflight: undefined });
  const preflight = await context.operation.run(
    "preflight-activation-selection-rotation-proposal",
    () =>
      preflightReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal(
        {
          threadId: context.props.threadId,
          activationDecisionRecordId: record.id,
          expectedCurrentSelectionSha256:
            context.state.baselineActivationSelectionState
              ?.currentSelectionSha256 ?? "",
          rotationProposalEnvelope: envelope,
        },
      ),
  );
  if (preflight)
    context.patch({ baselineActivationRotationProposalPreflight: preflight });
}

function checkpointRegistryBaselineInput(context: ReceiptTrustActionContext) {
  const baseline = context.state.checkpointRegistryQuorumBaseline;
  return baseline
    ? {
        checkpointRegistryQuorumBaselineId: baseline.id,
        expectedCheckpointRegistryQuorumBaselineSha256: baseline.contentSha256,
      }
    : {};
}

function clearRotationEvidence(
  context: ReceiptTrustActionContext,
  includeReview: boolean,
): void {
  context.patch({
    ...(includeReview ? { baselineActivationRotationReview: undefined } : {}),
    baselineActivationRotationProposal: undefined,
    baselineActivationRotationProposalEnvelope: undefined,
    baselineActivationRotationProposalPreflight: undefined,
  });
}
