import type {
  AgentProfile,
  AgentProfileRevision,
  AgentProfileRollbackResult,
  ApplySkillContentRequest,
  ApplySkillContentResult,
  CreateCredentialReferenceRequest,
  CreateMacOsKeychainCredentialRequest,
  CredentialReference,
  InstallSkillPackageRequest,
  InstallSkillPackageResult,
  PreviewSkillContentRequest,
  PromptPackageQualification,
  PromptPackageVerification,
  QualifyPromptPackageRequest,
  QualifySkillPackageRequest,
  RollbackAgentProfileRequest,
  SetCredentialReferenceStatusRequest,
  SignedPromptPackageEnvelope,
  SignedSkillPackageEnvelope,
  SignPromptPackageRequest,
  SignSkillPackageRequest,
  SkillContentReview,
  SkillPackageQualification,
  SkillPackageVerification,
  UpdateAgentProfileRequest,
  VerifyPromptPackageRequest,
  VerifySkillPackageRequest,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { requestJson } from "./api-client";

export function updateAgentProfile(
  agentId: string,
  body: UpdateAgentProfileRequest,
): Promise<AgentProfile> {
  return requestJson(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function getAgentProfileRevisions(
  agentId: string,
): Promise<AgentProfileRevision[]> {
  return requestJson(`/api/agents/${encodeURIComponent(agentId)}/revisions`);
}

export function rollbackAgentProfileRevision(
  agentId: string,
  body: RollbackAgentProfileRequest,
): Promise<AgentProfileRollbackResult> {
  return requestJson(`/api/agents/${encodeURIComponent(agentId)}/rollback`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getContextBootstrap(
  threadId: string,
): Promise<LiveReadyBootstrapResponse> {
  return requestJson(`/api/bootstrap?thread=${encodeURIComponent(threadId)}`);
}

export function createCredentialReference(
  body: CreateCredentialReferenceRequest,
): Promise<CredentialReference> {
  return requestJson("/api/credentials", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createMacOsKeychainCredential(
  body: CreateMacOsKeychainCredentialRequest,
): Promise<CredentialReference> {
  return requestJson("/api/credentials/macos-keychain", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function checkCredentialReference(
  referenceId: string,
  threadId?: string,
): Promise<CredentialReference> {
  return requestJson(
    `/api/credentials/${encodeURIComponent(referenceId)}/check`,
    {
      method: "POST",
      body: JSON.stringify(threadId ? { threadId } : {}),
    },
  );
}

export function setCredentialReferenceStatus(
  referenceId: string,
  body: SetCredentialReferenceStatusRequest,
): Promise<CredentialReference> {
  return requestJson(
    `/api/credentials/${encodeURIComponent(referenceId)}/status`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function signPromptPackage(
  body: SignPromptPackageRequest,
): Promise<SignedPromptPackageEnvelope> {
  return requestJson("/api/prompts/packages/sign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyPromptPackage(
  body: VerifyPromptPackageRequest,
): Promise<PromptPackageVerification> {
  return requestJson("/api/prompts/packages/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function qualifyPromptPackage(
  body: QualifyPromptPackageRequest,
): Promise<PromptPackageQualification> {
  return requestJson("/api/prompts/packages/qualify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function signSkillPackage(
  body: SignSkillPackageRequest,
): Promise<SignedSkillPackageEnvelope> {
  return requestJson("/api/skills/packages/sign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifySkillPackage(
  body: VerifySkillPackageRequest,
): Promise<SkillPackageVerification> {
  return requestJson("/api/skills/packages/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function qualifySkillPackage(
  body: QualifySkillPackageRequest,
): Promise<SkillPackageQualification> {
  return requestJson("/api/skills/packages/qualify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function installSkillPackage(
  body: InstallSkillPackageRequest,
): Promise<InstallSkillPackageResult> {
  return requestJson("/api/skills/packages/installations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function previewSkillContent(
  body: PreviewSkillContentRequest,
): Promise<SkillContentReview> {
  return requestJson("/api/skills/content/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function applySkillContent(
  body: ApplySkillContentRequest,
): Promise<ApplySkillContentResult> {
  return requestJson("/api/skills/content/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
