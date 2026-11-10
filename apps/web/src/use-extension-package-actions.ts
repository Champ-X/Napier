import { useCallback, useState } from "react";

import type {
  ExtensionPackageDeploymentPreview,
  ExtensionPackageLockfile,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionRecord,
  SignedExtensionPackageChannelIndexEnvelope,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import {
  applyExtensionPackageDeployment as applyExtensionPackageDeploymentApi,
  applyExtensionPackageRolloutChannel as applyExtensionPackageRolloutChannelApi,
  applyExtensionPackageUpdate as applyExtensionPackageUpdateApi,
  exportExtensionPackageLockfile as exportExtensionPackageLockfileApi,
  getThread,
  importSignedExtensionPackage as importSignedExtensionPackageApi,
  previewExtensionPackageDeployment as previewExtensionPackageDeploymentApi,
  previewExtensionPackageRolloutChannel as previewExtensionPackageRolloutChannelApi,
  previewExtensionPackageUpdate as previewExtensionPackageUpdateApi,
  publishExtensionPackageRolloutChannel as publishExtensionPackageRolloutChannelApi,
  signExtensionPackageChannelIndex as signExtensionPackageChannelIndexApi,
  signExtensionPackage as signExtensionPackageApi,
  verifyExtensionPackageChannelIndex as verifyExtensionPackageChannelIndexApi,
  verifyExtensionPackageLockfile as verifyExtensionPackageLockfileApi,
  verifySignedExtensionPackage as verifySignedExtensionPackageApi,
  type WebThreadDetail,
} from "./api";
import { formatApiErrorMessage } from "./api-error";
import { signedExtensionPackageFilename } from "./extension-package-artifact-view-model";
import type {
  ExtensionPackageDeploymentConfirmation,
  ExtensionPackageReceipt,
  ExtensionPackageSignDraft,
  ExtensionPackageUpdateConfirmation,
} from "./extension-package-types";
import { extensionCopy } from "./extension-copy";

const MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILES = 8;
const MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EXTENSION_PACKAGE_LOCKFILE_FILE_BYTES =
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES + 256 * 1024;
const MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_FILE_BYTES = 1 * 1024 * 1024;

interface ExtensionPackageActionDependencies {
  detail: WebThreadDetail | undefined;
  bootstrap: LiveReadyBootstrapResponse | undefined;
  setError(message: string | undefined): void;
  setExtensionBusyId(busyId: string | undefined): void;
  commitExtension(extension: ExtensionRecord): Promise<void>;
  commitRefreshedThreadDetail(threadId: string, detail: WebThreadDetail): void;
  refreshExtensionWorkspace(): Promise<void>;
}

export function useExtensionPackageActions({
  detail,
  bootstrap,
  setError,
  setExtensionBusyId,
  commitExtension,
  commitRefreshedThreadDetail,
  refreshExtensionWorkspace,
}: ExtensionPackageActionDependencies) {
  const [extensionPackageReceipt, setExtensionPackageReceipt] =
    useState<ExtensionPackageReceipt>();
  const [extensionPackageUpdatePreview, setExtensionPackageUpdatePreview] =
    useState<ExtensionPackageUpdatePreview>();
  const [extensionPackageUpdateEnvelope, setExtensionPackageUpdateEnvelope] =
    useState<unknown>();
  const [
    extensionPackageDeploymentPreview,
    setExtensionPackageDeploymentPreview,
  ] = useState<ExtensionPackageDeploymentPreview>();
  const [extensionPackageRolloutPreview, setExtensionPackageRolloutPreview] =
    useState<ExtensionPackageRolloutPreview>();
  const [
    extensionPackageDeploymentEnvelopes,
    setExtensionPackageDeploymentEnvelopes,
  ] = useState<unknown[]>();

  const clearExtensionPackagePreviews = useCallback((): void => {
    setExtensionPackageUpdatePreview(undefined);
    setExtensionPackageUpdateEnvelope(undefined);
    setExtensionPackageDeploymentPreview(undefined);
    setExtensionPackageDeploymentEnvelopes(undefined);
  }, []);

  const downloadSignedExtensionPackage = useCallback(
    async (
      extensionId: string,
      draft: ExtensionPackageSignDraft,
    ): Promise<void> => {
      if (!detail || !bootstrap) return;
      setExtensionBusyId("package:sign");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = await signExtensionPackageApi(extensionId, {
          threadId: detail.thread.id,
          trustAnchorId: draft.trustAnchorId,
          publisher: draft.publisher,
          ...(draft.dependencies ? { dependencies: draft.dependencies } : {}),
          ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
        });
        const normalizedName =
          bootstrap.extensions.find((extension) => extension.id === extensionId)
            ?.normalizedName ?? extensionId;
        downloadJson(
          envelope,
          signedExtensionPackageFilename(normalizedName, envelope),
        );
        setExtensionPackageReceipt({
          action: "signed",
          status: "trusted",
          reason: extensionCopy.packages.signedNotApproved,
          extensionId,
          packageName: envelope.manifest.name,
          packageVersion: envelope.manifest.version,
          keyId: envelope.signature.keyId,
          manifestSha256: envelope.manifest.contentSha256,
          envelopeSha256: envelope.contentSha256,
        });
        const refreshed = await getThread(detail.thread.id);
        commitRefreshedThreadDetail(detail.thread.id, refreshed);
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [bootstrap, commitRefreshedThreadDetail, detail],
  );

  const verifySignedExtensionPackageFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_EXTENSION_PACKAGE_LOCKFILE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.lockfileTooLarge);
        return;
      }
      setExtensionBusyId("package:verify");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const artifact = JSON.parse(await file.text()) as unknown;
        if (isExtensionPackageLockfile(artifact)) {
          const verification = await verifyExtensionPackageLockfileApi({
            lockfile: artifact,
          });
          setExtensionPackageReceipt({
            action: "lockfile_verified",
            status: verification.status,
            reason:
              verification.status === "trusted"
                ? extensionCopy.packages.lockfileVerified
                : verification.reason,
            ...(verification.lockfileSha256
              ? { envelopeSha256: verification.lockfileSha256 }
              : {}),
          });
          return;
        }
        if (isSignedExtensionPackageChannelIndexEnvelope(artifact)) {
          if (file.size > MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_FILE_BYTES) {
            setError(extensionCopy.packages.errors.channelIndexTooLarge);
            return;
          }
          const verification = await verifyExtensionPackageChannelIndexApi({
            envelope: artifact,
          });
          setExtensionPackageReceipt({
            action: "channel_index_verified",
            status: verification.status,
            reason:
              verification.status === "trusted"
                ? extensionCopy.packages.channelIndexVerified
                : verification.reason,
            ...(verification.keyId ? { keyId: verification.keyId } : {}),
            ...(verification.indexSha256
              ? { indexSha256: verification.indexSha256 }
              : {}),
            ...(verification.envelopeSha256
              ? { envelopeSha256: verification.envelopeSha256 }
              : {}),
            channelCount: verification.channelCount,
          });
          return;
        }
        if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
          setError(extensionCopy.packages.errors.tooLarge);
          return;
        }
        const verification = await verifySignedExtensionPackageApi({
          envelope: artifact,
        });
        setExtensionPackageReceipt({
          action: "verified",
          status: verification.status,
          reason: verification.reason,
          ...(verification.packageName
            ? { packageName: verification.packageName }
            : {}),
          ...(verification.packageVersion
            ? { packageVersion: verification.packageVersion }
            : {}),
          ...(verification.keyId ? { keyId: verification.keyId } : {}),
          ...(verification.manifestSha256
            ? { manifestSha256: verification.manifestSha256 }
            : {}),
          ...(verification.envelopeSha256
            ? { envelopeSha256: verification.envelopeSha256 }
            : {}),
        });
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : formatApiErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const importSignedExtensionPackageFile = useCallback(
    async (file: File): Promise<void> => {
      if (!detail) return;
      if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.tooLarge);
        return;
      }
      setExtensionBusyId("package:import");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = JSON.parse(await file.text()) as unknown;
        const extension = await importSignedExtensionPackageApi({
          threadId: detail.thread.id,
          envelope,
        });
        setExtensionPackageUpdatePreview(undefined);
        setExtensionPackageUpdateEnvelope(undefined);
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        setExtensionPackageRolloutPreview(undefined);
        await commitExtension(extension);
        const packageBinding = extension.packageBinding;
        if (!packageBinding) {
          throw new Error(
            "Signed Extension import did not produce a package binding",
          );
        }
        const signed = packageBinding.envelope;
        setExtensionPackageReceipt({
          action: "imported",
          status: "trusted",
          reason: extensionCopy.packages.signedNotApproved,
          extensionId: extension.id,
          packageName: signed.manifest.name,
          packageVersion: signed.manifest.version,
          keyId: signed.signature.keyId,
          manifestSha256: signed.manifest.contentSha256,
          envelopeSha256: signed.contentSha256,
        });
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : formatApiErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [commitExtension, detail],
  );

  const exportExtensionPackageLockfile =
    useCallback(async (): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:lockfile-export");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const lockfile = await exportExtensionPackageLockfileApi({
          threadId: detail.thread.id,
        });
        downloadJson(
          lockfile,
          `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`,
        );
        setExtensionPackageReceipt({
          action: "lockfile_exported",
          status: "trusted",
          reason: extensionCopy.packages.lockfileExported,
          envelopeSha256: lockfile.contentSha256,
        });
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    }, [detail, refreshExtensionWorkspace]);

  const downloadExtensionPackageChannelIndex = useCallback(
    async (trustAnchorId: string, publisher: string): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:channel-index-sign");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = await signExtensionPackageChannelIndexApi({
          threadId: detail.thread.id,
          trustAnchorId,
          publisher,
          lockfileBaseUrl: window.location.origin,
        });
        downloadJson(
          envelope,
          `napier-channel-index-${envelope.index.contentSha256.slice(0, 12)}.json`,
        );
        setExtensionPackageReceipt({
          action: "channel_index_signed",
          status: "trusted",
          reason: extensionCopy.packages.channelIndexSigned,
          keyId: envelope.signature.keyId,
          indexSha256: envelope.index.contentSha256,
          envelopeSha256: envelope.contentSha256,
          channelCount: envelope.index.channels.length,
        });
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const publishExtensionPackageRolloutChannel = useCallback(
    async (name: string): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:rollout-publish");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const channel = await publishExtensionPackageRolloutChannelApi({
          threadId: detail.thread.id,
          name,
        });
        setExtensionPackageReceipt({
          action: "rollout_published",
          status: "trusted",
          reason: extensionCopy.packages.rolloutPublished,
          envelopeSha256: channel.lockfileSha256,
        });
        setExtensionPackageRolloutPreview(undefined);
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const previewExtensionPackageRolloutChannel = useCallback(
    async (channelId: string): Promise<void> => {
      setExtensionBusyId(`package:rollout-preview:${channelId}`);
      setExtensionPackageReceipt(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setError(undefined);
      try {
        const preview =
          await previewExtensionPackageRolloutChannelApi(channelId);
        setExtensionPackageRolloutPreview(preview);
        setExtensionPackageDeploymentPreview(preview.deploymentPreview);
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const previewExtensionPackageUpdateFile = useCallback(
    async (extensionId: string, file: File): Promise<void> => {
      if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.tooLarge);
        return;
      }
      setExtensionBusyId("package:update-preview");
      setExtensionPackageReceipt(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setError(undefined);
      try {
        const envelope = JSON.parse(await file.text()) as unknown;
        const preview = await previewExtensionPackageUpdateApi(extensionId, {
          envelope,
        });
        setExtensionPackageUpdateEnvelope(envelope);
        setExtensionPackageUpdatePreview(preview);
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : formatApiErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const applyExtensionPackageUpdate = useCallback(
    async (confirmation: ExtensionPackageUpdateConfirmation): Promise<void> => {
      if (
        !detail ||
        !extensionPackageUpdatePreview ||
        extensionPackageUpdateEnvelope === undefined
      ) {
        return;
      }
      setExtensionBusyId("package:update");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const result = await applyExtensionPackageUpdateApi(
          extensionPackageUpdatePreview.extensionId,
          {
            threadId: detail.thread.id,
            envelope: extensionPackageUpdateEnvelope,
            expectedPackageBindingSha256:
              extensionPackageUpdatePreview.expectedPackageBindingSha256,
            ...(confirmation.publisherChange
              ? { confirmPublisherChange: true }
              : {}),
            ...(confirmation.versionOverride
              ? { confirmVersionOverride: true }
              : {}),
          },
        );
        await commitExtension(result.extension);
        setExtensionPackageReceipt({
          action: "updated",
          status: "trusted",
          reason: result.updated
            ? extensionCopy.packages.reviewReset
            : extensionCopy.packages.noUpdateChanges,
          extensionId: result.extension.id,
          packageName: result.extension.name,
          packageVersion: result.preview.next.version,
          keyId: result.preview.next.keyId,
          manifestSha256: result.preview.next.manifestSha256,
          envelopeSha256: result.preview.next.envelopeSha256,
        });
        setExtensionPackageUpdatePreview(undefined);
        setExtensionPackageUpdateEnvelope(undefined);
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [
      commitExtension,
      detail,
      extensionPackageUpdateEnvelope,
      extensionPackageUpdatePreview,
    ],
  );

  const cancelExtensionPackageUpdate = useCallback((): void => {
    setExtensionPackageUpdatePreview(undefined);
    setExtensionPackageUpdateEnvelope(undefined);
  }, []);

  const previewExtensionPackageDeploymentFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const singleLockfileCandidate = files.length === 1;
      if (
        files.length < 1 ||
        files.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILES ||
        totalBytes > MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES ||
        (!singleLockfileCandidate &&
          files.some(
            (file) => file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES,
          ))
      ) {
        setError(extensionCopy.packages.errors.deploymentTooLarge);
        return;
      }
      setExtensionBusyId("package:deployment-preview");
      setExtensionPackageReceipt(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setError(undefined);
      try {
        const parsed = await Promise.all(
          files.map(async (file) => JSON.parse(await file.text()) as unknown),
        );
        const envelopes =
          parsed.length === 1 && isExtensionPackageLockfile(parsed[0])
            ? parsed[0].packages.map((entry) => entry.envelope)
            : parsed;
        const preview = await previewExtensionPackageDeploymentApi({
          envelopes,
        });
        setExtensionPackageDeploymentEnvelopes(envelopes);
        setExtensionPackageDeploymentPreview(preview);
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : formatApiErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const applyExtensionPackageDeployment = useCallback(
    async (
      confirmation: ExtensionPackageDeploymentConfirmation,
    ): Promise<void> => {
      if (
        !detail ||
        !extensionPackageDeploymentPreview ||
        (!extensionPackageDeploymentEnvelopes &&
          !extensionPackageRolloutPreview)
      ) {
        return;
      }
      setExtensionBusyId("package:deployment");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        let deploymentNoChanges: boolean;
        let receiptReason: string;
        if (extensionPackageRolloutPreview) {
          const result = await applyExtensionPackageRolloutChannelApi(
            extensionPackageRolloutPreview.channelId,
            {
              threadId: detail.thread.id,
              expectedRolloutSha256:
                extensionPackageRolloutPreview.contentSha256,
              expectedDeploymentSha256:
                extensionPackageRolloutPreview.deploymentPreview.contentSha256,
              ...(confirmation.publisherChanges
                ? { confirmPublisherChanges: true }
                : {}),
              ...(confirmation.versionOverrides
                ? { confirmVersionOverrides: true }
                : {}),
            },
          );
          deploymentNoChanges = result.deployment.preview.noChanges;
          receiptReason = deploymentNoChanges
            ? extensionCopy.packages.noUpdateChanges
            : extensionCopy.packages.rolloutApplied;
        } else {
          if (!extensionPackageDeploymentEnvelopes) return;
          const result = await applyExtensionPackageDeploymentApi({
            threadId: detail.thread.id,
            envelopes: extensionPackageDeploymentEnvelopes,
            expectedDeploymentSha256:
              extensionPackageDeploymentPreview.contentSha256,
            ...(confirmation.publisherChanges
              ? { confirmPublisherChanges: true }
              : {}),
            ...(confirmation.versionOverrides
              ? { confirmVersionOverrides: true }
              : {}),
          });
          deploymentNoChanges = result.preview.noChanges;
          receiptReason = deploymentNoChanges
            ? extensionCopy.packages.noUpdateChanges
            : extensionCopy.packages.deploymentReviewReset;
        }
        await refreshExtensionWorkspace();
        setExtensionPackageReceipt({
          action: extensionPackageRolloutPreview
            ? "rollout_applied"
            : "deployed",
          status: "trusted",
          reason: receiptReason,
        });
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        setExtensionPackageRolloutPreview(undefined);
      } catch (packageError) {
        setError(formatApiErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [
      detail,
      extensionPackageDeploymentEnvelopes,
      extensionPackageDeploymentPreview,
      extensionPackageRolloutPreview,
      refreshExtensionWorkspace,
    ],
  );

  const cancelExtensionPackageDeployment = useCallback((): void => {
    setExtensionPackageDeploymentPreview(undefined);
    setExtensionPackageDeploymentEnvelopes(undefined);
    setExtensionPackageRolloutPreview(undefined);
  }, []);

  return {
    extensionPackageReceipt,
    extensionPackageDeploymentPreview,
    extensionPackageRolloutPreview,
    extensionPackageUpdatePreview,
    clearExtensionPackagePreviews,
    downloadSignedExtensionPackage,
    verifySignedExtensionPackageFile,
    importSignedExtensionPackageFile,
    exportExtensionPackageLockfile,
    downloadExtensionPackageChannelIndex,
    publishExtensionPackageRolloutChannel,
    previewExtensionPackageRolloutChannel,
    previewExtensionPackageUpdateFile,
    applyExtensionPackageUpdate,
    cancelExtensionPackageUpdate,
    previewExtensionPackageDeploymentFiles,
    applyExtensionPackageDeployment,
    cancelExtensionPackageDeployment,
  };
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isExtensionPackageLockfile(
  value: unknown,
): value is ExtensionPackageLockfile {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const packages = record["packages"];
  return (
    record["kind"] === "napier.extension-package-lockfile" &&
    Array.isArray(packages) &&
    packages.length > 0 &&
    packages.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        "envelope" in entry,
    )
  );
}

function isSignedExtensionPackageChannelIndexEnvelope(
  value: unknown,
): value is SignedExtensionPackageChannelIndexEnvelope {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const index = record["index"];
  const signature = record["signature"];
  return (
    record["kind"] === "napier.signed-extension-package-channel-index" &&
    Boolean(index) &&
    typeof index === "object" &&
    !Array.isArray(index) &&
    Array.isArray((index as Record<string, unknown>)["channels"]) &&
    Boolean(signature) &&
    typeof signature === "object" &&
    !Array.isArray(signature)
  );
}


