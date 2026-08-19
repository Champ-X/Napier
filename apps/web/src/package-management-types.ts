import type {
  PromptPackageQualification,
  PromptPackageVerification,
  SkillContentReview,
  SkillPackageQualification,
  SkillPackageVerification,
} from "@napier/contracts";

export type PromptPackageReceipt =
  | {
      action: "signed";
      status: "signed";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      systemPromptSha256: string;
      keyId: string;
      agentRevision: number;
    }
  | {
      action: "verified";
      status: PromptPackageVerification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      keyId?: string;
    }
  | {
      action: "qualified";
      status: PromptPackageQualification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      systemPromptSha256?: string;
      observedSystemPromptSha256?: string;
      keyId?: string;
      observedAgentRevision?: number;
    };

export type SkillPackageReceipt =
  | {
      action: "signed";
      status: "signed";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      skillCatalogSha256: string;
      keyId: string;
      skillCount: number;
    }
  | {
      action: "verified";
      status: SkillPackageVerification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      keyId?: string;
      skillCount: number;
    }
  | {
      action: "qualified";
      status: SkillPackageQualification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      skillCatalogSha256?: string;
      observedSkillCatalogSha256?: string;
      keyId?: string;
      skillCount: number;
    }
  | {
      action: "installed";
      status: "installed" | "matched";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      skillCatalogSha256: string;
      keyId: string;
      skillCount: number;
      installationId: string;
      replacedInstallationId?: string;
    };

export type SkillContentReceipt =
  | {
      action: "previewed";
      review: SkillContentReview;
      reason: string;
    }
  | {
      action: "applied";
      review: SkillContentReview;
      applied: boolean;
      reason: string;
    };
