import { useCallback, useMemo, useState } from "react";

import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import { patchReceiptTrustState } from "./receipt-trust-action-context";
import {
  createTrustAnchor,
  exportTrustDirectory,
  revokeTrustAnchor,
  signTrustDirectoryMetadata,
  verifyTrustDirectoryFile,
  verifyTrustDirectoryMetadataFile,
  verifyTrustedReceiptFile,
} from "./receipt-trust-anchor-actions";
import {
  evaluateDirectoryQuorum,
  importQuorumBaselineFile,
  refreshBaselineActivationHistory,
  signBaselineActivationDecision,
  verifyLatestBaseline,
} from "./receipt-trust-baseline-actions";
import {
  discoverActivationSelectionTransparencyCheckpoint,
  exportActivationSelectionTransparencyCheckpoint,
  signActivationSelectionTransparencyCheckpoint,
  verifyActivationSelectionTransparencyCheckpointFile,
} from "./receipt-trust-checkpoint-actions";
import {
  createCheckpointSubscription,
  evaluateCheckpointRegistryQuorum,
  importCheckpointRegistryQuorumBaselineFile,
  promoteCheckpointRegistryQuorumBaseline,
  refreshCheckpointSubscription,
  toggleCheckpointSubscription,
  verifyCheckpointRegistryQuorumBaseline,
} from "./receipt-trust-checkpoint-registry-actions";
import { projectReceiptTrustController } from "./receipt-trust-controller-projection";
import {
  initialReceiptTrustControllerState,
  type ReceiptTrustControllerState,
  type ReceiptTrustPanelProps,
} from "./receipt-trust-controller-types";
import {
  activateTrustDirectorySubscription,
  clearExternalTrustDirectory,
  createTrustDirectorySubscription,
  discoverTrustDirectory,
  refreshTrustDirectorySubscription,
  toggleTrustDirectorySubscription,
} from "./receipt-trust-directory-actions";
import {
  preflightActivationSelectionRotationProposal,
  proposeActivationSelectionRotation,
  reviewActivationSelectionRotation,
  signActivationSelectionRotationProposal,
} from "./receipt-trust-rotation-actions";
import {
  applyBaselineActivationSelection,
  exportBaselineActivationHistory,
  refreshActivationSelectionDriftAudit,
  verifyBaselineActivationHistoryFile,
} from "./receipt-trust-selection-actions";
import { useReceiptTrustOperation } from "./use-receipt-trust-operation";
import { useReceiptTrustPreload } from "./use-receipt-trust-preload";

export function useReceiptTrustController(props: ReceiptTrustPanelProps) {
  const [state, setState] = useState(initialReceiptTrustControllerState);
  const operation = useReceiptTrustOperation();
  const update = useCallback(
    (
      updater: (
        current: ReceiptTrustControllerState,
      ) => ReceiptTrustControllerState,
    ) => setState(updater),
    [],
  );
  const patch = useCallback(
    (value: Partial<ReceiptTrustControllerState>) =>
      setState((current) => patchReceiptTrustState(current, value)),
    [],
  );
  useReceiptTrustPreload(props.threadId, update, operation.setError);
  const projection = useMemo(
    () => projectReceiptTrustController(props, state, operation.busyId),
    [operation.busyId, props, state],
  );
  const context = useMemo<ReceiptTrustActionContext>(
    () => ({ props, state, projection, operation, patch, update }),
    [operation, patch, projection, props, state, update],
  );
  return {
    state,
    patch,
    busyId: operation.busyId,
    error: operation.error,
    projection,
    actions: buildReceiptTrustActions(context),
  };
}

function buildReceiptTrustActions(context: ReceiptTrustActionContext) {
  return {
    anchor: {
      create: () => createTrustAnchor(context),
      revoke: (anchorId: string) => revokeTrustAnchor(context, anchorId),
      verifyReceiptFile: (file: File | undefined) =>
        verifyTrustedReceiptFile(context, file),
      exportDirectory: () => exportTrustDirectory(context),
      signDirectoryMetadata: () => signTrustDirectoryMetadata(context),
      verifyDirectoryFile: (file: File | undefined) =>
        verifyTrustDirectoryFile(context, file),
      verifyDirectoryMetadataFile: (file: File | undefined) =>
        verifyTrustDirectoryMetadataFile(context, file),
    },
    directory: {
      discover: () => discoverTrustDirectory(context),
      subscribe: () => createTrustDirectorySubscription(context),
      refresh: (
        subscription: Parameters<typeof refreshTrustDirectorySubscription>[1],
      ) => refreshTrustDirectorySubscription(context, subscription),
      toggle: (
        subscription: Parameters<typeof toggleTrustDirectorySubscription>[1],
      ) => toggleTrustDirectorySubscription(context, subscription),
      activate: (
        subscription: Parameters<typeof activateTrustDirectorySubscription>[1],
      ) => activateTrustDirectorySubscription(context, subscription),
      clear: () => clearExternalTrustDirectory(context),
    },
    baseline: {
      evaluateQuorum: () => evaluateDirectoryQuorum(context),
      verifyLatest: () => verifyLatestBaseline(context),
      importFile: (file: File | undefined) =>
        importQuorumBaselineFile(context, file),
      signActivation: () => signBaselineActivationDecision(context),
      refreshHistory: () => refreshBaselineActivationHistory(context),
    },
    rotation: {
      review: () => reviewActivationSelectionRotation(context),
      propose: () => proposeActivationSelectionRotation(context),
      sign: () => signActivationSelectionRotationProposal(context),
      preflight: () => preflightActivationSelectionRotationProposal(context),
    },
    checkpoint: {
      export: () => exportActivationSelectionTransparencyCheckpoint(context),
      verifyFile: (file: File | undefined) =>
        verifyActivationSelectionTransparencyCheckpointFile(context, file),
      sign: () => signActivationSelectionTransparencyCheckpoint(context),
      discover: () =>
        discoverActivationSelectionTransparencyCheckpoint(context),
    },
    registry: {
      subscribe: () => createCheckpointSubscription(context),
      refresh: (
        subscription: Parameters<typeof refreshCheckpointSubscription>[1],
      ) => refreshCheckpointSubscription(context, subscription),
      toggle: (
        subscription: Parameters<typeof toggleCheckpointSubscription>[1],
      ) => toggleCheckpointSubscription(context, subscription),
      evaluateQuorum: () => evaluateCheckpointRegistryQuorum(context),
      promoteBaseline: () => promoteCheckpointRegistryQuorumBaseline(context),
      verifyBaseline: () => verifyCheckpointRegistryQuorumBaseline(context),
      importBaselineFile: (file: File | undefined) =>
        importCheckpointRegistryQuorumBaselineFile(context, file),
    },
    selection: {
      refreshDrift: () => refreshActivationSelectionDriftAudit(context),
      apply: () => applyBaselineActivationSelection(context),
      exportHistory: () => exportBaselineActivationHistory(context),
      verifyHistoryFile: (file: File | undefined) =>
        verifyBaselineActivationHistoryFile(context, file),
    },
  };
}

export type ReceiptTrustController = ReturnType<
  typeof useReceiptTrustController
>;
