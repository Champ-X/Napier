import {
  type ApplySkillContentRequest,
  type ApplySkillContentResult,
  type InspectorPackageQualification,
  type InspectorPackageVerification,
  type InstallSkillPackageRequest,
  type InstallSkillPackageResult,
  type PreviewSkillContentRequest,
  type PromptPackageQualification,
  type PromptPackageVerification,
  type QualifyInspectorPackageRequest,
  type QualifyPromptPackageRequest,
  type QualifySkillPackageRequest,
  type SignedExtensionPackageEnvelope,
  type SignedInspectorPackageEnvelope,
  type SignedPromptPackageEnvelope,
  type SignedSkillPackageEnvelope,
  type SignExtensionPackageRequest,
  type SignInspectorPackageRequest,
  type SignPromptPackageRequest,
  type SignSkillPackageRequest,
  type SkillContentReview,
  type SkillPackageInstallation,
  type SkillPackageQualification,
  type SkillPackageVerification,
  type VerifyInspectorPackageRequest,
  type VerifyPromptPackageRequest,
  type VerifySkillPackageRequest,
} from "@napier/contracts";
import { createHash } from "node:crypto";
import { signExtensionPackage as signExtensionPackageRecord } from "./extension-packages.js";
import { createId } from "./ids.js";
import {
  qualifyInspectorPackage,
  signInspectorPackage,
  verifySignedInspectorPackageEnvelope,
} from "./inspector-packages.js";
import {
  qualifyAgentPromptPackage,
  signPromptPackage,
  validateSignedPromptPackageEnvelope,
  verifySignedPromptPackageEnvelope,
} from "./prompt-packages.js";
import {
  applyReviewedSkillContent,
  createSkillContentReview,
} from "./skill-content.js";
import {
  createSkillPackageInstallation,
  markSkillPackageInstallationReplaced,
  qualifyWorkspaceSkillPackage,
  signWorkspaceSkillPackage,
  validateSignedSkillPackageEnvelope,
  verifySignedSkillPackageEnvelope,
} from "./skill-packages.js";

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class SignedPackageRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async signExtensionPackage(
    extensionId: string,
    request: SignExtensionPackageRequest,
  ): Promise<SignedExtensionPackageEnvelope> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const extension = this.host.getExtension(extensionId);
    const anchor = this.host.getExtensionPublisherTrustAnchor(
      request.trustAnchorId,
    );
    return signExtensionPackageRecord(extension, request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      ...(request.dependencies ? { dependencies: request.dependencies } : {}),
    });
  }

  async signSkillPackage(
    request: SignSkillPackageRequest,
  ): Promise<SignedSkillPackageEnvelope> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const anchor = this.host.getExtensionPublisherTrustAnchor(
      request.trustAnchorId,
    );
    return signWorkspaceSkillPackage(
      this.host.workspaceRoot,
      request.publisher,
      anchor,
      {
        ...(request.skillNames ? { skillNames: request.skillNames } : {}),
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      },
    );
  }

  verifySkillPackage(
    request: VerifySkillPackageRequest,
  ): SkillPackageVerification {
    this.host.assertInitialized();
    return verifySignedSkillPackageEnvelope(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  async qualifySkillPackage(
    request: QualifySkillPackageRequest,
  ): Promise<SkillPackageQualification> {
    this.host.assertInitialized();
    if (request.threadId) this.host.getThread(request.threadId);
    return qualifyWorkspaceSkillPackage(
      this.host.workspaceRoot,
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  listSkillPackageInstallations(): SkillPackageInstallation[] {
    this.host.assertInitialized();
    return structuredClone(
      [...this.host.state.skillPackageInstallations].sort((left, right) =>
        right.installedAt.localeCompare(left.installedAt),
      ),
    );
  }

  async installSkillPackage(
    request: InstallSkillPackageRequest,
  ): Promise<InstallSkillPackageResult> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const qualification = await qualifyWorkspaceSkillPackage(
        this.host.workspaceRoot,
        request.envelope,
        this.host.state.extensionPublisherTrustAnchors,
      );
      if (qualification.status !== "qualified") {
        throw new Error(
          `Skill package cannot be installed: ${qualification.reason}`,
        );
      }
      const envelope = validateSignedSkillPackageEnvelope(request.envelope);
      const active = this.host.state.skillPackageInstallations.find(
        (installation) => installation.status === "active",
      );
      if (active?.envelopeSha256 === envelope.contentSha256) {
        return {
          installation: structuredClone(active),
          qualification,
          created: false,
        };
      }
      if (active) {
        if (
          request.replaceInstallationId !== active.id ||
          request.confirmReplacement !== true
        ) {
          throw new Error(
            `Skill package replacement requires confirmation for ${active.id}`,
          );
        }
        if (
          (active.publisher !== envelope.manifest.publisher ||
            active.keyId !== envelope.signature.keyId) &&
          request.confirmPublisherChange !== true
        ) {
          throw new Error(
            "Skill package publisher change requires explicit confirmation",
          );
        }
        if (
          active.skillNamesSha256 !==
            createHash("sha256")
              .update(JSON.stringify(envelope.manifest.loadedSkillNames))
              .digest("hex") &&
          request.confirmSkillSetChange !== true
        ) {
          throw new Error(
            "Skill package Skill set change requires explicit confirmation",
          );
        }
      } else if (request.replaceInstallationId || request.confirmReplacement) {
        throw new Error("Skill package replacement target is not active");
      }
      const installation = createSkillPackageInstallation({
        id: createId("skillinstall"),
        envelope,
        installedByThreadId: request.threadId,
        ...(active ? { replacesInstallationId: active.id } : {}),
      });
      let replacedInstallation: SkillPackageInstallation | undefined;
      if (active) {
        const index = this.host.state.skillPackageInstallations.findIndex(
          (candidate) => candidate.id === active.id,
        );
        replacedInstallation = markSkillPackageInstallationReplaced(
          active,
          installation.id,
          installation.installedAt,
        );
        this.host.state.skillPackageInstallations[index] = replacedInstallation;
      }
      this.host.state.skillPackageInstallations.push(installation);
      await this.host.persistState();
      return {
        installation: structuredClone(installation),
        qualification,
        created: true,
        ...(replacedInstallation
          ? { replacedInstallation: structuredClone(replacedInstallation) }
          : {}),
      };
    });
  }

  async previewSkillContent(
    request: PreviewSkillContentRequest,
  ): Promise<SkillContentReview> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return createSkillContentReview(this.host.workspaceRoot, request.content);
  }

  async applySkillContent(
    request: ApplySkillContentRequest,
  ): Promise<ApplySkillContentResult> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return applyReviewedSkillContent(
      this.host.workspaceRoot,
      this.host.dataRoot,
      {
        content: request.content,
        expectedReviewSha256: request.expectedReviewSha256,
        ...(request.confirmInstall !== undefined
          ? { confirmInstall: request.confirmInstall }
          : {}),
        ...(request.confirmReplacement !== undefined
          ? { confirmReplacement: request.confirmReplacement }
          : {}),
      },
    );
  }

  signPromptPackage(
    request: SignPromptPackageRequest,
  ): SignedPromptPackageEnvelope {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const profile = this.host.getAgent(request.agentId);
    const revision = this.host.getAgentRevision(profile.id, profile.revision);
    const anchor = this.host.getExtensionPublisherTrustAnchor(
      request.trustAnchorId,
    );
    return signPromptPackage(profile, revision, request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    });
  }

  verifyPromptPackage(
    request: VerifyPromptPackageRequest,
  ): PromptPackageVerification {
    this.host.assertInitialized();
    return verifySignedPromptPackageEnvelope(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  qualifyPromptPackage(
    request: QualifyPromptPackageRequest,
  ): PromptPackageQualification {
    this.host.assertInitialized();
    if (request.threadId) this.host.getThread(request.threadId);
    let targetAgentId = request.agentId;
    if (!targetAgentId) {
      const envelope = validateSignedPromptPackageEnvelope(request.envelope);
      targetAgentId = envelope.manifest.sourceAgentId;
    }
    const profile = this.host.state.agents.find(
      (agent) => agent.id === targetAgentId,
    );
    return qualifyAgentPromptPackage(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
      profile ? structuredClone(profile) : undefined,
    );
  }

  signInspectorPackage(
    request: SignInspectorPackageRequest,
  ): SignedInspectorPackageEnvelope {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const anchor = this.host.getExtensionPublisherTrustAnchor(
      request.trustAnchorId,
    );
    return signInspectorPackage(request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    });
  }

  verifyInspectorPackage(
    request: VerifyInspectorPackageRequest,
  ): InspectorPackageVerification {
    this.host.assertInitialized();
    return verifySignedInspectorPackageEnvelope(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }

  qualifyInspectorPackage(
    request: QualifyInspectorPackageRequest,
  ): InspectorPackageQualification {
    this.host.assertInitialized();
    if (request.threadId) this.host.getThread(request.threadId);
    return qualifyInspectorPackage(
      request.envelope,
      this.host.state.extensionPublisherTrustAnchors,
    );
  }
}
