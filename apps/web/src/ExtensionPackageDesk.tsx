import { useEffect, useMemo, useState } from "react";
import { Package, ShieldCheck } from "lucide-react";

import type {
  ExtensionPackageDeploymentPreview,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import { parsePackageDependencies } from "./extension-package-dependencies";
import ExtensionPackageDeploymentDesk from "./ExtensionPackageDeploymentDesk";
import { ExtensionPackageRolloutManagement } from "./ExtensionPackageRolloutManagement";
import { ExtensionPackageSigningForm } from "./ExtensionPackageSigningForm";
import { ExtensionPackageTransfer } from "./ExtensionPackageTransfer";
import ExtensionPackageUpdateDesk from "./ExtensionPackageUpdateDesk";
import { ExtensionPublisherManagement } from "./ExtensionPublisherManagement";
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

      <ExtensionPublisherManagement
        anchors={anchors}
        busyId={busyId}
        onCreatePublisher={onCreatePublisher}
        onRevokePublisher={onRevokePublisher}
      />

      <ExtensionPackageSigningForm
        eligibleExtensions={eligibleExtensions}
        signingAnchors={signingAnchors}
        extensionId={extensionId}
        anchorId={anchorId}
        publisher={publisher}
        dependenciesText={dependenciesText}
        expiresAt={expiresAt}
        dependencies={dependencies}
        normalizedExpiry={normalizedExpiry}
        canSign={canSign}
        busyId={busyId}
        onExtensionId={setExtensionId}
        onAnchorId={setAnchorId}
        onPublisher={setPublisher}
        onDependenciesText={setDependenciesText}
        onExpiresAt={setExpiresAt}
        onSign={onSign}
      />

      <ExtensionPackageUpdateDesk
        extensions={extensions}
        busyId={busyId}
        preview={updatePreview}
        onPreview={onPreviewUpdate}
        onApply={onApplyUpdate}
        onCancel={onCancelUpdate}
      />

      <ExtensionPackageRolloutManagement
        signingAnchors={signingAnchors}
        rolloutChannels={rolloutChannels}
        rolloutPreview={rolloutPreview}
        rolloutName={rolloutName}
        indexAnchorId={indexAnchorId}
        indexPublisher={indexPublisher}
        canPublishRollout={canPublishRollout}
        canDownloadChannelIndex={canDownloadChannelIndex}
        busyId={busyId}
        onRolloutName={setRolloutName}
        onIndexAnchorId={setIndexAnchorId}
        onIndexPublisher={setIndexPublisher}
        onPublishRollout={publishRollout}
        onPreviewRollout={onPreviewRollout}
        onDownloadChannelIndex={downloadChannelIndex}
      />

      <ExtensionPackageDeploymentDesk
        busyId={busyId}
        preview={deploymentPreview}
        onPreview={onPreviewDeployment}
        onApply={onApplyDeployment}
        onCancel={onCancelDeployment}
      />

      <ExtensionPackageTransfer
        busyId={busyId}
        signedPackageCount={signedPackageCount}
        receipt={receipt}
        onVerify={onVerify}
        onImport={onImport}
        onExportLockfile={onExportLockfile}
      />

      <p className="extension-package-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {packageCopy.signedNotApproved}
      </p>
    </section>
  );
}
