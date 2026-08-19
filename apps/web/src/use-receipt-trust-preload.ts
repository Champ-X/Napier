import { useEffect } from "react";

import { formatApiErrorMessage } from "./api-error";
import {
  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines,
  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions,
  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines,
  listReceiptTrustAnchorDirectorySubscriptions,
} from "./receipt-trust-api";
import type { ReceiptTrustControllerState } from "./receipt-trust-controller-types";
import { activateDirectorySubscriptionState } from "./receipt-trust-state-actions";

type UpdateReceiptTrustState = (
  updater: (
    current: ReceiptTrustControllerState,
  ) => ReceiptTrustControllerState,
) => void;

export function useReceiptTrustPreload(
  threadId: string,
  update: UpdateReceiptTrustState,
  setError: (value: string | undefined) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    void loadReceiptTrustState()
      .then((loaded) => {
        if (cancelled) return;
        update((current) => applyLoadedState(current, loaded));
      })
      .catch((caught) => {
        if (!cancelled) setError(formatApiErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [setError, threadId, update]);
}

async function loadReceiptTrustState() {
  const [
    directorySubscriptions,
    promotionBaselines,
    baselineActivationHistory,
    baselineActivationSelectionState,
    baselineActivationSelectionDriftAudit,
    baselineActivationSelectionCheckpoint,
    checkpointSubscriptions,
    checkpointRegistryQuorumBaselines,
  ] = await Promise.all([
    listReceiptTrustAnchorDirectorySubscriptions(),
    listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
    getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(),
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
    listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(),
    listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines(),
  ]);
  return {
    directorySubscriptions,
    promotionBaselines,
    baselineActivationHistory,
    baselineActivationSelectionState,
    baselineActivationSelectionDriftAudit,
    baselineActivationSelectionCheckpoint,
    checkpointSubscriptions,
    checkpointRegistryQuorumBaseline: checkpointRegistryQuorumBaselines.at(-1),
  };
}

function applyLoadedState(
  current: ReceiptTrustControllerState,
  loaded: Awaited<ReturnType<typeof loadReceiptTrustState>>,
): ReceiptTrustControllerState {
  const next = { ...current, ...loaded };
  const active = loaded.directorySubscriptions
    .filter(
      (subscription) =>
        subscription.status === "active" &&
        Boolean(subscription.lastGoodDiscovery?.directory),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .at(0);
  return active ? activateDirectorySubscriptionState(next, active) : next;
}
