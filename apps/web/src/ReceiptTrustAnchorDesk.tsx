import type { CreateReceiptTrustAnchorSource } from "@napier/contracts";
import { Ban, Plus, X } from "lucide-react";

import { copy } from "./copy";
import type { ReceiptTrustPanelProps } from "./receipt-trust-controller-types";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustAnchorDeskProps {
  controller: ReceiptTrustController;
  panel: ReceiptTrustPanelProps;
}

export function ReceiptTrustAnchorDesk({
  controller,
  panel,
}: ReceiptTrustAnchorDeskProps) {
  const { busyId, patch, projection, state } = controller;
  return (
    <section className="receipt-trust-card receipt-trust-anchor-desk">
      <header>
        <strong>{copy.lab.trust.anchors}</strong>
        <code>{panel.anchors.length.toString().padStart(2, "0")}</code>
      </header>
      {panel.anchors.length ? (
        <ol className="receipt-trust-anchor-list">
          {panel.anchors.map((anchor) => (
            <li key={anchor.id} data-status={anchor.status}>
              <label>
                <input
                  type="radio"
                  name="receipt-signing-anchor"
                  checked={panel.selectedAnchorId === anchor.id}
                  disabled={
                    !anchor.signingSource || anchor.status !== "trusted"
                  }
                  onChange={() => panel.onSelect(anchor.id)}
                />
                <span>
                  <strong>{anchor.label}</strong>
                  <small>
                    {anchor.signingSource
                      ? copy.lab.trust.signing
                      : copy.lab.trust.verifyOnly}
                  </small>
                </span>
              </label>
              <code title={anchor.keyId}>{anchor.keyId.slice(0, 16)}</code>
              <mark>{copy.lab.trust.statuses[anchor.status]}</mark>
              {anchor.status === "trusted" ? (
                <RevokeAnchorControl
                  anchorId={anchor.id}
                  controller={controller}
                />
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="receipt-trust-empty-state">{copy.lab.trust.empty}</p>
      )}
      <form
        className="receipt-trust-form"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.actions.anchor.create();
        }}
      >
        <strong>{copy.lab.trust.add}</strong>
        <label>
          <span>{copy.lab.trust.label}</span>
          <input
            type="text"
            maxLength={100}
            value={state.label}
            placeholder={copy.lab.trust.labelPlaceholder}
            onChange={(event) => patch({ label: event.currentTarget.value })}
          />
        </label>
        <label>
          <span>{copy.lab.trust.source}</span>
          <select
            value={state.sourceType}
            onChange={(event) =>
              patch({
                sourceType: event.currentTarget
                  .value as CreateReceiptTrustAnchorSource["type"],
              })
            }
          >
            <option value="environment">{copy.lab.trust.environment}</option>
            <option value="public_key">{copy.lab.trust.publicKey}</option>
          </select>
        </label>
        <AnchorSourceField controller={controller} />
        <button
          className="receipt-trust-primary-action"
          type="submit"
          disabled={!projection.canCreate}
          aria-busy={busyId === "create"}
        >
          <Plus size={15} aria-hidden="true" />
          {busyId === "create" ? copy.lab.trust.adding : copy.lab.trust.add}
        </button>
      </form>
    </section>
  );
}

function RevokeAnchorControl({
  anchorId,
  controller,
}: {
  anchorId: string;
  controller: ReceiptTrustController;
}) {
  const pending = controller.state.pendingRevokeId === anchorId;
  return pending ? (
    <span className="receipt-trust-inline-actions">
      <button
        type="button"
        disabled={Boolean(controller.busyId)}
        onClick={() => void controller.actions.anchor.revoke(anchorId)}
      >
        <Ban size={14} aria-hidden="true" />
        {copy.lab.trust.confirmRevoke}
      </button>
      <button
        type="button"
        aria-label={copy.lab.trust.cancel}
        disabled={Boolean(controller.busyId)}
        onClick={() => controller.patch({ pendingRevokeId: undefined })}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  ) : (
    <button
      type="button"
      disabled={Boolean(controller.busyId)}
      onClick={() => controller.patch({ pendingRevokeId: anchorId })}
    >
      {copy.lab.trust.revoke}
    </button>
  );
}

function AnchorSourceField({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { patch, state } = controller;
  return state.sourceType === "environment" ? (
    <label>
      <span>{copy.lab.trust.environmentVariable}</span>
      <input
        type="text"
        spellCheck={false}
        value={state.environmentVariable}
        placeholder={copy.lab.trust.environmentVariablePlaceholder}
        onChange={(event) =>
          patch({
            environmentVariable: event.currentTarget.value.toUpperCase(),
          })
        }
      />
    </label>
  ) : (
    <label>
      <span>{copy.lab.trust.publicKeySpki}</span>
      <textarea
        rows={3}
        maxLength={4096}
        spellCheck={false}
        value={state.publicKeySpki}
        placeholder={copy.lab.trust.publicKeyPlaceholder}
        onChange={(event) =>
          patch({ publicKeySpki: event.currentTarget.value })
        }
      />
    </label>
  );
}
