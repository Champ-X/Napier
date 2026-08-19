import { Plus, ShieldCheck, X } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustDirectorySubscriptions } from "./ReceiptTrustDirectorySubscriptions";
import { ReceiptTrustEvidence } from "./ReceiptTrustEvidence";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustDirectoryDeskProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustDirectoryDesk({
  controller,
}: ReceiptTrustDirectoryDeskProps) {
  const { busyId, patch, projection, state } = controller;
  return (
    <section className="receipt-trust-card receipt-trust-directory-desk">
      <header>
        <span>
          <strong>{copy.lab.trust.directorySubscriptions}</strong>
          <small>{copy.lab.trust.hashOnlyRemoteSource}</small>
        </span>
        {state.externalDirectory ? (
          <output className="receipt-trust-active-directory">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              <strong>{copy.lab.trust.externalDirectoryReady}</strong>
              <small>
                {state.externalDirectory.trustedCount}{" "}
                {copy.lab.trust.externalTrustedKeys}
              </small>
            </span>
            <button
              type="button"
              aria-label={copy.lab.trust.clearExternalDirectory}
              disabled={Boolean(busyId)}
              onClick={controller.actions.directory.clear}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </output>
        ) : null}
      </header>
      <form
        className="receipt-trust-form receipt-trust-directory-form"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.actions.directory.discover();
        }}
      >
        <label>
          <span>{copy.lab.trust.subscriptionLabel}</span>
          <input
            type="text"
            maxLength={100}
            value={state.directorySubscriptionLabel}
            placeholder={copy.lab.trust.subscriptionLabelPlaceholder}
            onChange={(event) =>
              patch({ directorySubscriptionLabel: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>{copy.lab.trust.directorySource}</span>
          <input
            type="url"
            maxLength={2048}
            spellCheck={false}
            value={state.directorySourceUrl}
            placeholder={copy.lab.trust.directorySourcePlaceholder}
            onChange={(event) =>
              patch({ directorySourceUrl: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>{copy.lab.trust.expectedAnchorSet}</span>
          <input
            type="text"
            maxLength={64}
            spellCheck={false}
            value={state.expectedAnchorSetSha256}
            placeholder={copy.lab.trust.expectedAnchorSetPlaceholder}
            onChange={(event) =>
              patch({ expectedAnchorSetSha256: event.currentTarget.value })
            }
          />
        </label>
        <span className="receipt-trust-inline-actions">
          <button type="submit" disabled={!projection.canDiscover}>
            <ShieldCheck size={14} aria-hidden="true" />
            {busyId === "discover-directory"
              ? copy.lab.trust.discoveringDirectory
              : copy.lab.trust.discoverDirectory}
          </button>
          <button
            type="button"
            disabled={!projection.canSubscribe}
            onClick={() => void controller.actions.directory.subscribe()}
          >
            <Plus size={14} aria-hidden="true" />
            {busyId === "subscribe-directory"
              ? copy.lab.trust.subscribingDirectory
              : copy.lab.trust.subscribeDirectory}
          </button>
        </span>
      </form>
      <ReceiptTrustDirectorySubscriptions controller={controller} />
      <ReceiptTrustEvidence
        title={copy.lab.trust.discoverDirectory}
        status={
          state.directoryDiscovery
            ? copy.lab.trust.directoryDiscoveryStatuses[
                state.directoryDiscovery.status
              ]
            : undefined
        }
        facts={
          state.directoryDiscovery
            ? [state.directoryDiscovery.sourceUrlSha256.slice(0, 12)]
            : []
        }
        value={state.directoryDiscovery}
      />
    </section>
  );
}
