import { safeFilenameSegment, setBodyContentSha256Header, setStableContentSha256Header, sha256Json } from "./http-response-evidence.js";
import type { ApplySkillContentResult, ExtensionPublisherTrustAnchor, InstallSkillPackageResult, JsonValue, PromptPackageQualification, PromptPackageVerification, SignedExtensionPackageEnvelope, SignedInspectorPackageEnvelope, SignedPromptPackageEnvelope, SignedSkillPackageEnvelope, SkillContentReview, SkillPackageInstallation, SkillPackageQualification, SkillPackageVerification, TrustedReceiptEnvelope, TrustedReceiptVerification, UsagePriceTableCatalog, UsagePriceTableVerification } from "@napier/contracts";
import type { Context } from "hono";

export function setTrustedReceiptVerificationHeaders(context: Context, verification: TrustedReceiptVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Receipt-Verification-Status", verification.status);
  context.header("X-Napier-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Integrity-Valid", String(verification.integrityValid));
  if (verification.receiptKind) {
    context.header("X-Napier-Receipt-Kind", verification.receiptKind);
  }
  if (verification.receiptContentSha256) {
    context.header("X-Napier-Receipt-SHA256", verification.receiptContentSha256);
  }
  if (verification.receiptArtifactSha256) {
    context.header("X-Napier-Receipt-Artifact-SHA256", verification.receiptArtifactSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.anchorDirectorySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", verification.anchorDirectorySha256);
  }
  if (verification.anchorDirectorySource) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source", verification.anchorDirectorySource);
  }
  if (verification.anchorDirectorySelectionId) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id", verification.anchorDirectorySelectionId);
  }
  if (verification.anchorDirectorySelectionSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-SHA256", verification.anchorDirectorySelectionSha256);
  }
  if (verification.anchorDirectorySelectionStateSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256", verification.anchorDirectorySelectionStateSha256);
  }
  if (verification.anchorDirectoryVerificationSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256", verification.anchorDirectoryVerificationSha256);
  }
  if (verification.anchorDirectoryPolicySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256", verification.anchorDirectoryPolicySha256);
  }
  if (verification.anchorDirectoryGeneratedAt) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Generated-At", verification.anchorDirectoryGeneratedAt);
  }
  if (verification.anchorDirectoryAgeMs !== undefined) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms", String(verification.anchorDirectoryAgeMs));
  }
  if (verification.anchorDirectoryAnchorCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Count", String(verification.anchorDirectoryAnchorCount));
  }
}

export function setUsagePriceTableCatalogHeaders(context: Context, catalog: UsagePriceTableCatalog): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, catalog.contentSha256);
  context.header("X-Napier-Usage-Price-Table-Count", String(catalog.tables.length));
  context.header("X-Napier-Usage-Price-Provider-Count", String(new Set(catalog.tables.map((table) => table.provider)).size));
  context.header("X-Napier-Usage-Price-Providers-SHA256", sha256Json(catalog.tables.map((table) => table.provider).sort()));
}

export function setUsagePriceTableVerificationHeaders(context: Context, verification: UsagePriceTableVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Usage-Price-Verification-Status", verification.status);
  context.header("X-Napier-Usage-Price-Table-Count", String(verification.tableCount));
  context.header("X-Napier-Usage-Price-Provider-Count", String(verification.providers.length));
  context.header("X-Napier-Usage-Price-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Usage-Price-Providers-SHA256", sha256Json(verification.providers));
  context.header("X-Napier-Usage-Price-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  if (verification.catalogSha256) {
    context.header("X-Napier-Usage-Price-Catalog-SHA256", verification.catalogSha256);
  }
}

export function setExtensionPublisherTrustAnchorListHeaders(context: Context, anchors: readonly ExtensionPublisherTrustAnchor[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, anchors);
  context.header("X-Napier-Extension-Publisher-Trust-Anchor-Count", String(anchors.length));
  context.header("X-Napier-Extension-Publisher-Trust-Trusted-Count", String(anchors.filter((anchor) => anchor.status === "trusted").length));
  context.header("X-Napier-Extension-Publisher-Trust-Revoked-Count", String(anchors.filter((anchor) => anchor.status === "revoked").length));
  context.header("X-Napier-Extension-Publisher-Trust-Signing-Capable-Count", String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length));
}

export function setExtensionPublisherTrustAnchorHeaders(context: Context, anchor: ExtensionPublisherTrustAnchor): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, anchor.contentSha256);
  context.header("X-Napier-Extension-Publisher-Trust-Anchor-Id", anchor.id);
  context.header("X-Napier-Signature-Key-Id", anchor.keyId);
  context.header("X-Napier-Extension-Publisher-Trust-Anchor-Status", anchor.status);
  context.header("X-Napier-Extension-Publisher-Trust-Signing-Capable", String(Boolean(anchor.signingSource)));
}

export function trustedReceiptEventPayload(envelope: TrustedReceiptEnvelope): Record<string, JsonValue> {
  return {
    receiptKind: envelope.receiptKind,
    receiptSha256: envelope.receipt.contentSha256,
    receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
    keyId: envelope.signature.keyId,
    signedAt: envelope.signature.signedAt,
    statementSha256: envelope.signature.statementSha256,
    envelopeSha256: envelope.contentSha256,
  };
}

export function signedExtensionPackageEventPayload(extensionId: string, envelope: SignedExtensionPackageEnvelope): Record<string, JsonValue> {
  return {
    extensionId,
    keyId: envelope.signature.keyId,
    signedAt: envelope.signature.signedAt,
    statementSha256: envelope.signature.statementSha256,
    manifestSha256: envelope.manifest.contentSha256,
    manifestArtifactSha256: envelope.signature.manifestArtifactSha256,
    transportSha256: envelope.manifest.transportSha256,
    envelopeSha256: envelope.contentSha256,
  };
}

export function setTrustedReceiptHeaders(context: Context, envelope: TrustedReceiptEnvelope, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Receipt-SHA256", envelope.receipt.contentSha256);
  context.header("X-Napier-Receipt-Artifact-SHA256", envelope.signature.receiptArtifactSha256);
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function setSignedExtensionPackageHeaders(context: Context, envelope: SignedExtensionPackageEnvelope, normalizedName: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${signedExtensionPackageFilename(normalizedName, envelope)}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header("X-Napier-Manifest-Artifact-SHA256", envelope.signature.manifestArtifactSha256);
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function signedExtensionPackageFilename(normalizedName: string, envelope: SignedExtensionPackageEnvelope): string {
  const safeName = safeFilenameSegment(normalizedName, "extension");
  return `${safeName}-${envelope.contentSha256.slice(0, 12)}.napier-extension.json`;
}

export function setSkillPackageHeaders(context: Context, envelope: SignedSkillPackageEnvelope, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header("X-Napier-Skill-Catalog-SHA256", envelope.manifest.skillCatalogSha256);
  context.header("X-Napier-Skill-Count", String(envelope.manifest.skills.length));
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function setPromptPackageHeaders(context: Context, envelope: SignedPromptPackageEnvelope, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header("X-Napier-System-Prompt-SHA256", envelope.manifest.systemPromptSha256);
  context.header("X-Napier-Agent-Revision", String(envelope.manifest.agentRevision));
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function setInspectorPackageHeaders(context: Context, envelope: SignedInspectorPackageEnvelope, filename: string): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header("X-Napier-Inspector-Catalog-SHA256", envelope.manifest.inspectorCatalogSha256);
  context.header("X-Napier-Inspector-Count", String(envelope.manifest.panels.length));
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

export function setSkillPackageVerificationHeaders(context: Context, verification: SkillPackageVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Skill-Package-Status", verification.status);
  context.header("X-Napier-Skill-Count", String(verification.skillCount));
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Skill-Package-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

export function setSkillPackageQualificationHeaders(context: Context, qualification: SkillPackageQualification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Skill-Package-Status", qualification.status);
  context.header("X-Napier-Skill-Package-Verification-Status", qualification.verificationStatus);
  context.header("X-Napier-Skill-Count", String(qualification.skillCount));
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header("X-Napier-Skill-Package-Envelope-SHA256", qualification.envelopeSha256);
  }
  if (qualification.skillCatalogSha256) {
    context.header("X-Napier-Skill-Catalog-SHA256", qualification.skillCatalogSha256);
  }
  if (qualification.observedSkillCatalogSha256) {
    context.header("X-Napier-Observed-Skill-Catalog-SHA256", qualification.observedSkillCatalogSha256);
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}

export function setSkillPackageInstallationListHeaders(context: Context, installations: readonly SkillPackageInstallation[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, installations);
  context.header("X-Napier-Skill-Package-Installation-Count", String(installations.length));
  context.header("X-Napier-Skill-Package-Active-Installation-Count", String(installations.filter((installation) => installation.status === "active").length));
  context.header("X-Napier-Skill-Package-Replaced-Installation-Count", String(installations.filter((installation) => installation.status === "replaced").length));
  context.header("X-Napier-Skill-Count", String(installations.reduce((total, installation) => total + installation.loadedSkillNames.length, 0)));
}

export function setSkillPackageInstallationResultHeaders(context: Context, result: InstallSkillPackageResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Skill-Package-Installation-Id", result.installation.id);
  context.header("X-Napier-Skill-Package-Installation-Status", result.installation.status);
  context.header("X-Napier-Skill-Package-Installation-Created", String(result.created));
  context.header("X-Napier-Skill-Package-Status", result.qualification.status);
  context.header("X-Napier-Skill-Package-Verification-Status", result.qualification.verificationStatus);
  context.header("X-Napier-Skill-Count", String(result.installation.loadedSkillNames.length));
  context.header("X-Napier-Skill-Catalog-SHA256", result.installation.skillCatalogSha256);
  context.header("X-Napier-Manifest-SHA256", result.installation.manifestSha256);
  context.header("X-Napier-Skill-Package-Envelope-SHA256", result.installation.envelopeSha256);
  context.header("X-Napier-Skill-Names-SHA256", result.installation.skillNamesSha256);
  context.header("X-Napier-Signature-Key-Id", result.installation.keyId);
  if (result.replacedInstallation) {
    context.header("X-Napier-Skill-Package-Replaced-Installation-Id", result.replacedInstallation.id);
  }
}

export function setSkillContentReviewHeaders(context: Context, review: SkillContentReview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Skill-Content-Review-SHA256", review.reviewSha256);
  context.header("X-Napier-Skill-Content-SHA256", review.contentSha256);
  context.header("X-Napier-Skill-Content-Frontmatter-SHA256", review.frontmatterSha256);
  context.header("X-Napier-Skill-Content-Body-SHA256", review.bodySha256);
  context.header("X-Napier-Skill-Content-Action", review.action);
  context.header("X-Napier-Skill-Content-Size-Bytes", String(review.sizeBytes));
  context.header("X-Napier-Skill-Content-Line-Count", String(review.lineCount));
  if (review.currentContentSha256) {
    context.header("X-Napier-Skill-Content-Current-SHA256", review.currentContentSha256);
  }
}

export function setSkillContentApplyResultHeaders(context: Context, result: ApplySkillContentResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Skill-Content-Review-SHA256", result.review.reviewSha256);
  context.header("X-Napier-Skill-Content-SHA256", result.review.contentSha256);
  context.header("X-Napier-Skill-Content-Action", result.review.action);
  context.header("X-Napier-Skill-Content-Applied", String(result.applied));
  context.header("X-Napier-Skill-Content-Size-Bytes", String(result.review.sizeBytes));
  context.header("X-Napier-Skill-Content-Line-Count", String(result.review.lineCount));
}

export function setPromptPackageVerificationHeaders(context: Context, verification: PromptPackageVerification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Prompt-Package-Status", verification.status);
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Prompt-Package-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

export function setPromptPackageQualificationHeaders(context: Context, qualification: PromptPackageQualification): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Prompt-Package-Status", qualification.status);
  context.header("X-Napier-Prompt-Package-Verification-Status", qualification.verificationStatus);
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header("X-Napier-Prompt-Package-Envelope-SHA256", qualification.envelopeSha256);
  }
  if (qualification.systemPromptSha256) {
    context.header("X-Napier-System-Prompt-SHA256", qualification.systemPromptSha256);
  }
  if (qualification.observedSystemPromptSha256) {
    context.header("X-Napier-Observed-System-Prompt-SHA256", qualification.observedSystemPromptSha256);
  }
  if (qualification.sourceAgentId) {
    context.header("X-Napier-Agent-Id", qualification.sourceAgentId);
  }
  if (qualification.observedAgentId) {
    context.header("X-Napier-Observed-Agent-Id", qualification.observedAgentId);
  }
  if (qualification.observedAgentRevision !== undefined) {
    context.header("X-Napier-Observed-Agent-Revision", String(qualification.observedAgentRevision));
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}
