import { setBodyContentSha256Header, setStableContentSha256Header, sha256Json, sha256Text } from "./http-response-evidence.js";
import type { NapierServices } from "./server-composition-root.js";
import type { ApplyExtensionPackageDeploymentResult, ApplyExtensionPackageRolloutChannelResult, ApplyExtensionPackageUpdateResult, ExtensionPackageChannelIndexVerification, ExtensionPackageDeploymentPreview, ExtensionPackageLockfile, ExtensionPackageLockfileVerification, ExtensionPackageRolloutChannel, ExtensionPackageRolloutPreview, ExtensionPackageUpdatePreview, ExtensionPackageVerification, InspectorPackageQualification, InspectorPackageVerification, JsonValue, SignedExtensionPackageChannelIndexEnvelope } from "@napier/contracts";
import { createId } from "@napier/runtime";
import type { Context } from "hono";

export function setInspectorPackageVerificationHeaders(context: Context, verification: InspectorPackageVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Inspector-Package-Status", verification.status);
  context.header("X-Napier-Inspector-Count", String(verification.panelCount));
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Inspector-Package-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

export function setInspectorPackageQualificationHeaders(context: Context, qualification: InspectorPackageQualification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Inspector-Package-Status", qualification.status);
  context.header("X-Napier-Inspector-Package-Verification-Status", qualification.verificationStatus);
  context.header("X-Napier-Inspector-Count", String(qualification.panelCount));
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header("X-Napier-Inspector-Package-Envelope-SHA256", qualification.envelopeSha256);
  }
  if (qualification.inspectorCatalogSha256) {
    context.header("X-Napier-Inspector-Catalog-SHA256", qualification.inspectorCatalogSha256);
  }
  if (qualification.observedInspectorCatalogSha256) {
    context.header("X-Napier-Observed-Inspector-Catalog-SHA256", qualification.observedInspectorCatalogSha256);
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}

export function setExtensionPackageChannelIndexHeaders(context: Context, envelope: SignedExtensionPackageChannelIndexEnvelope, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Index-SHA256", envelope.index.contentSha256);
  context.header("X-Napier-Index-Artifact-SHA256", envelope.signature.indexArtifactSha256);
  context.header("X-Napier-Channel-Count", String(envelope.index.channels.length));
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function setExtensionPackageLockfileHeaders(context: Context, lockfile: ExtensionPackageLockfile, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, lockfile.contentSha256);
  context.header("X-Napier-Package-Count", String(lockfile.packages.length));
  context.header("X-Napier-Extension-Package-Dependency-Count", String(lockfile.packages.reduce((total, entry) => total + entry.dependencies.length, 0)));
  context.header("X-Napier-Extension-Package-Envelope-Set-SHA256", sha256Json(lockfile.packages.map((entry) => entry.envelopeSha256).sort()));
  context.header("X-Napier-Extension-Package-Name-Set-SHA256", sha256Json(lockfile.packages.map((entry) => entry.normalizedName).sort()));
  context.header("X-Napier-Extension-Package-Publisher-Key-Set-SHA256", sha256Json([...new Set(lockfile.packages.map((entry) => entry.keyId))].sort()));
}

export function setExtensionPackageVerificationHeaders(context: Context, verification: ExtensionPackageVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Extension-Package-Status", verification.status);
  context.header("X-Napier-Extension-Package-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Extension-Package-Integrity-Valid", String(verification.integrityValid));
  context.header("X-Napier-Extension-Package-Configuration-Valid", String(verification.configurationValid));
  if (verification.executableValid !== undefined) {
    context.header("X-Napier-Extension-Package-Executable-Valid", String(verification.executableValid));
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Extension-Package-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.transportSha256) {
    context.header("X-Napier-Extension-Package-Transport-SHA256", verification.transportSha256);
  }
}

export function setExtensionPackageDeploymentPreviewHeaders(context: Context, preview: ExtensionPackageDeploymentPreview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Extension-Package-Deployment-SHA256", preview.contentSha256);
  context.header("X-Napier-Extension-Package-Candidate-Count", String(preview.candidateCount));
  context.header("X-Napier-Extension-Package-Install-Count", String(preview.installCount));
  context.header("X-Napier-Extension-Package-Update-Count", String(preview.updateCount));
  context.header("X-Napier-Extension-Package-Dependency-Resolution-Count", String(preview.resolutions.length));
  context.header("X-Napier-Extension-Package-Requires-Publisher-Confirmation", String(preview.requiresPublisherConfirmation));
  context.header("X-Napier-Extension-Package-Requires-Version-Override", String(preview.requiresVersionOverride));
  context.header("X-Napier-Extension-Package-No-Changes", String(preview.noChanges));
}

export function setExtensionPackageDeploymentResultHeaders(context: Context, result: ApplyExtensionPackageDeploymentResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Extension-Package-Deployment-SHA256", result.preview.contentSha256);
  context.header("X-Napier-Extension-Package-Candidate-Count", String(result.preview.candidateCount));
  context.header("X-Napier-Extension-Package-Applied-Extension-Count", String(result.extensions.length));
  context.header("X-Napier-Extension-Package-Installed-Extension-Count", String(result.installedExtensionIds.length));
  context.header("X-Napier-Extension-Package-Updated-Extension-Count", String(result.updatedExtensionIds.length));
  context.header("X-Napier-Extension-Package-No-Changes", String(result.preview.noChanges));
}

export function setExtensionPackageLockfileVerificationHeaders(context: Context, verification: ExtensionPackageLockfileVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Extension-Package-Lockfile-Status", verification.status);
  context.header("X-Napier-Package-Count", String(verification.packageCount));
  context.header("X-Napier-Extension-Package-Envelope-Count", String(verification.packageEnvelopeSha256es.length));
  if (verification.lockfileSha256) {
    context.header("X-Napier-Extension-Package-Lockfile-SHA256", verification.lockfileSha256);
  }
}

export function setExtensionPackageChannelIndexVerificationHeaders(context: Context, verification: ExtensionPackageChannelIndexVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Extension-Package-Channel-Index-Status", verification.status);
  context.header("X-Napier-Channel-Count", String(verification.channelCount));
  if (verification.indexSha256) {
    context.header("X-Napier-Index-SHA256", verification.indexSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Extension-Package-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

export function setExtensionPackageRolloutChannelListHeaders(context: Context, channels: readonly ExtensionPackageRolloutChannel[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, channels);
  context.header("X-Napier-Extension-Package-Rollout-Count", String(channels.length));
  context.header("X-Napier-Extension-Package-Active-Rollout-Count", String(channels.filter((channel) => channel.status === "active").length));
  context.header("X-Napier-Package-Count", String(channels.reduce((total, channel) => total + channel.packageCount, 0)));
  context.header("X-Napier-Extension-Package-Dependency-Count", String(channels.reduce((total, channel) => total + channel.dependencyCount, 0)));
}

export function setExtensionPackageRolloutChannelHeaders(context: Context, channel: ExtensionPackageRolloutChannel): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, channel.contentSha256);
  context.header("X-Napier-Extension-Package-Rollout-Id", channel.id);
  context.header("X-Napier-Extension-Package-Rollout-Status", channel.status);
  context.header("X-Napier-Extension-Package-Rollout-Revision", String(channel.revision));
  context.header("X-Napier-Extension-Package-Lockfile-SHA256", channel.lockfileSha256);
  context.header("X-Napier-Package-Count", String(channel.packageCount));
  context.header("X-Napier-Extension-Package-Dependency-Count", String(channel.dependencyCount));
  context.header("X-Napier-Extension-Package-Envelope-Set-SHA256", channel.packageEnvelopeIdsSha256);
  context.header("X-Napier-Extension-Package-Rollout-Policy-SHA256", sha256Text(JSON.stringify(channel.policy)));
}

export function setExtensionPackageRolloutPreviewHeaders(context: Context, preview: ExtensionPackageRolloutPreview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Extension-Package-Rollout-SHA256", preview.contentSha256);
  context.header("X-Napier-Extension-Package-Rollout-Id", preview.channelId);
  context.header("X-Napier-Extension-Package-Rollout-Revision", String(preview.channelRevision));
  context.header("X-Napier-Extension-Package-Lockfile-SHA256", preview.lockfileSha256);
  context.header("X-Napier-Extension-Package-Lockfile-Status", preview.verification.status);
  context.header("X-Napier-Extension-Package-Deployment-SHA256", preview.deploymentPreview.contentSha256);
  context.header("X-Napier-Extension-Package-Candidate-Count", String(preview.deploymentPreview.candidateCount));
  context.header("X-Napier-Extension-Package-Install-Count", String(preview.deploymentPreview.installCount));
  context.header("X-Napier-Extension-Package-Update-Count", String(preview.deploymentPreview.updateCount));
}

export function setExtensionPackageRolloutApplyResultHeaders(context: Context, result: ApplyExtensionPackageRolloutChannelResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Extension-Package-Rollout-SHA256", result.rolloutPreview.contentSha256);
  context.header("X-Napier-Extension-Package-Deployment-SHA256", result.deployment.preview.contentSha256);
  context.header("X-Napier-Extension-Package-Rollout-Id", result.channel.id);
  context.header("X-Napier-Extension-Package-Rollout-Revision", String(result.channel.revision));
  context.header("X-Napier-Extension-Package-Lockfile-SHA256", result.channel.lockfileSha256);
  context.header("X-Napier-Extension-Package-Applied-Extension-Count", String(result.deployment.extensions.length));
  context.header("X-Napier-Extension-Package-Installed-Extension-Count", String(result.deployment.installedExtensionIds.length));
  context.header("X-Napier-Extension-Package-Updated-Extension-Count", String(result.deployment.updatedExtensionIds.length));
}

export function setExtensionPackageUpdatePreviewHeaders(context: Context, preview: ExtensionPackageUpdatePreview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Extension-Id", preview.extensionId);
  context.header("X-Napier-Extension-Package-Update-SHA256", preview.contentSha256);
  context.header("X-Napier-Extension-Package-Binding-SHA256", preview.expectedPackageBindingSha256);
  context.header("X-Napier-Extension-Package-Current-Manifest-SHA256", preview.current.manifestSha256);
  context.header("X-Napier-Extension-Package-Next-Manifest-SHA256", preview.next.manifestSha256);
  context.header("X-Napier-Extension-Package-Version-Direction", preview.versionDirection);
  context.header("X-Napier-Extension-Package-Requires-Publisher-Confirmation", String(preview.requiresPublisherConfirmation));
  context.header("X-Napier-Extension-Package-Requires-Version-Override", String(preview.requiresVersionOverride));
  context.header("X-Napier-Extension-Package-Change-Count", String(preview.changes.length));
  context.header("X-Napier-Extension-Package-Added-Capability-Count", String(preview.capabilitiesAdded.length));
  context.header("X-Napier-Extension-Package-Removed-Capability-Count", String(preview.capabilitiesRemoved.length));
  context.header("X-Napier-Extension-Package-Tool-Added-Count", String(preview.tools.added.length));
  context.header("X-Napier-Extension-Package-Tool-Removed-Count", String(preview.tools.removed.length));
  context.header("X-Napier-Extension-Package-No-Changes", String(preview.noChanges));
}

export function setExtensionPackageUpdateResultHeaders(context: Context, result: ApplyExtensionPackageUpdateResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Extension-Id", result.extension.id);
  context.header("X-Napier-Extension-Package-Update-SHA256", result.preview.contentSha256);
  context.header("X-Napier-Extension-Package-Binding-SHA256", result.preview.expectedPackageBindingSha256);
  context.header("X-Napier-Extension-Package-Updated", String(result.updated));
  context.header("X-Napier-Extension-Package-Version-Direction", result.preview.versionDirection);
  context.header("X-Napier-Extension-Package-History-Count", String(result.extension.packageHistory?.length ?? 0));
  context.header("X-Napier-Extension-Revision", String(result.extension.revision));
}

export async function appendReceiptTrustEvent(services: NapierServices, threadId: string, type: string, payload: Record<string, JsonValue>): Promise<void> {
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "evaluation",
    visibility: "user",
    payload,
  });
}

export async function appendExtensionEvent(services: NapierServices, threadId: string | undefined, type: string, payload: Record<string, JsonValue>): Promise<void> {
  if (!threadId) return;
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "extension",
    visibility: "user",
    payload,
  });
}
