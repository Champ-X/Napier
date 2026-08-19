import { Download, Plus, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustCheckpointEvidence } from "./ReceiptTrustCheckpointEvidence";
import { ReceiptTrustCheckpointSubscriptions } from "./ReceiptTrustCheckpointSubscriptions";
import { ReceiptTrustFileAction } from "./ReceiptTrustFileAction";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustCheckpointDeskProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustCheckpointDesk({
  controller,
}: ReceiptTrustCheckpointDeskProps) {
  const { busyId, patch, projection, state } = controller;
  return (
    <section className="receipt-trust-card receipt-trust-checkpoint-desk">
      <header>
        <span>
          <strong>{copy.lab.trust.activationSelectionCheckpoint}</strong>
          <small>{copy.lab.trust.hashOnlyRemoteSource}</small>
        </span>
        <code>
          {state.checkpointSubscriptions.length.toString().padStart(2, "0")}
        </code>
      </header>
      <form
        className="receipt-trust-form receipt-trust-directory-form"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.actions.checkpoint.discover();
        }}
      >
        <label>
          <span>{copy.lab.trust.checkpointSubscriptionLabel}</span>
          <input
            type="text"
            maxLength={100}
            value={state.checkpointSubscriptionLabel}
            placeholder={copy.lab.trust.checkpointSubscriptionLabelPlaceholder}
            onChange={(event) =>
              patch({ checkpointSubscriptionLabel: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>{copy.lab.trust.activationSelectionCheckpointSource}</span>
          <input
            type="url"
            maxLength={2048}
            spellCheck={false}
            value={state.checkpointSourceUrl}
            placeholder={
              copy.lab.trust.activationSelectionCheckpointSourcePlaceholder
            }
            onChange={(event) =>
              patch({ checkpointSourceUrl: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>{copy.lab.trust.expectedActivationSelectionCheckpoint}</span>
          <input
            type="text"
            maxLength={64}
            spellCheck={false}
            value={state.expectedCheckpointSha256}
            placeholder={
              copy.lab.trust.expectedActivationSelectionCheckpointPlaceholder
            }
            onChange={(event) =>
              patch({ expectedCheckpointSha256: event.currentTarget.value })
            }
          />
        </label>
        <span className="receipt-trust-inline-actions">
          <button
            type="submit"
            disabled={!projection.canDiscoverActivationSelectionCheckpoint}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {busyId === "discover-activation-selection-checkpoint"
              ? copy.lab.trust.discoveringActivationSelectionCheckpoint
              : copy.lab.trust.discoverActivationSelectionCheckpoint}
          </button>
          <button
            type="button"
            disabled={!projection.canSubscribeActivationSelectionCheckpoint}
            onClick={() => void controller.actions.registry.subscribe()}
          >
            <Plus size={14} aria-hidden="true" />
            {busyId === "subscribe-activation-selection-checkpoint"
              ? copy.lab.trust.subscribingActivationSelectionCheckpoint
              : copy.lab.trust.subscribeActivationSelectionCheckpoint}
          </button>
        </span>
      </form>
      <CheckpointActions controller={controller} />
      <ReceiptTrustCheckpointSubscriptions controller={controller} />
      <ReceiptTrustCheckpointEvidence controller={controller} />
    </section>
  );
}

function CheckpointActions({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { busyId, projection } = controller;
  return (
    <div className="receipt-trust-action-bar">
      <button
        type="button"
        disabled={Boolean(busyId)}
        onClick={() => void controller.actions.checkpoint.export()}
      >
        <Download size={14} aria-hidden="true" />
        {busyId === "export-activation-selection-checkpoint"
          ? copy.lab.trust.exportingActivationSelectionCheckpoint
          : copy.lab.trust.exportActivationSelectionCheckpoint}
      </button>
      <button
        type="button"
        disabled={!projection.canSignActivationSelectionCheckpoint}
        onClick={() => void controller.actions.checkpoint.sign()}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {busyId === "sign-activation-selection-checkpoint"
          ? copy.lab.trust.signingActivationSelectionCheckpoint
          : copy.lab.trust.signActivationSelectionCheckpoint}
      </button>
      <ReceiptTrustFileAction
        disabled={Boolean(busyId)}
        label={
          busyId === "verify-activation-selection-checkpoint"
            ? copy.lab.trust.verifyingActivationSelectionCheckpoint
            : copy.lab.trust.verifyActivationSelectionCheckpoint
        }
        onFile={(file) => void controller.actions.checkpoint.verifyFile(file)}
      />
    </div>
  );
}
