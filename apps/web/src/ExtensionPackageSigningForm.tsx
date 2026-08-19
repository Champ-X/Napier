import { Download, ShieldCheck } from "lucide-react";

import type {
  ExtensionPackageDependency,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import type { ExtensionPackageSignDraft } from "./extension-package-types";

export interface ExtensionPackageSigningFormProps {
  eligibleExtensions: ExtensionRecord[];
  signingAnchors: ExtensionPublisherTrustAnchor[];
  extensionId: string;
  anchorId: string;
  publisher: string;
  dependenciesText: string;
  expiresAt: string;
  dependencies: ExtensionPackageDependency[] | undefined;
  normalizedExpiry: string | undefined;
  canSign: boolean;
  busyId: string | undefined;
  onExtensionId(value: string): void;
  onAnchorId(value: string): void;
  onPublisher(value: string): void;
  onDependenciesText(value: string): void;
  onExpiresAt(value: string): void;
  onSign(extensionId: string, draft: ExtensionPackageSignDraft): Promise<void>;
}

export function ExtensionPackageSigningForm(
  props: ExtensionPackageSigningFormProps,
) {
  const packageCopy = copy.packages;
  const {
    eligibleExtensions,
    signingAnchors,
    extensionId,
    anchorId,
    publisher,
    dependenciesText,
    expiresAt,
    dependencies,
    normalizedExpiry,
    canSign,
    busyId,
    onSign,
  } = props;
  const setExtensionId = props.onExtensionId;
  const setAnchorId = props.onAnchorId;
  const setPublisher = props.onPublisher;
  const setDependenciesText = props.onDependenciesText;
  const setExpiresAt = props.onExpiresAt;
  return (
    <form
      className="extension-package-sign"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSign) return;
        void onSign(extensionId, {
          trustAnchorId: anchorId,
          publisher: publisher.trim(),
          ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
          ...(normalizedExpiry ? { expiresAt: normalizedExpiry } : {}),
        });
      }}
    >
      <header>
        <div>
          <strong>{packageCopy.signingTitle}</strong>
          <small>{packageCopy.signingBody}</small>
        </div>
        <ShieldCheck size={13} aria-hidden="true" />
      </header>
      <label>
        <span>{packageCopy.extension}</span>
        <select
          value={extensionId}
          disabled={Boolean(busyId) || eligibleExtensions.length === 0}
          onChange={(event) => setExtensionId(event.target.value)}
        >
          {eligibleExtensions.length === 0 ? (
            <option value="">{packageCopy.chooseExtension}</option>
          ) : null}
          {eligibleExtensions.map((extension) => (
            <option value={extension.id} key={extension.id}>
              {extension.name} · {extension.version}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{packageCopy.signingAnchor}</span>
        <select
          value={anchorId}
          disabled={Boolean(busyId) || signingAnchors.length === 0}
          onChange={(event) => setAnchorId(event.target.value)}
        >
          {signingAnchors.length === 0 ? (
            <option value="">{packageCopy.chooseAnchor}</option>
          ) : null}
          {signingAnchors.map((anchor) => (
            <option value={anchor.id} key={anchor.id}>
              {anchor.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{packageCopy.publisher}</span>
        <input
          type="text"
          maxLength={120}
          value={publisher}
          placeholder={packageCopy.publisherPlaceholder}
          onChange={(event) => setPublisher(event.target.value)}
        />
      </label>
      <label>
        <span>{packageCopy.dependencies}</span>
        <textarea
          rows={3}
          maxLength={4_096}
          spellCheck={false}
          value={dependenciesText}
          placeholder={packageCopy.dependenciesPlaceholder}
          aria-describedby="extension-package-dependencies-hint"
          aria-invalid={dependencies === undefined}
          onChange={(event) => setDependenciesText(event.target.value)}
        />
        <small id="extension-package-dependencies-hint">
          {dependencies === undefined
            ? packageCopy.errors.invalidDependency
            : packageCopy.dependenciesHint}
        </small>
      </label>
      <label>
        <span>{packageCopy.expiresAt}</span>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </label>
      <button type="submit" disabled={!canSign}>
        <Download size={11} aria-hidden="true" />
        {busyId === "package:sign"
          ? packageCopy.downloading
          : packageCopy.download}
      </button>
    </form>
  );
}
