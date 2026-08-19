import { ShieldCheck } from "lucide-react";

import type {
  CreateMcpExtensionRequest,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";
import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import { extensionCopy as copy } from "./extension-copy";
import { ExtensionCard } from "./ExtensionCard";
import ExtensionPackageDesk from "./ExtensionPackageDesk";
import { ExtensionProposalForm } from "./ExtensionProposalForm";
import KernelPluginDesk from "./KernelPluginDesk";
import type {
  ExtensionPackageDeploymentConfirmation,
  ExtensionPackageReceipt,
  ExtensionPackageSignDraft,
  ExtensionPackageUpdateConfirmation,
  ExtensionPublisherDraft,
} from "./extension-package-types";

type Proposal = Omit<CreateMcpExtensionRequest, "threadId">;

export interface ExtensionPanelProps {
  extensions: ExtensionRecord[];
  plugins: KernelPluginInspection[];
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  agentId: string;
  busyId: string | undefined;
  packageReceipt: ExtensionPackageReceipt | undefined;
  packageDeploymentPreview: ExtensionPackageDeploymentPreview | undefined;
  packageRolloutPreview: ExtensionPackageRolloutPreview | undefined;
  packageRolloutChannels: ExtensionPackageRolloutChannel[];
  packageUpdatePreview: ExtensionPackageUpdatePreview | undefined;
  onPropose: (request: Proposal) => Promise<void>;
  onReview: (extensionId: string, action: "approve" | "reject") => void;
  onConnect: (extensionId: string) => void;
  onDisconnect: (extensionId: string) => void;
  onToolReview: (
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ) => void;
  onToggle: (extensionId: string, enabled: boolean) => void;
  onCreatePublisher: (draft: ExtensionPublisherDraft) => Promise<void>;
  onRevokePublisher: (anchorId: string) => Promise<void>;
  onSignPackage: (
    extensionId: string,
    draft: ExtensionPackageSignDraft,
  ) => Promise<void>;
  onVerifyPackage: (file: File) => Promise<void>;
  onImportPackage: (file: File) => Promise<void>;
  onExportPackageLockfile: () => Promise<void>;
  onDownloadPackageChannelIndex: (
    trustAnchorId: string,
    publisher: string,
  ) => Promise<void>;
  onPublishPackageRollout: (name: string) => Promise<void>;
  onPreviewPackageRollout: (channelId: string) => Promise<void>;
  onPreviewPackageUpdate: (extensionId: string, file: File) => Promise<void>;
  onApplyPackageUpdate: (
    confirmation: ExtensionPackageUpdateConfirmation,
  ) => Promise<void>;
  onCancelPackageUpdate: () => void;
  onPreviewPackageDeployment: (files: File[]) => Promise<void>;
  onApplyPackageDeployment: (
    confirmation: ExtensionPackageDeploymentConfirmation,
  ) => Promise<void>;
  onCancelPackageDeployment: () => void;
}

export default function ExtensionPanel({
  extensions,
  plugins,
  publisherAnchors,
  agentId,
  busyId,
  packageReceipt,
  packageDeploymentPreview,
  packageRolloutPreview,
  packageRolloutChannels,
  packageUpdatePreview,
  onPropose,
  onReview,
  onConnect,
  onDisconnect,
  onToolReview,
  onToggle,
  onCreatePublisher,
  onRevokePublisher,
  onSignPackage,
  onVerifyPackage,
  onImportPackage,
  onExportPackageLockfile,
  onDownloadPackageChannelIndex,
  onPublishPackageRollout,
  onPreviewPackageRollout,
  onPreviewPackageUpdate,
  onApplyPackageUpdate,
  onCancelPackageUpdate,
  onPreviewPackageDeployment,
  onApplyPackageDeployment,
  onCancelPackageDeployment,
}: ExtensionPanelProps) {
  const activeTools = extensions.reduce(
    (count, extension) =>
      count +
      extension.tools.filter((tool) => tool.reviewStatus === "approved").length,
    0,
  );
  return (
    <section
      className="panel-section extensions-panel"
      aria-labelledby="extensions-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="extensions-title">{copy.title}</h2>
        </div>
        <span className="extension-count">
          {activeTools} {copy.activeTools}
        </span>
      </div>

      <KernelPluginDesk plugins={plugins} />

      <ExtensionPackageDesk
        anchors={publisherAnchors}
        extensions={extensions}
        busyId={busyId}
        receipt={packageReceipt}
        deploymentPreview={packageDeploymentPreview}
        rolloutPreview={packageRolloutPreview}
        rolloutChannels={packageRolloutChannels}
        updatePreview={packageUpdatePreview}
        onCreatePublisher={onCreatePublisher}
        onRevokePublisher={onRevokePublisher}
        onSign={onSignPackage}
        onVerify={onVerifyPackage}
        onImport={onImportPackage}
        onExportLockfile={onExportPackageLockfile}
        onDownloadChannelIndex={onDownloadPackageChannelIndex}
        onPublishRollout={onPublishPackageRollout}
        onPreviewRollout={onPreviewPackageRollout}
        onPreviewUpdate={onPreviewPackageUpdate}
        onApplyUpdate={onApplyPackageUpdate}
        onCancelUpdate={onCancelPackageUpdate}
        onPreviewDeployment={onPreviewPackageDeployment}
        onApplyDeployment={onApplyPackageDeployment}
        onCancelDeployment={onCancelPackageDeployment}
      />

      <ExtensionProposalForm busyId={busyId} onPropose={onPropose} />

      {extensions.length === 0 ? (
        <p className="empty-panel">{copy.empty}</p>
      ) : null}
      <div className="extension-list">
        {extensions.map((extension) => (
          <ExtensionCard
            key={extension.id}
            extension={extension}
            publisherAnchors={publisherAnchors}
            agentId={agentId}
            busy={busyId === extension.id}
            onReview={onReview}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onToolReview={onToolReview}
            onToggle={onToggle}
          />
        ))}
      </div>
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.safety}
      </p>
    </section>
  );
}
