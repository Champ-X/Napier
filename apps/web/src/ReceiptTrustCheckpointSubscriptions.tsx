import type { ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription } from "@napier/contracts";
import { Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustFileAction } from "./ReceiptTrustFileAction";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustCheckpointSubscriptionsProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustCheckpointSubscriptions({
  controller,
}: ReceiptTrustCheckpointSubscriptionsProps) {
  const { busyId, state } = controller;
  if (!state.checkpointSubscriptions.length) return null;
  return (
    <section className="receipt-trust-subscriptions">
      <header>
        <strong>{copy.lab.trust.checkpointSubscriptions}</strong>
        <span className="receipt-trust-inline-actions">
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void controller.actions.registry.evaluateQuorum()}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {busyId === "evaluate-checkpoint-registry-quorum"
              ? copy.lab.trust.evaluatingCheckpointRegistryQuorum
              : copy.lab.trust.evaluateCheckpointRegistryQuorum}
          </button>
          <button
            type="button"
            disabled={!controller.projection.canPromoteCheckpointRegistryQuorum}
            onClick={() => void controller.actions.registry.promoteBaseline()}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {busyId === "promote-checkpoint-registry-quorum-baseline"
              ? copy.lab.trust.promotingCheckpointRegistryQuorumBaseline
              : copy.lab.trust.promoteCheckpointRegistryQuorumBaseline}
          </button>
        </span>
      </header>
      <ol>
        {state.checkpointSubscriptions.map((subscription) => (
          <CheckpointSubscriptionRow
            key={subscription.id}
            controller={controller}
            subscription={subscription}
          />
        ))}
      </ol>
      <div className="receipt-trust-action-bar">
        <button
          type="button"
          disabled={!state.checkpointRegistryQuorumBaseline || Boolean(busyId)}
          onClick={() => void controller.actions.registry.verifyBaseline()}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busyId === "verify-checkpoint-registry-quorum-baseline"
            ? copy.lab.trust.verifyingCheckpointRegistryQuorumBaseline
            : copy.lab.trust.verifyCheckpointRegistryQuorumBaseline}
        </button>
        <ReceiptTrustFileAction
          disabled={Boolean(busyId)}
          label={
            busyId === "import-checkpoint-registry-quorum-baseline"
              ? copy.lab.trust.importingCheckpointRegistryQuorumBaseline
              : copy.lab.trust.importCheckpointRegistryQuorumBaseline
          }
          onFile={(file) =>
            void controller.actions.registry.importBaselineFile(file)
          }
        />
      </div>
    </section>
  );
}

function CheckpointSubscriptionRow({
  controller,
  subscription,
}: {
  controller: ReceiptTrustController;
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
}) {
  return (
    <li data-status={subscription.status}>
      <span>
        <strong>{subscription.label}</strong>
        <small>
          {copy.lab.trust.subscriptionStatuses[subscription.status]} ·{" "}
          {copy.lab.trust.transparencyTail}
        </small>
      </span>
      <code title={subscription.sourceUrlSha256}>
        {subscription.sourceUrlSha256.slice(0, 12)}
      </code>
      <span className="receipt-trust-inline-actions">
        <button
          type="button"
          disabled={Boolean(controller.busyId)}
          onClick={() => void controller.actions.registry.refresh(subscription)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {copy.lab.trust.refreshCheckpointSubscription}
        </button>
        <button
          type="button"
          aria-label={
            subscription.status === "active"
              ? copy.lab.trust.pauseSubscription
              : copy.lab.trust.resumeSubscription
          }
          disabled={Boolean(controller.busyId)}
          onClick={() => void controller.actions.registry.toggle(subscription)}
        >
          {subscription.status === "active" ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
        </button>
      </span>
    </li>
  );
}
