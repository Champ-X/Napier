import { lazy, Suspense } from "react";

import { copy } from "./copy";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyExtensionPackageDesk = lazy(() => import("./ExtensionPackageDesk"));
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export interface ExtensionPublishingSurfaceProps {
  vm: WorkspaceViewModel;
}

export function ExtensionPublishingSurface({
  vm,
}: ExtensionPublishingSurfaceProps) {
  if (!vm.bootstrap) return null;
  return (
    <section
      className="developer-publishing-section"
      aria-labelledby="extension-publishing-title"
    >
      <header>
        <span>{copy.developerWorkbench.extensionPublishingEyebrow}</span>
        <h2 id="extension-publishing-title">
          {copy.developerWorkbench.extensionPublishingTitle}
        </h2>
        <p>{copy.developerWorkbench.extensionPublishingBody}</p>
      </header>
      <Suspense fallback={<div className="context-loading" role="status" />}>
        <LazyExtensionPackageDesk
          anchors={vm.bootstrap.extensionPublisherTrustAnchors}
          extensions={vm.bootstrap.extensions}
          busyId={vm.extensionBusyId}
          receipt={vm.extensionPackageReceipt}
          deploymentPreview={vm.extensionPackageDeploymentPreview}
          rolloutPreview={vm.extensionPackageRolloutPreview}
          rolloutChannels={vm.bootstrap.extensionPackageRolloutChannels}
          updatePreview={vm.extensionPackageUpdatePreview}
          onCreatePublisher={vm.createExtensionPublisher}
          onRevokePublisher={vm.revokeExtensionPublisher}
          onSign={vm.downloadSignedExtensionPackage}
          onVerify={vm.verifySignedExtensionPackageFile}
          onImport={vm.importSignedExtensionPackageFile}
          onExportLockfile={vm.exportExtensionPackageLockfile}
          onDownloadChannelIndex={vm.downloadExtensionPackageChannelIndex}
          onPublishRollout={vm.publishExtensionPackageRolloutChannel}
          onPreviewRollout={vm.previewExtensionPackageRolloutChannel}
          onPreviewUpdate={vm.previewExtensionPackageUpdateFile}
          onApplyUpdate={vm.applyExtensionPackageUpdate}
          onCancelUpdate={vm.cancelExtensionPackageUpdate}
          onPreviewDeployment={vm.previewExtensionPackageDeploymentFiles}
          onApplyDeployment={vm.applyExtensionPackageDeployment}
          onCancelDeployment={vm.cancelExtensionPackageDeployment}
        />
      </Suspense>
    </section>
  );
}
