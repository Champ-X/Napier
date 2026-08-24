import {
  type ApplyExtensionPackageDeploymentRequest,
  type ApplyExtensionPackageDeploymentResult,
  type ApplyExtensionPackageRolloutChannelRequest,
  type ApplyExtensionPackageRolloutChannelResult,
  type ApplyExtensionPackageUpdateRequest,
  type ApplyExtensionPackageUpdateResult,
  type ExportExtensionPackageLockfileRequest,
  type ExtensionPackageChannelIndexVerification,
  type ExtensionPackageDeploymentPreview,
  type ExtensionPackageLockfile,
  type ExtensionPackageLockfileVerification,
  type ExtensionPackageRolloutChannel,
  type ExtensionPackageRolloutPreview,
  type ExtensionPackageUpdatePreview,
  type ExtensionRecord,
  type ImportSignedExtensionPackageRequest,
  type PreviewExtensionPackageRolloutChannelRequest,
  type PublishExtensionPackageRolloutChannelRequest,
  type SignedExtensionPackageChannelIndexEnvelope,
  type SignExtensionPackageChannelIndexRequest,
  type VerifyExtensionPackageChannelIndexRequest,
} from "@napier/contracts";
import {
  applyExtensionPackageDeploymentRecords,
  applyExtensionPackageRolloutChannelRecords,
  applyExtensionPackageUpdateRecord,
  createExtensionPackageDeploymentPreview,
  createExtensionPackageLockfile,
  createExtensionPackageRolloutChannel,
  createExtensionPackageRolloutPreview,
  createExtensionPackageUpdatePreview,
  createMcpExtensionFromSignedPackage,
  signExtensionPackageChannelIndex as signExtensionPackageChannelIndexRecord,
  validateExtensionPackageDependencyGraph,
  verifyExtensionPackageLockfile as verifyExtensionPackageLockfileRecord,
  verifySignedExtensionPackageChannelIndexEnvelope as verifySignedExtensionPackageChannelIndexEnvelopeRecord,
  verifySignedExtensionPackageEnvelope,
} from "./extension-packages.js";
import { normalizeMcpName } from "./extensions.js";

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class ExtensionDistributionRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async importSignedExtensionPackage(
    request: ImportSignedExtensionPackageRequest,
  ): Promise<ExtensionRecord> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const verification = verifySignedExtensionPackageEnvelope(
        request.envelope,
        this.host.state.extensionPublisherTrustAnchors,
      );
      if (verification.status !== "trusted") {
        throw new Error(
          `Signed Extension package is not trusted: ${verification.reason}`,
        );
      }
      const extension = createMcpExtensionFromSignedPackage(request.envelope);
      if (
        this.host.state.extensions.some(
          (candidate) =>
            candidate.normalizedName === extension.normalizedName ||
            candidate.packageBinding?.envelope.contentSha256 ===
              extension.packageBinding?.envelope.contentSha256,
        )
      ) {
        throw new Error(
          `MCP extension or signed package already exists: ${extension.normalizedName}`,
        );
      }
      const nextExtensions = [...this.host.state.extensions, extension];
      validateExtensionPackageDependencyGraph(
        nextExtensions,
        this.host.state.extensionPublisherTrustAnchors,
        {
          requireTrusted: true,
        },
      );
      this.host.state.extensions = nextExtensions;
      await this.host.persistState();
      return structuredClone(extension);
    });
  }

  previewExtensionPackageUpdate(
    extensionId: string,
    envelope: unknown,
  ): ExtensionPackageUpdatePreview {
    this.host.assertInitialized();
    const index = this.host.state.extensions.findIndex(
      (candidate) => candidate.id === extensionId,
    );
    const current = this.host.state.extensions[index];
    if (!current) throw new Error(`Extension not found: ${extensionId}`);
    const preview = createExtensionPackageUpdatePreview(
      current,
      envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
    if (preview.noChanges) return preview;
    const simulated = applyExtensionPackageUpdateRecord(
      current,
      envelope,
      this.host.state.extensionPublisherTrustAnchors,
      {
        expectedPackageBindingSha256: preview.expectedPackageBindingSha256,
        confirmPublisherChange: true,
        confirmVersionOverride: true,
        updatedAt: preview.generatedAt,
      },
    );
    const nextExtensions = [...this.host.state.extensions];
    nextExtensions[index] = simulated.extension;
    validateExtensionPackageDependencyGraph(
      nextExtensions,
      this.host.state.extensionPublisherTrustAnchors,
      {
        requireTrusted: true,
        now: new Date(preview.generatedAt),
      },
    );
    return preview;
  }

  async applyExtensionPackageUpdate(
    extensionId: string,
    request: ApplyExtensionPackageUpdateRequest,
  ): Promise<ApplyExtensionPackageUpdateResult> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.extensions.findIndex(
        (candidate) => candidate.id === extensionId,
      );
      const current = this.host.state.extensions[index];
      if (!current) throw new Error(`Extension not found: ${extensionId}`);
      const result = applyExtensionPackageUpdateRecord(
        structuredClone(current),
        request.envelope,
        this.host.state.extensionPublisherTrustAnchors,
        {
          expectedPackageBindingSha256: request.expectedPackageBindingSha256,
          ...(request.confirmPublisherChange === true
            ? { confirmPublisherChange: true }
            : {}),
          ...(request.confirmVersionOverride === true
            ? { confirmVersionOverride: true }
            : {}),
        },
      );
      if (result.updated) {
        const nextExtensions = [...this.host.state.extensions];
        nextExtensions[index] = result.extension;
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.host.state.extensionPublisherTrustAnchors,
          {
            requireTrusted: true,
          },
        );
        this.host.state.extensions = nextExtensions;
        await this.host.persistState();
      }
      return structuredClone(result);
    });
  }

  previewExtensionPackageDeployment(
    envelopes: unknown[],
  ): ExtensionPackageDeploymentPreview {
    this.host.assertInitialized();
    return createExtensionPackageDeploymentPreview(
      this.host.state.extensions,
      envelopes,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  async applyExtensionPackageDeployment(
    request: ApplyExtensionPackageDeploymentRequest,
  ): Promise<ApplyExtensionPackageDeploymentResult> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const result = applyExtensionPackageDeploymentRecords(
        this.host.state.extensions,
        request.envelopes,
        this.host.state.extensionPublisherTrustAnchors,
        {
          expectedDeploymentSha256: request.expectedDeploymentSha256,
          ...(request.confirmPublisherChanges === true
            ? { confirmPublisherChanges: true }
            : {}),
          ...(request.confirmVersionOverrides === true
            ? { confirmVersionOverrides: true }
            : {}),
        },
      );
      if (result.extensions.length > 0) {
        const nextExtensions = [...this.host.state.extensions];
        for (const extension of result.extensions) {
          const index = nextExtensions.findIndex(
            (candidate) => candidate.id === extension.id,
          );
          if (index >= 0) {
            nextExtensions[index] = extension;
          } else {
            nextExtensions.push(extension);
          }
        }
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.host.state.extensionPublisherTrustAnchors,
          {
            requireTrusted: true,
          },
        );
        this.host.state.extensions = nextExtensions;
        await this.host.persistState();
      }
      return structuredClone(result);
    });
  }

  exportExtensionPackageLockfile(
    request: ExportExtensionPackageLockfileRequest,
  ): ExtensionPackageLockfile {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return createExtensionPackageLockfile(
      this.host.state.extensions,
      this.host.state.extensionPublisherTrustAnchors,
      request.extensionIds ? { extensionIds: request.extensionIds } : {},
    );
  }

  verifyExtensionPackageLockfile(
    lockfile: unknown,
  ): ExtensionPackageLockfileVerification {
    this.host.assertInitialized();
    return verifyExtensionPackageLockfileRecord(
      lockfile,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  async signExtensionPackageChannelIndex(
    request: SignExtensionPackageChannelIndexRequest,
  ): Promise<SignedExtensionPackageChannelIndexEnvelope> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const anchor = this.host.getExtensionPublisherTrustAnchor(
      request.trustAnchorId,
    );
    return signExtensionPackageChannelIndexRecord(
      this.host.state.extensionPackageRolloutChannels,
      request.publisher,
      anchor,
      {
        ...(request.channelIds ? { channelIds: request.channelIds } : {}),
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
        ...(request.lockfileBaseUrl
          ? { lockfileBaseUrl: request.lockfileBaseUrl }
          : {}),
      },
    );
  }

  verifyExtensionPackageChannelIndex(
    request: VerifyExtensionPackageChannelIndexRequest,
  ): ExtensionPackageChannelIndexVerification {
    this.host.assertInitialized();
    return verifySignedExtensionPackageChannelIndexEnvelopeRecord(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  listExtensionPackageRolloutChannels(): ExtensionPackageRolloutChannel[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.extensionPackageRolloutChannels
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  getExtensionPackageRolloutChannel(
    channelId: string,
  ): ExtensionPackageRolloutChannel {
    this.host.assertInitialized();
    const channel = this.host.state.extensionPackageRolloutChannels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) {
      throw new Error(
        `Extension package rollout channel not found: ${channelId}`,
      );
    }
    return structuredClone(channel);
  }

  getExtensionPackageRolloutLockfile(
    lockfileSha256: string,
  ): ExtensionPackageLockfile {
    this.host.assertInitialized();
    if (!/^[a-f0-9]{64}$/.test(lockfileSha256)) {
      throw new Error("Extension package lockfile hash is invalid");
    }
    const channel = this.host.state.extensionPackageRolloutChannels.find(
      (candidate) => candidate.lockfileSha256 === lockfileSha256,
    );
    if (!channel) {
      throw new Error(
        `Extension package rollout lockfile not found: ${lockfileSha256}`,
      );
    }
    return structuredClone(channel.lockfile);
  }

  async publishExtensionPackageRolloutChannel(
    request: PublishExtensionPackageRolloutChannelRequest,
  ): Promise<ExtensionPackageRolloutChannel> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const normalizedName = normalizeMcpName(
        request.name.replace(/\s+/g, " ").trim(),
      );
      const existing = this.host.state.extensionPackageRolloutChannels.find(
        (channel) => channel.normalizedName === normalizedName,
      );
      const channel = createExtensionPackageRolloutChannel({
        ...(existing ? { existing } : {}),
        extensions: this.host.state.extensions,
        anchors: this.host.state.extensionPublisherTrustAnchors,
        request,
      });
      const nextChannels = [...this.host.state.extensionPackageRolloutChannels];
      const index = nextChannels.findIndex(
        (candidate) => candidate.id === channel.id,
      );
      if (index >= 0) {
        nextChannels[index] = channel;
      } else {
        nextChannels.push(channel);
      }
      this.host.state.extensionPackageRolloutChannels = nextChannels;
      await this.host.persistState();
      return structuredClone(channel);
    });
  }

  previewExtensionPackageRolloutChannel(
    request: PreviewExtensionPackageRolloutChannelRequest,
  ): ExtensionPackageRolloutPreview {
    this.host.assertInitialized();
    return createExtensionPackageRolloutPreview(
      this.host.getExtensionPackageRolloutChannel(request.channelId),
      this.host.state.extensions,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  async applyExtensionPackageRolloutChannel(
    request: ApplyExtensionPackageRolloutChannelRequest,
  ): Promise<ApplyExtensionPackageRolloutChannelResult> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const channel = this.host.state.extensionPackageRolloutChannels.find(
        (candidate) => candidate.id === request.channelId,
      );
      if (!channel) {
        throw new Error(
          `Extension package rollout channel not found: ${request.channelId}`,
        );
      }
      const result = applyExtensionPackageRolloutChannelRecords(
        channel,
        this.host.state.extensions,
        this.host.state.extensionPublisherTrustAnchors,
        {
          expectedRolloutSha256: request.expectedRolloutSha256,
          expectedDeploymentSha256: request.expectedDeploymentSha256,
          ...(request.confirmPublisherChanges === true
            ? { confirmPublisherChanges: true }
            : {}),
          ...(request.confirmVersionOverrides === true
            ? { confirmVersionOverrides: true }
            : {}),
        },
      );
      if (result.deployment.extensions.length > 0) {
        const nextExtensions = [...this.host.state.extensions];
        for (const extension of result.deployment.extensions) {
          const index = nextExtensions.findIndex(
            (candidate) => candidate.id === extension.id,
          );
          if (index >= 0) {
            nextExtensions[index] = extension;
          } else {
            nextExtensions.push(extension);
          }
        }
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.host.state.extensionPublisherTrustAnchors,
          {
            requireTrusted: true,
          },
        );
        this.host.state.extensions = nextExtensions;
        await this.host.persistState();
      }
      return structuredClone(result);
    });
  }
}
