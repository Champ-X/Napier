import { lazy, Suspense } from "react";

import { copy } from "./copy";

type WorkspaceViewModel = ReturnType<
  (typeof import("./use-workspace-view-model"))["useWorkspaceViewModel"]
>;

const LazyExtensionPanel = lazy(() => import("./ExtensionPanel"));

export function ExtensionInspectorSurface({
  vm,
  agentId,
}: {
  vm: WorkspaceViewModel;
  agentId: string;
}) {
  if (vm.inspectorTab !== "extensions" || !vm.bootstrap) return null;
  return (
    <Suspense
      fallback={
        <div className="context-loading" role="status">
          {copy.extensionLoading}
        </div>
      }
    >
      <LazyExtensionPanel
        extensions={vm.bootstrap.extensions}
        plugins={vm.bootstrap.plugins ?? []}
        publisherAnchors={vm.bootstrap.extensionPublisherTrustAnchors}
        agentId={agentId}
        busyId={vm.extensionBusyId}
        packageReceipt={vm.extensionPackageReceipt}
        packageDeploymentPreview={vm.extensionPackageDeploymentPreview}
        packageRolloutPreview={vm.extensionPackageRolloutPreview}
        packageRolloutChannels={vm.bootstrap.extensionPackageRolloutChannels}
        packageUpdatePreview={vm.extensionPackageUpdatePreview}
        onPropose={vm.proposeMcpExtension}
        onReview={(extensionId, action) =>
          void vm.reviewExtensionTrust(extensionId, action)
        }
        onConnect={(extensionId) => void vm.connectMcpExtension(extensionId)}
        onDisconnect={(extensionId) =>
          void vm.disconnectMcpExtension(extensionId)
        }
        onToolReview={(extensionId, toolName, action, effect, routingHint) =>
          void vm.reviewExtensionTool(
            extensionId,
            toolName,
            action,
            effect,
            routingHint,
          )
        }
        onToggle={(extensionId, enabled) =>
          void vm.toggleExtension(extensionId, enabled)
        }
        onCreatePublisher={vm.createExtensionPublisher}
        onRevokePublisher={vm.revokeExtensionPublisher}
        onSignPackage={vm.downloadSignedExtensionPackage}
        onVerifyPackage={vm.verifySignedExtensionPackageFile}
        onImportPackage={vm.importSignedExtensionPackageFile}
        onExportPackageLockfile={vm.exportExtensionPackageLockfile}
        onDownloadPackageChannelIndex={vm.downloadExtensionPackageChannelIndex}
        onPublishPackageRollout={vm.publishExtensionPackageRolloutChannel}
        onPreviewPackageRollout={vm.previewExtensionPackageRolloutChannel}
        onPreviewPackageUpdate={vm.previewExtensionPackageUpdateFile}
        onApplyPackageUpdate={vm.applyExtensionPackageUpdate}
        onCancelPackageUpdate={vm.cancelExtensionPackageUpdate}
        onPreviewPackageDeployment={vm.previewExtensionPackageDeploymentFiles}
        onApplyPackageDeployment={vm.applyExtensionPackageDeployment}
        onCancelPackageDeployment={vm.cancelExtensionPackageDeployment}
      />
    </Suspense>
  );
}
