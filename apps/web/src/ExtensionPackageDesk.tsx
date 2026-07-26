import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  Check,
  Download,
  KeyRound,
  Package,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import type {
  CreateExtensionPublisherTrustAnchorSource,
  ExtensionPackageDependency,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import ExtensionPackageDeploymentDesk from "./ExtensionPackageDeploymentDesk";
import ExtensionPackageUpdateDesk from "./ExtensionPackageUpdateDesk";
import type {
  ExtensionPackageDeploymentConfirmation,
  ExtensionPackageReceipt,
  ExtensionPackageSignDraft,
  ExtensionPackageUpdateConfirmation,
  ExtensionPublisherDraft,
} from "./extension-package-types";

export default function ExtensionPackageDesk({
  anchors,
  extensions,
  busyId,
  receipt,
  deploymentPreview,
  rolloutPreview,
  rolloutChannels,
  updatePreview,
  onCreatePublisher,
  onRevokePublisher,
  onSign,
  onVerify,
  onImport,
  onExportLockfile,
  onDownloadChannelIndex,
  onPublishRollout,
  onPreviewRollout,
  onPreviewUpdate,
  onApplyUpdate,
  onCancelUpdate,
  onPreviewDeployment,
  onApplyDeployment,
  onCancelDeployment,
}: {
  anchors: ExtensionPublisherTrustAnchor[];
  extensions: ExtensionRecord[];
  busyId: string | undefined;
  receipt: ExtensionPackageReceipt | undefined;
  deploymentPreview: ExtensionPackageDeploymentPreview | undefined;
  rolloutPreview: ExtensionPackageRolloutPreview | undefined;
  rolloutChannels: ExtensionPackageRolloutChannel[];
  updatePreview: ExtensionPackageUpdatePreview | undefined;
  onCreatePublisher: (draft: ExtensionPublisherDraft) => Promise<void>;
  onRevokePublisher: (anchorId: string) => Promise<void>;
  onSign: (
    extensionId: string,
    draft: ExtensionPackageSignDraft,
  ) => Promise<void>;
  onVerify: (file: File) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExportLockfile: () => Promise<void>;
  onDownloadChannelIndex: (
    trustAnchorId: string,
    publisher: string,
  ) => Promise<void>;
  onPublishRollout: (name: string) => Promise<void>;
  onPreviewRollout: (channelId: string) => Promise<void>;
  onPreviewUpdate: (extensionId: string, file: File) => Promise<void>;
  onApplyUpdate: (
    confirmation: ExtensionPackageUpdateConfirmation,
  ) => Promise<void>;
  onCancelUpdate: () => void;
  onPreviewDeployment: (files: File[]) => Promise<void>;
  onApplyDeployment: (
    confirmation: ExtensionPackageDeploymentConfirmation,
  ) => Promise<void>;
  onCancelDeployment: () => void;
}) {
  const [label, setLabel] = useState("");
  const [sourceType, setSourceType] =
    useState<CreateExtensionPublisherTrustAnchorSource["type"]>("environment");
  const [environmentVariable, setEnvironmentVariable] = useState("");
  const [publicKeySpki, setPublicKeySpki] = useState("");
  const [pendingRevokeId, setPendingRevokeId] = useState<string>();
  const [extensionId, setExtensionId] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [publisher, setPublisher] = useState("");
  const [dependenciesText, setDependenciesText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [rolloutName, setRolloutName] = useState("stable");
  const [indexAnchorId, setIndexAnchorId] = useState("");
  const [indexPublisher, setIndexPublisher] = useState(
    "Napier Channel Registry",
  );
  const packageCopy = copy.packages;

  const eligibleExtensions = useMemo(
    () =>
      extensions.filter(
        (extension) =>
          extension.connection.status === "ready" &&
          extension.tools.length > 0 &&
          extension.tools.every(
            (tool) =>
              tool.reviewStatus === "approved" &&
              (tool.effect === "read" || tool.effect === "write"),
          ),
      ),
    [extensions],
  );
  const signingAnchors = useMemo(
    () =>
      anchors.filter(
        (anchor) =>
          anchor.status === "trusted" && Boolean(anchor.signingSource),
      ),
    [anchors],
  );
  const signedPackageCount = useMemo(
    () => extensions.filter((extension) => extension.packageBinding).length,
    [extensions],
  );

  useEffect(() => {
    if (!eligibleExtensions.some((extension) => extension.id === extensionId)) {
      setExtensionId(eligibleExtensions[0]?.id ?? "");
    }
  }, [eligibleExtensions, extensionId]);

  useEffect(() => {
    if (!signingAnchors.some((anchor) => anchor.id === anchorId)) {
      setAnchorId(signingAnchors[0]?.id ?? "");
    }
  }, [anchorId, signingAnchors]);

  useEffect(() => {
    if (!signingAnchors.some((anchor) => anchor.id === indexAnchorId)) {
      setIndexAnchorId(signingAnchors[0]?.id ?? "");
    }
  }, [indexAnchorId, signingAnchors]);

  const canCreate =
    !busyId &&
    Boolean(label.trim()) &&
    (sourceType === "environment"
      ? /^[A-Z_][A-Z0-9_]{1,127}$/.test(environmentVariable.trim())
      : Boolean(publicKeySpki.trim()));
  const expiryTimestamp = expiresAt ? Date.parse(expiresAt) : undefined;
  const normalizedExpiry =
    expiryTimestamp !== undefined && Number.isFinite(expiryTimestamp)
      ? new Date(expiryTimestamp).toISOString()
      : undefined;
  const dependencies = parsePackageDependencies(dependenciesText);
  const canSign =
    !busyId &&
    Boolean(extensionId) &&
    Boolean(anchorId) &&
    Boolean(publisher.trim()) &&
    dependencies !== undefined &&
    (!expiresAt || Boolean(normalizedExpiry));
  const canPublishRollout =
    !busyId && signedPackageCount > 0 && Boolean(rolloutName.trim());
  const canDownloadChannelIndex =
    !busyId &&
    rolloutChannels.length > 0 &&
    Boolean(indexAnchorId) &&
    Boolean(indexPublisher.trim());

  async function createPublisher(): Promise<void> {
    if (!canCreate) return;
    const draft: ExtensionPublisherDraft = {
      label: label.trim(),
      source:
        sourceType === "environment"
          ? {
              type: "environment",
              variable: environmentVariable.trim(),
            }
          : { type: "public_key", publicKeySpki: publicKeySpki.trim() },
    };
    try {
      await onCreatePublisher(draft);
      setLabel("");
      setEnvironmentVariable("");
      setPublicKeySpki("");
    } catch {
      // The workspace error banner owns request error presentation.
    }
  }

  async function revokePublisher(anchorIdToRevoke: string): Promise<void> {
    try {
      await onRevokePublisher(anchorIdToRevoke);
      setPendingRevokeId(undefined);
    } catch {
      // The workspace error banner owns request error presentation.
    }
  }

  async function publishRollout(): Promise<void> {
    if (!canPublishRollout) return;
    await onPublishRollout(rolloutName.trim());
  }

  async function downloadChannelIndex(): Promise<void> {
    if (!canDownloadChannelIndex) return;
    await onDownloadChannelIndex(indexAnchorId, indexPublisher.trim());
  }

  return (
    <section
      className="extension-package-desk"
      aria-labelledby="extension-package-title"
    >
      <header>
        <div>
          <span>{packageCopy.eyebrow}</span>
          <h3 id="extension-package-title">{packageCopy.title}</h3>
        </div>
        <Package size={16} aria-hidden="true" />
      </header>
      <p>{packageCopy.body}</p>

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

      <form
        className="extension-package-sign"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSign) return;
          void onSign(extensionId, {
            trustAnchorId: anchorId,
            publisher: publisher.trim(),
            ...(dependencies && dependencies.length > 0
              ? { dependencies }
              : {}),
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

      <ExtensionPackageUpdateDesk
        extensions={extensions}
        busyId={busyId}
        preview={updatePreview}
        onPreview={onPreviewUpdate}
        onApply={onApplyUpdate}
        onCancel={onCancelUpdate}
      />

      <section className="extension-package-rollout">
        <header>
          <div>
            <strong>{packageCopy.rolloutTitle}</strong>
            <small>{packageCopy.rolloutBody}</small>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void publishRollout();
          }}
        >
          <label>
            <span>{packageCopy.rolloutName}</span>
            <input
              maxLength={80}
              value={rolloutName}
              placeholder={packageCopy.rolloutNamePlaceholder}
              onChange={(event) => setRolloutName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!canPublishRollout}>
            <ShieldCheck size={11} aria-hidden="true" />
            {busyId === "package:rollout-publish"
              ? packageCopy.publishingRollout
              : packageCopy.publishRollout}
          </button>
        </form>
        {rolloutChannels.length > 0 ? (
          <ol className="extension-package-rollout-list">
            {rolloutChannels.map((channel) => (
              <li
                key={channel.id}
                className={
                  rolloutPreview?.channelId === channel.id ? "is-active" : ""
                }
              >
                <span>
                  <strong>{channel.name}</strong>
                  <small>
                    {channel.packageCount} packages · revision{" "}
                    {channel.revision}
                  </small>
                  <code title={channel.lockfileSha256}>
                    lockfile {channel.lockfileSha256.slice(0, 10)}
                  </code>
                </span>
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void onPreviewRollout(channel.id)}
                >
                  {busyId === `package:rollout-preview:${channel.id}`
                    ? packageCopy.previewingRollout
                    : packageCopy.previewRollout}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="extension-package-empty">{packageCopy.rolloutEmpty}</p>
        )}
        <p className="extension-package-rollout-policy">
          {packageCopy.rolloutPolicy}
        </p>
      </section>

      <section className="extension-package-channel-index">
        <header>
          <div>
            <strong>{packageCopy.channelIndexTitle}</strong>
            <small>{packageCopy.channelIndexBody}</small>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void downloadChannelIndex();
          }}
        >
          <label>
            <span>{packageCopy.channelIndexAnchor}</span>
            <select
              value={indexAnchorId}
              disabled={Boolean(busyId) || signingAnchors.length === 0}
              onChange={(event) => setIndexAnchorId(event.target.value)}
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
            <span>{packageCopy.channelIndexPublisher}</span>
            <input
              maxLength={120}
              value={indexPublisher}
              placeholder={packageCopy.channelIndexPublisherPlaceholder}
              onChange={(event) => setIndexPublisher(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!canDownloadChannelIndex}>
            <Download size={11} aria-hidden="true" />
            {busyId === "package:channel-index-sign"
              ? packageCopy.signingChannelIndex
              : packageCopy.signChannelIndex}
          </button>
        </form>
      </section>

      <ExtensionPackageDeploymentDesk
        busyId={busyId}
        preview={deploymentPreview}
        onPreview={onPreviewDeployment}
        onApply={onApplyDeployment}
        onCancel={onCancelDeployment}
      />

      <section className="extension-package-transfer">
        <header>
          <div>
            <strong>{packageCopy.transferTitle}</strong>
            <small>{packageCopy.transferBody}</small>
          </div>
        </header>
        <div>
          <PackageFileAction
            label={
              busyId === "package:verify"
                ? packageCopy.verifying
                : packageCopy.verify
            }
            disabled={Boolean(busyId)}
            icon={<Check size={11} aria-hidden="true" />}
            onFile={onVerify}
          />
          <PackageFileAction
            label={
              busyId === "package:import"
                ? packageCopy.importing
                : packageCopy.import
            }
            disabled={Boolean(busyId)}
            icon={<Upload size={11} aria-hidden="true" />}
            onFile={onImport}
          />
          <button
            type="button"
            disabled={Boolean(busyId) || signedPackageCount === 0}
            onClick={() => void onExportLockfile()}
          >
            <Download size={11} aria-hidden="true" />
            {busyId === "package:lockfile-export"
              ? packageCopy.exportingLockfile
              : packageCopy.exportLockfile}
          </button>
        </div>
        {receipt ? (
          <output
            className={`extension-package-receipt verification-${receipt.status}`}
            aria-live="polite"
          >
            <ShieldCheck size={12} aria-hidden="true" />
            <span>
              <strong>
                {packageCopy.actions[receipt.action]} ·{" "}
                {packageCopy.verificationStatuses[receipt.status]}
              </strong>
              <small>{receipt.reason}</small>
            </span>
            <span className="extension-package-receipt-hashes">
              {receipt.keyId ? (
                <code title={receipt.keyId}>
                  key {receipt.keyId.slice(0, 12)}
                </code>
              ) : null}
              {receipt.manifestSha256 ? (
                <code title={receipt.manifestSha256}>
                  manifest {receipt.manifestSha256.slice(0, 12)}
                </code>
              ) : null}
              {receipt.envelopeSha256 ? (
                <code title={receipt.envelopeSha256}>
                  {receipt.action.startsWith("channel_index")
                    ? "index envelope"
                    : receipt.action.startsWith("lockfile") ||
                        receipt.action.startsWith("rollout")
                      ? "lockfile"
                      : "envelope"}{" "}
                  {receipt.envelopeSha256.slice(0, 12)}
                </code>
              ) : null}
              {receipt.indexSha256 ? (
                <code title={receipt.indexSha256}>
                  index {receipt.indexSha256.slice(0, 12)}
                </code>
              ) : null}
              {receipt.channelCount !== undefined ? (
                <code>{receipt.channelCount} channels</code>
              ) : null}
            </span>
          </output>
        ) : null}
      </section>

      <p className="extension-package-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {packageCopy.signedNotApproved}
      </p>
    </section>
  );
}

function parsePackageDependencies(
  value: string,
): ExtensionPackageDependency[] | undefined {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > 32) return undefined;
  const dependencies: ExtensionPackageDependency[] = [];
  const names = new Set<string>();
  for (const line of lines) {
    const separator = line.indexOf("@");
    const normalizedName = line.slice(0, separator);
    const versionRange = line.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(normalizedName) ||
      !versionRange ||
      versionRange.length > 120 ||
      names.has(normalizedName)
    ) {
      return undefined;
    }
    names.add(normalizedName);
    dependencies.push({ normalizedName, versionRange });
  }
  return dependencies.sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName),
  );
}

function PackageFileAction({
  label,
  disabled,
  icon,
  onFile,
}: {
  label: string;
  disabled: boolean;
  icon: ReactNode;
  onFile: (file: File) => Promise<void>;
}) {
  return (
    <label aria-disabled={disabled}>
      {icon}
      <span>{label}</span>
      <input
        type="file"
        accept="application/json,.json"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </label>
  );
}
