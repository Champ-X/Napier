import { Download, ShieldCheck } from "lucide-react";

import type {
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPublisherTrustAnchor,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionPackageRolloutManagementProps {
  signingAnchors: ExtensionPublisherTrustAnchor[];
  rolloutChannels: ExtensionPackageRolloutChannel[];
  rolloutPreview: ExtensionPackageRolloutPreview | undefined;
  rolloutName: string;
  indexAnchorId: string;
  indexPublisher: string;
  canPublishRollout: boolean;
  canDownloadChannelIndex: boolean;
  busyId: string | undefined;
  onRolloutName(value: string): void;
  onIndexAnchorId(value: string): void;
  onIndexPublisher(value: string): void;
  onPublishRollout(): Promise<void>;
  onPreviewRollout(channelId: string): Promise<void>;
  onDownloadChannelIndex(): Promise<void>;
}

export function ExtensionPackageRolloutManagement(
  props: ExtensionPackageRolloutManagementProps,
) {
  const packageCopy = copy.packages;
  const {
    signingAnchors,
    rolloutChannels,
    rolloutPreview,
    rolloutName,
    indexAnchorId,
    indexPublisher,
    canPublishRollout,
    canDownloadChannelIndex,
    busyId,
  } = props;
  const setRolloutName = props.onRolloutName;
  const setIndexAnchorId = props.onIndexAnchorId;
  const setIndexPublisher = props.onIndexPublisher;
  const publishRollout = props.onPublishRollout;
  const onPreviewRollout = props.onPreviewRollout;
  const downloadChannelIndex = props.onDownloadChannelIndex;
  return (
    <>
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
                    {channel.packageCount} {packageCopy.rolloutPackageCount} ·{" "}
                    {packageCopy.rolloutRevision} {channel.revision}
                  </small>
                  <code title={channel.lockfileSha256}>
                    {packageCopy.rolloutLockfile}{" "}
                    {channel.lockfileSha256.slice(0, 10)}
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
    </>
  );
}
