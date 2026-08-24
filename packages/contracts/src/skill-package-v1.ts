export interface SkillSummary {
  name: string;
  description: string;
  source: "bundled" | "workspace" | "user";
  enabled: boolean;
}

export interface SkillPackageManifestSkill {
  name: string;
  relativePath: string;
  sizeBytes: number;
  contentSha256: string;
}

export interface SkillPackageManifest {
  kind: "napier.skill-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  requestedSkillNames: string[];
  loadedSkillNames: string[];
  missingSkillNames: string[];
  diagnosticsSha256: string;
  skillCatalogSha256: string;
  skills: SkillPackageManifestSkill[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface SkillPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedSkillPackageEnvelope {
  kind: "napier.signed-skill-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: SkillPackageManifest;
  signature: SkillPackageSignature;
  contentSha256: string;
}

export type SkillPackageVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid";

export interface SkillPackageVerification {
  status: SkillPackageVerificationStatus;
  verifiedAt: string;
  skillCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type SkillPackageQualificationStatus = "qualified" | "catalog_drift" | "missing_skill" | SkillPackageVerificationStatus;

export interface SkillPackageQualification {
  status: SkillPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: SkillPackageVerificationStatus;
  skillCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  skillCatalogSha256?: string;
  observedSkillCatalogSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignSkillPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  skillNames?: string[];
  expiresAt?: string;
}

export interface VerifySkillPackageRequest {
  envelope: unknown;
}

export interface QualifySkillPackageRequest {
  envelope: unknown;
  threadId?: string;
}

export type SkillPackageInstallationStatus = "active" | "replaced";

export interface SkillPackageInstallation {
  id: string;
  status: SkillPackageInstallationStatus;
  publisher: string;
  keyId: string;
  loadedSkillNames: string[];
  skillCatalogSha256: string;
  manifestSha256: string;
  envelopeSha256: string;
  skillNamesSha256: string;
  installedByThreadId: string;
  installedAt: string;
  replacesInstallationId?: string;
  replacedByInstallationId?: string;
  replacedAt?: string;
  contentSha256: string;
}

export interface InstallSkillPackageRequest {
  threadId: string;
  envelope: unknown;
  replaceInstallationId?: string;
  confirmReplacement?: boolean;
  confirmPublisherChange?: boolean;
  confirmSkillSetChange?: boolean;
}

export interface InstallSkillPackageResult {
  installation: SkillPackageInstallation;
  qualification: SkillPackageQualification;
  created: boolean;
  replacedInstallation?: SkillPackageInstallation;
}

export type SkillContentReviewAction = "install" | "replace" | "noop";

export interface SkillContentReview {
  kind: "napier.skill-content-review";
  schemaVersion: 1;
  apiVersion: string;
  skillName: string;
  relativePath: string;
  action: SkillContentReviewAction;
  sizeBytes: number;
  lineCount: number;
  contentSha256: string;
  frontmatterSha256: string;
  bodySha256: string;
  currentContentSha256?: string;
  currentSizeBytes?: number;
  currentLineCount?: number;
  generatedAt: string;
  reviewSha256: string;
}

export interface PreviewSkillContentRequest {
  threadId: string;
  content: string;
}

export interface ApplySkillContentRequest {
  threadId: string;
  content: string;
  expectedReviewSha256: string;
  confirmInstall?: boolean;
  confirmReplacement?: boolean;
}

export interface ApplySkillContentResult {
  review: SkillContentReview;
  applied: boolean;
}
