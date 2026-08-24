import {
  type CreateExtensionPublisherTrustAnchorRequest,
  type CreateMcpExtensionRequest,
  type ExtensionConnection,
  type ExtensionPublisherTrustAnchor,
  type ExtensionRecord,
  type ReviewExtensionRequest,
  type ReviewMcpToolRequest,
} from "@napier/contracts";
import {
  createExtensionPublisherTrustAnchor as createExtensionPublisherTrustAnchorRecord,
  extensionPackageDependencyFailure,
  MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS,
  revokeExtensionPublisherTrustAnchor as revokeExtensionPublisherTrustAnchorRecord,
  verifyBoundExtensionPackageTrust,
} from "./extension-packages.js";
import {
  createMcpExtension,
  mergeDiscoveredMcpTools,
  reviewExtensionRecord,
  reviewMcpToolRecord,
  setExtensionAgentEnabled,
  updateExtensionConnection,
  type DiscoveredMcpTool,
} from "./extensions.js";

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class ExtensionRecordRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listExtensions(options: { agentId?: string } = {}): ExtensionRecord[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.extensions
        .filter(
          (extension) =>
            !options.agentId ||
            extension.enabledAgentIds.includes(options.agentId),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  getExtension(extensionId: string): ExtensionRecord {
    this.host.assertInitialized();
    const extension = this.host.state.extensions.find(
      (candidate) => candidate.id === extensionId,
    );
    if (!extension) throw new Error(`Extension not found: ${extensionId}`);
    return structuredClone(extension);
  }

  async createMcpExtension(
    request: CreateMcpExtensionRequest,
  ): Promise<ExtensionRecord> {
    this.host.assertInitialized();
    const extension = createMcpExtension(request);
    return this.host.stateQueue.run(async () => {
      if (
        this.host.state.extensions.some(
          (candidate) =>
            candidate.kind === "mcp" &&
            candidate.normalizedName === extension.normalizedName,
        )
      ) {
        throw new Error(
          `MCP extension name already exists: ${extension.normalizedName}`,
        );
      }
      this.host.state.extensions.push(extension);
      await this.host.persistState();
      return structuredClone(extension);
    });
  }

  listExtensionPublisherTrustAnchors(): ExtensionPublisherTrustAnchor[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.extensionPublisherTrustAnchors
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getExtensionPublisherTrustAnchor(
    anchorId: string,
  ): ExtensionPublisherTrustAnchor {
    this.host.assertInitialized();
    const anchor = this.host.state.extensionPublisherTrustAnchors.find(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchor) {
      throw new Error(
        `Extension publisher trust anchor not found: ${anchorId}`,
      );
    }
    return structuredClone(anchor);
  }

  async createExtensionPublisherTrustAnchor(
    request: CreateExtensionPublisherTrustAnchorRequest,
  ): Promise<ExtensionPublisherTrustAnchor> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const anchor = createExtensionPublisherTrustAnchorRecord(request);
    return this.host.stateQueue.run(async () => {
      if (
        this.host.state.extensionPublisherTrustAnchors.length >=
        MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS} Extension publisher trust anchors`,
        );
      }
      if (
        this.host.state.extensionPublisherTrustAnchors.some(
          (candidate) => candidate.keyId === anchor.keyId,
        )
      ) {
        throw new Error(
          `Extension publisher trust anchor already exists for key: ${anchor.keyId}`,
        );
      }
      if (
        anchor.signingSource &&
        this.host.state.extensionPublisherTrustAnchors.some(
          (candidate) =>
            candidate.signingSource?.variable ===
            anchor.signingSource?.variable,
        )
      ) {
        throw new Error(
          `Extension publisher signing source already exists: ${anchor.signingSource.variable}`,
        );
      }
      this.host.state.extensionPublisherTrustAnchors.push(anchor);
      await this.host.persistState();
      return structuredClone(anchor);
    });
  }

  async revokeExtensionPublisherTrustAnchor(
    anchorId: string,
  ): Promise<ExtensionPublisherTrustAnchor> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.extensionPublisherTrustAnchors.findIndex(
        (candidate) => candidate.id === anchorId,
      );
      const current = this.host.state.extensionPublisherTrustAnchors[index];
      if (!current) {
        throw new Error(
          `Extension publisher trust anchor not found: ${anchorId}`,
        );
      }
      const updated = revokeExtensionPublisherTrustAnchorRecord(current);
      this.host.state.extensionPublisherTrustAnchors[index] = updated;
      if (updated.status !== current.status) {
        for (
          let extensionIndex = 0;
          extensionIndex < this.host.state.extensions.length;
          extensionIndex += 1
        ) {
          const extension = this.host.state.extensions[extensionIndex]!;
          const directlyRevoked =
            extension.packageBinding?.envelope.signature.keyId ===
            updated.keyId;
          const dependencyFailure = extensionPackageDependencyFailure(
            extension,
            this.host.state.extensions,
            this.host.state.extensionPublisherTrustAnchors,
            new Date(updated.updatedAt),
          );
          if (!directlyRevoked && !dependencyFailure) continue;
          this.host.state.extensions[extensionIndex] = {
            ...extension,
            enabledAgentIds: [],
            connection: {
              status: "disconnected",
              toolCount: extension.tools.length,
              error: directlyRevoked
                ? "Signed package publisher key was revoked."
                : (dependencyFailure ??
                  "Signed package dependency is unavailable."),
            },
            revision: extension.revision + 1,
            updatedAt: updated.updatedAt,
          };
        }
        await this.host.persistState();
      }
      return structuredClone(updated);
    });
  }

  async reviewExtension(
    extensionId: string,
    request: ReviewExtensionRequest,
  ): Promise<ExtensionRecord> {
    return this.host.updateExtension(extensionId, (current) =>
      reviewExtensionRecord(current, request),
    );
  }

  async setExtensionEnabled(
    extensionId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<ExtensionRecord> {
    this.host.getAgent(agentId);
    return this.host.updateExtension(extensionId, (current) => {
      if (enabled) {
        const verification = verifyBoundExtensionPackageTrust(
          current,
          this.host.state.extensionPublisherTrustAnchors,
        );
        if (verification && verification.status !== "trusted") {
          throw new Error(
            `Signed Extension package is not trusted: ${verification.reason}`,
          );
        }
        const dependencyFailure = extensionPackageDependencyFailure(
          current,
          this.host.state.extensions,
          this.host.state.extensionPublisherTrustAnchors,
        );
        if (dependencyFailure) throw new Error(dependencyFailure);
      }
      return setExtensionAgentEnabled(current, agentId, enabled);
    });
  }

  async setExtensionConnection(
    extensionId: string,
    connection: ExtensionConnection,
  ): Promise<ExtensionRecord> {
    return this.host.updateExtension(extensionId, (current) =>
      updateExtensionConnection(current, connection),
    );
  }

  async replaceDiscoveredMcpTools(
    extensionId: string,
    tools: DiscoveredMcpTool[],
  ): Promise<ExtensionRecord> {
    return this.host.updateExtension(extensionId, (current) =>
      mergeDiscoveredMcpTools(current, tools),
    );
  }

  async reviewMcpTool(
    extensionId: string,
    toolName: string,
    request: ReviewMcpToolRequest,
  ): Promise<ExtensionRecord> {
    return this.host.updateExtension(extensionId, (current) =>
      reviewMcpToolRecord(current, toolName, request),
    );
  }
}
