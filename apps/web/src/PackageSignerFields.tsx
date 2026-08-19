import type { ExtensionPublisherTrustAnchor } from "@napier/contracts";

import "./package-management.css";

export interface PackageSignerFieldsProps {
  anchors: ExtensionPublisherTrustAnchor[];
  busy: boolean;
  noSignerLabel: string;
  onAnchor: (value: string) => void;
  onPublisher: (value: string) => void;
  publisher: string;
  publisherLabel: string;
  selectedAnchorId: string;
  signerLabel: string;
}

export function PackageSignerFields({
  anchors,
  busy,
  noSignerLabel,
  onAnchor,
  onPublisher,
  publisher,
  publisherLabel,
  selectedAnchorId,
  signerLabel,
}: PackageSignerFieldsProps) {
  return (
    <div className="package-field-grid">
      <label className="context-field">
        <span>{publisherLabel}</span>
        <input
          maxLength={120}
          value={publisher}
          disabled={busy}
          onChange={(event) => onPublisher(event.target.value)}
        />
      </label>
      <label className="context-field">
        <span>{signerLabel}</span>
        <select
          value={selectedAnchorId}
          disabled={busy || anchors.length === 0}
          onChange={(event) => onAnchor(event.target.value)}
        >
          {anchors.length === 0 ? (
            <option value="">{noSignerLabel}</option>
          ) : (
            anchors.map((anchor) => (
              <option key={anchor.id} value={anchor.id}>
                {anchor.label} · {anchor.keyId.slice(0, 10)}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}
