import type { ReceiptTrustAnchor } from "@napier/contracts";

import {
  qualifyReceiptTrustAnchorDirectoryDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  qualifyReceiptTrustAnchorDirectorySubscriptionRequest,
  projectReceiptTrustDirectoryBaselineActivation,
} from "./receipt-trust-view-model";
import type {
  ReceiptTrustControllerState,
  ReceiptTrustPanelProps,
} from "./receipt-trust-controller-types";

export function projectReceiptTrustController(
  props: ReceiptTrustPanelProps,
  state: ReceiptTrustControllerState,
  busyId: string | undefined,
) {
  const signingAnchor = selectedSigningAnchor(
    props.anchors,
    props.selectedAnchorId,
  );
  const selectedTrustedAnchorKeyId = props.anchors.find(
    (anchor) =>
      anchor.id === props.selectedAnchorId && anchor.status === "trusted",
  )?.keyId;
  const directory = projectDirectory(props, state, busyId);
  const baselineActivation = projectReceiptTrustDirectoryBaselineActivation(
    state.promotionBaselines,
    state.directorySubscriptions,
  );
  const latestApprovedActivationRecord =
    state.baselineActivationHistory?.records
      .filter((record) => record.envelope.receipt.decision === "approved")
      .at(-1);
  const checkpoint = projectCheckpoint(
    props,
    state,
    selectedTrustedAnchorKeyId,
    Boolean(signingAnchor),
    busyId,
  );
  return {
    ...directory,
    ...checkpoint,
    signingAnchor,
    baselineActivation,
    latestBaseline: baselineActivation.latestBaseline,
    latestApprovedActivationRecord,
    canCreate:
      Boolean(state.label.trim()) &&
      (state.sourceType === "environment"
        ? /^[A-Z_][A-Z0-9_]{1,127}$/.test(state.environmentVariable.trim())
        : Boolean(state.publicKeySpki.trim())) &&
      !busyId,
    canSignDirectoryMetadata: Boolean(signingAnchor) && !busyId,
    canSignActivationDecision:
      Boolean(baselineActivation.latestBaseline && signingAnchor) && !busyId,
    canApplyActivationSelection:
      Boolean(latestApprovedActivationRecord) && !busyId,
    canReviewActivationSelectionRotation:
      Boolean(latestApprovedActivationRecord) && !busyId,
    canSignActivationSelectionRotationProposal:
      Boolean(latestApprovedActivationRecord && signingAnchor) &&
      state.baselineActivationRotationProposal?.status === "proposed" &&
      !busyId,
    canPreflightActivationSelectionRotationProposal:
      Boolean(
        latestApprovedActivationRecord &&
        state.baselineActivationRotationProposalEnvelope,
      ) && !busyId,
    canSignActivationSelectionCheckpoint: Boolean(signingAnchor) && !busyId,
  };
}

function projectDirectory(
  props: ReceiptTrustPanelProps,
  state: ReceiptTrustControllerState,
  busyId: string | undefined,
) {
  const discoveryRequest = qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
    state.directorySourceUrl,
    state.expectedAnchorSetSha256,
  );
  const subscriptionRequest =
    qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
      props.threadId,
      state.directorySubscriptionLabel,
      state.directorySourceUrl,
      state.expectedAnchorSetSha256,
    );
  return {
    discoveryRequest,
    subscriptionRequest,
    canDiscover: Boolean(discoveryRequest) && !busyId,
    canSubscribe: Boolean(subscriptionRequest) && !busyId,
  };
}

function projectCheckpoint(
  props: ReceiptTrustPanelProps,
  state: ReceiptTrustControllerState,
  selectedKeyId: string | undefined,
  canSign: boolean,
  busyId: string | undefined,
) {
  const args = [
    state.checkpointSourceUrl,
    state.expectedCheckpointSha256,
    state.baselineActivationSelectionCheckpoint,
    selectedKeyId,
  ] as const;
  const discoveryRequest =
    qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
      ...args,
      state.externalDirectory,
      state.externalDirectoryPolicy,
    );
  const subscriptionRequest =
    qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
      props.threadId,
      state.checkpointSubscriptionLabel,
      ...args,
    );
  return {
    checkpointDiscoveryRequest: discoveryRequest,
    checkpointSubscriptionRequest: subscriptionRequest,
    canDiscoverActivationSelectionCheckpoint:
      Boolean(discoveryRequest) && !busyId,
    canSubscribeActivationSelectionCheckpoint:
      Boolean(subscriptionRequest) && !busyId,
    canPromoteCheckpointRegistryQuorum:
      state.checkpointSubscriptions.length > 0 && canSign && !busyId,
  };
}

function selectedSigningAnchor(
  anchors: ReceiptTrustAnchor[],
  selectedAnchorId: string,
): ReceiptTrustAnchor | undefined {
  return anchors.find(
    (anchor) =>
      anchor.id === selectedAnchorId &&
      anchor.status === "trusted" &&
      Boolean(anchor.signingSource),
  );
}
