import { useState } from "react";
import { Ban, KeyRound, Plus, X } from "lucide-react";

import type {
  CreateExtensionPublisherTrustAnchorSource,
  ExtensionPublisherTrustAnchor,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionPublisherManagementProps {
  anchors: ExtensionPublisherTrustAnchor[];
  busyId: string | undefined;
  onCreatePublisher(draft: {
    label: string;
    source: CreateExtensionPublisherTrustAnchorSource;
  }): Promise<void>;
  onRevokePublisher(anchorId: string): Promise<void>;
}

export function ExtensionPublisherManagement({
  anchors,
  busyId,
  onCreatePublisher,
  onRevokePublisher,
}: ExtensionPublisherManagementProps) {
  const packageCopy = copy.packages;
  const [label, setLabel] = useState("");
  const [sourceType, setSourceType] =
    useState<CreateExtensionPublisherTrustAnchorSource["type"]>("environment");
  const [environmentVariable, setEnvironmentVariable] = useState("");
  const [publicKeySpki, setPublicKeySpki] = useState("");
  const [pendingRevokeId, setPendingRevokeId] = useState<string>();
  const canCreate =
    !busyId &&
    Boolean(label.trim()) &&
    (sourceType === "environment"
      ? /^[A-Z_][A-Z0-9_]{1,127}$/.test(environmentVariable.trim())
      : Boolean(publicKeySpki.trim()));

  async function createPublisher(): Promise<void> {
    if (!canCreate) return;
    try {
      await onCreatePublisher({
        label: label.trim(),
        source:
          sourceType === "environment"
            ? { type: "environment", variable: environmentVariable.trim() }
            : { type: "public_key", publicKeySpki: publicKeySpki.trim() },
      });
      setLabel("");
      setEnvironmentVariable("");
      setPublicKeySpki("");
    } catch {
      // The workspace error banner owns request error presentation.
    }
  }

  async function revokePublisher(anchorId: string): Promise<void> {
    try {
      await onRevokePublisher(anchorId);
      setPendingRevokeId(undefined);
    } catch {
      // The workspace error banner owns request error presentation.
    }
  }
  return (
    <>
      <section
        className="extension-publisher-register"
        aria-labelledby="extension-publishers-title"
      >
        <header>
          <strong id="extension-publishers-title">{packageCopy.anchors}</strong>
          <code>{anchors.length.toString().padStart(2, "0")}</code>
        </header>
        {anchors.length ? (
          <ol>
            {anchors.map((anchor) => (
              <li
                key={anchor.id}
                className={`extension-publisher-key state-${anchor.status}`}
              >
                <span className="extension-publisher-icon" aria-hidden="true">
                  <KeyRound size={11} />
                </span>
                <span>
                  <strong>{anchor.label}</strong>
                  <small>
                    {anchor.signingSource
                      ? packageCopy.signing
                      : packageCopy.verifyOnly}
                  </small>
                  <code title={anchor.keyId}>{anchor.keyId.slice(0, 16)}</code>
                </span>
                <span className="extension-publisher-state">
                  {anchor.status === "trusted"
                    ? packageCopy.trusted
                    : packageCopy.revoked}
                </span>
                {anchor.status === "trusted" ? (
                  pendingRevokeId === anchor.id ? (
                    <span className="extension-publisher-confirm">
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void revokePublisher(anchor.id)}
                      >
                        <Ban size={10} aria-hidden="true" />
                        {packageCopy.confirmRevoke}
                      </button>
                      <button
                        type="button"
                        aria-label={packageCopy.cancel}
                        disabled={Boolean(busyId)}
                        onClick={() => setPendingRevokeId(undefined)}
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => setPendingRevokeId(anchor.id)}
                    >
                      {packageCopy.revoke}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="extension-package-empty">{packageCopy.emptyAnchors}</p>
        )}
      </section>

      <form
        className="extension-publisher-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void createPublisher();
        }}
      >
        <strong>{packageCopy.addPublisher}</strong>
        <label>
          <span>{packageCopy.label}</span>
          <input
            type="text"
            maxLength={100}
            value={label}
            placeholder={packageCopy.labelPlaceholder}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          <span>{packageCopy.source}</span>
          <select
            value={sourceType}
            onChange={(event) =>
              setSourceType(
                event.target
                  .value as CreateExtensionPublisherTrustAnchorSource["type"],
              )
            }
          >
            <option value="environment">{packageCopy.environment}</option>
            <option value="public_key">{packageCopy.publicKey}</option>
          </select>
        </label>
        {sourceType === "environment" ? (
          <label>
            <span>{packageCopy.environmentVariable}</span>
            <input
              type="text"
              spellCheck={false}
              value={environmentVariable}
              placeholder={packageCopy.environmentPlaceholder}
              onChange={(event) =>
                setEnvironmentVariable(event.target.value.toUpperCase())
              }
            />
          </label>
        ) : (
          <label>
            <span>{packageCopy.publicKeySpki}</span>
            <textarea
              rows={3}
              maxLength={4096}
              spellCheck={false}
              value={publicKeySpki}
              placeholder={packageCopy.publicKeyPlaceholder}
              onChange={(event) => setPublicKeySpki(event.target.value)}
            />
          </label>
        )}
        <button type="submit" disabled={!canCreate}>
          <Plus size={11} aria-hidden="true" />
          {busyId === "publisher:new"
            ? packageCopy.addPublisherBusy
            : packageCopy.addPublisher}
        </button>
      </form>
    </>
  );
}
