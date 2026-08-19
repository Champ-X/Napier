import { Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustEvidence } from "./ReceiptTrustEvidence";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustDirectorySubscriptionsProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustDirectorySubscriptions({
  controller,
}: ReceiptTrustDirectorySubscriptionsProps) {
  const { busyId, state } = controller;
  if (!state.directorySubscriptions.length) return null;
  return (
    <section className="receipt-trust-subscriptions">
      <header>
        <strong>{copy.lab.trust.directorySubscriptions}</strong>
        <button
          type="button"
          disabled={Boolean(busyId)}
          aria-busy={busyId === "directory-quorum"}
          onClick={() => void controller.actions.baseline.evaluateQuorum()}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busyId === "directory-quorum"
            ? copy.lab.trust.evaluatingQuorum
            : copy.lab.trust.evaluateQuorum}
        </button>
      </header>
      <ol>
        {state.directorySubscriptions.map((subscription) => {
          const selected =
            state.externalDirectorySubscriptionId === subscription.id;
          return (
            <li key={subscription.id} data-status={subscription.status}>
              <span>
                <strong>{subscription.label}</strong>
                <small>
                  {copy.lab.trust.subscriptionStatuses[subscription.status]} ·{" "}
                  {copy.lab.trust.nextRefresh}{" "}
                  {formatDate(subscription.nextRefreshAt)}
                </small>
              </span>
              <code title={subscription.sourceUrlSha256}>
                {subscription.sourceUrlSha256.slice(0, 12)}
              </code>
              <span className="receipt-trust-inline-actions">
                <button
                  type="button"
                  disabled={
                    Boolean(busyId) ||
                    selected ||
                    !subscription.lastGoodDiscovery?.directory
                  }
                  aria-pressed={selected}
                  onClick={() =>
                    controller.actions.directory.activate(subscription)
                  }
                >
                  <ShieldCheck size={14} aria-hidden="true" />
                  {selected
                    ? copy.lab.trust.subscriptionInUse
                    : copy.lab.trust.useSubscription}
                </button>
                <button
                  type="button"
                  aria-label={copy.lab.trust.refreshSubscription}
                  disabled={Boolean(busyId)}
                  onClick={() =>
                    void controller.actions.directory.refresh(subscription)
                  }
                >
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={
                    subscription.status === "active"
                      ? copy.lab.trust.pauseSubscription
                      : copy.lab.trust.resumeSubscription
                  }
                  disabled={Boolean(busyId)}
                  onClick={() =>
                    void controller.actions.directory.toggle(subscription)
                  }
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
        })}
      </ol>
      <DirectoryQuorumEvidence controller={controller} />
    </section>
  );
}

function DirectoryQuorumEvidence({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const quorum = controller.state.directoryQuorum;
  return (
    <ReceiptTrustEvidence
      title={copy.lab.trust.evaluateQuorum}
      status={quorum ? copy.lab.trust.quorumStatuses[quorum.status] : undefined}
      facts={
        quorum
          ? [
              `${quorum.agreementCount}/${quorum.sourceCount} ${copy.lab.trust.quorumAgreement}`,
              `${quorum.agreementWeight} ${copy.lab.trust.quorumWeight}`,
              `${quorum.agreementMetadataPublisherCount} ${copy.lab.trust.quorumPublishers}`,
            ]
          : []
      }
      value={quorum}
    />
  );
}

function formatDate(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}
