import { validAgentId } from "./app-http-response-core.js";
import { requestRecord, validThreadId } from "./http-request-validation.js";
import type { ApplyExtensionPackageDeploymentRequest, ApplyExtensionPackageRolloutChannelRequest, ApplyExtensionPackageUpdateRequest, ApplySkillContentRequest, CreateExtensionPublisherTrustAnchorRequest, ExportExtensionPackageLockfileRequest, ImportSignedExtensionPackageRequest, InstallSkillPackageRequest, PreviewExtensionPackageDeploymentRequest, PreviewExtensionPackageRolloutChannelRequest, PreviewExtensionPackageUpdateRequest, PreviewSkillContentRequest, PublishExtensionPackageRolloutChannelRequest, QualifyInspectorPackageRequest, QualifyPromptPackageRequest, QualifySkillPackageRequest, RevokeExtensionPublisherTrustAnchorRequest, SignExtensionPackageChannelIndexRequest, SignExtensionPackageRequest, SignInspectorPackageRequest, SignPromptPackageRequest, SignSkillPackageRequest, VerifyExtensionPackageChannelIndexRequest, VerifyExtensionPackageLockfileRequest, VerifyInspectorPackageRequest, VerifyPromptPackageRequest, VerifySignedExtensionPackageRequest, VerifySkillPackageRequest } from "@napier/contracts";
import { MAX_EXTENSION_PACKAGE_DEPENDENCIES, MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES } from "@napier/runtime";

export function parseCreateExtensionPublisherTrustAnchorRequest(input: unknown): CreateExtensionPublisherTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "source"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const source = requestRecord(record?.["source"], ["type", "variable", "publicKeySpki"]);
  const type = source?.["type"];
  if (!record || !validThreadId(threadId) || typeof label !== "string" || !label.replace(/\s+/g, " ").trim() || label.replace(/\s+/g, " ").trim().length > 100 || !source || (type !== "environment" && type !== "public_key")) {
    return undefined;
  }
  if (type === "environment") {
    const variable = source["variable"];
    if (Object.keys(source).some((key) => key !== "type" && key !== "variable") || typeof variable !== "string" || !/^[A-Z_][A-Z0-9_]{1,127}$/.test(variable.trim().toUpperCase())) {
      return undefined;
    }
    return {
      threadId,
      label,
      source: { type, variable },
    };
  }
  const publicKeySpki = source["publicKeySpki"];
  if (Object.keys(source).some((key) => key !== "type" && key !== "publicKeySpki") || typeof publicKeySpki !== "string" || publicKeySpki.length === 0 || publicKeySpki.length > 4_096) {
    return undefined;
  }
  return {
    threadId,
    label,
    source: { type, publicKeySpki },
  };
}

export function parseRevokeExtensionPublisherTrustAnchorRequest(input: unknown): RevokeExtensionPublisherTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && validThreadId(threadId) ? { threadId } : undefined;
}

export function parseSignExtensionPackageRequest(input: unknown): SignExtensionPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "publisher", "dependencies", "expiresAt"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const dependenciesInput = record?.["dependencies"];
  const dependencies = parseExtensionPackageDependencies(dependenciesInput);
  const expiresAt = record?.["expiresAt"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || typeof publisher !== "string" || !publisher.replace(/\s+/g, " ").trim() || publisher.replace(/\s+/g, " ").trim().length > 120 || /[\u0000-\u001f\u007f<>]/.test(publisher) || (dependenciesInput !== undefined && dependencies === undefined) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(dependencies ? { dependencies } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parseSignSkillPackageRequest(input: unknown): SignSkillPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "publisher", "skillNames", "expiresAt"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const skillNames = record?.["skillNames"];
  const expiresAt = record?.["expiresAt"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || typeof publisher !== "string" || !publisher.replace(/\s+/g, " ").trim() || publisher.replace(/\s+/g, " ").trim().length > 120 || /[\u0000-\u001f\u007f<>]/.test(publisher) || (skillNames !== undefined && (!Array.isArray(skillNames) || skillNames.length > 128 || skillNames.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) || new Set(skillNames).size !== skillNames.length)) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(Array.isArray(skillNames) ? { skillNames } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parseSignPromptPackageRequest(input: unknown): SignPromptPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "publisher", "agentId", "expiresAt"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const agentId = record?.["agentId"];
  const expiresAt = record?.["expiresAt"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || typeof publisher !== "string" || !publisher.replace(/\s+/g, " ").trim() || publisher.replace(/\s+/g, " ").trim().length > 120 || /[\u0000-\u001f\u007f<>]/.test(publisher) || typeof agentId !== "string" || !validAgentId(agentId) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    agentId,
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parseSignInspectorPackageRequest(input: unknown): SignInspectorPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "publisher", "expiresAt"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const expiresAt = record?.["expiresAt"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || typeof publisher !== "string" || !publisher.replace(/\s+/g, " ").trim() || publisher.replace(/\s+/g, " ").trim().length > 120 || /[\u0000-\u001f\u007f<>]/.test(publisher) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parseSignExtensionPackageChannelIndexRequest(input: unknown): SignExtensionPackageChannelIndexRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId", "publisher", "channelIds", "lockfileBaseUrl", "expiresAt"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const channelIds = record?.["channelIds"];
  const lockfileBaseUrl = record?.["lockfileBaseUrl"];
  const expiresAt = record?.["expiresAt"];
  if (!record || !validThreadId(threadId) || typeof trustAnchorId !== "string" || !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) || typeof publisher !== "string" || !publisher.replace(/\s+/g, " ").trim() || publisher.replace(/\s+/g, " ").trim().length > 120 || /[\u0000-\u001f\u007f<>]/.test(publisher) || (channelIds !== undefined && (!Array.isArray(channelIds) || channelIds.length < 1 || channelIds.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES || channelIds.some((id) => typeof id !== "string" || !/^rollout_[a-z0-9]{8,80}$/.test(id)) || new Set(channelIds).size !== channelIds.length)) || (lockfileBaseUrl !== undefined && (typeof lockfileBaseUrl !== "string" || lockfileBaseUrl.length > 500 || /[\u0000-\u001f\u007f<>]/.test(lockfileBaseUrl))) || (expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))))) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(Array.isArray(channelIds) ? { channelIds } : {}),
    ...(typeof lockfileBaseUrl === "string" ? { lockfileBaseUrl } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

export function parseExtensionPackageDependencies(input: unknown): SignExtensionPackageRequest["dependencies"] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_EXTENSION_PACKAGE_DEPENDENCIES) {
    return undefined;
  }
  const dependencies: NonNullable<SignExtensionPackageRequest["dependencies"]> = [];
  for (const value of input) {
    const record = requestRecord(value, ["normalizedName", "versionRange"]);
    const normalizedName = record?.["normalizedName"];
    const versionRange = record?.["versionRange"];
    if (!record || typeof normalizedName !== "string" || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(normalizedName) || typeof versionRange !== "string" || !versionRange.trim() || versionRange.length > 120) {
      return undefined;
    }
    dependencies.push({ normalizedName, versionRange });
  }
  return dependencies;
}

export function parseVerifySignedExtensionPackageRequest(input: unknown): VerifySignedExtensionPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseVerifySkillPackageRequest(input: unknown): VerifySkillPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseVerifyPromptPackageRequest(input: unknown): VerifyPromptPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseVerifyInspectorPackageRequest(input: unknown): VerifyInspectorPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseQualifySkillPackageRequest(input: unknown): QualifySkillPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "threadId"]);
  const threadId = record?.["threadId"];
  if (!record || record["envelope"] === undefined || (threadId !== undefined && !validThreadId(threadId))) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseInstallSkillPackageRequest(input: unknown): InstallSkillPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "envelope", "replaceInstallationId", "confirmReplacement", "confirmPublisherChange", "confirmSkillSetChange"]);
  const threadId = record?.["threadId"];
  const replaceInstallationId = record?.["replaceInstallationId"];
  const confirmReplacement = record?.["confirmReplacement"];
  const confirmPublisherChange = record?.["confirmPublisherChange"];
  const confirmSkillSetChange = record?.["confirmSkillSetChange"];
  if (!record || !validThreadId(threadId) || record["envelope"] === undefined || (replaceInstallationId !== undefined && (typeof replaceInstallationId !== "string" || !/^skillinstall_[a-z0-9]{8,80}$/.test(replaceInstallationId))) || (confirmReplacement !== undefined && typeof confirmReplacement !== "boolean") || (confirmPublisherChange !== undefined && typeof confirmPublisherChange !== "boolean") || (confirmSkillSetChange !== undefined && typeof confirmSkillSetChange !== "boolean")) {
    return undefined;
  }
  return {
    threadId,
    envelope: record["envelope"],
    ...(typeof replaceInstallationId === "string" ? { replaceInstallationId } : {}),
    ...(typeof confirmReplacement === "boolean" ? { confirmReplacement } : {}),
    ...(typeof confirmPublisherChange === "boolean" ? { confirmPublisherChange } : {}),
    ...(typeof confirmSkillSetChange === "boolean" ? { confirmSkillSetChange } : {}),
  };
}

export function parsePreviewSkillContentRequest(input: unknown): PreviewSkillContentRequest | undefined {
  const record = requestRecord(input, ["threadId", "content"]);
  const threadId = record?.["threadId"];
  const content = record?.["content"];
  if (!record || !validThreadId(threadId) || typeof content !== "string") {
    return undefined;
  }
  return { threadId, content };
}

export function parseApplySkillContentRequest(input: unknown): ApplySkillContentRequest | undefined {
  const record = requestRecord(input, ["threadId", "content", "expectedReviewSha256", "confirmInstall", "confirmReplacement"]);
  const threadId = record?.["threadId"];
  const content = record?.["content"];
  const expectedReviewSha256 = record?.["expectedReviewSha256"];
  const confirmInstall = record?.["confirmInstall"];
  const confirmReplacement = record?.["confirmReplacement"];
  if (!record || !validThreadId(threadId) || typeof content !== "string" || typeof expectedReviewSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedReviewSha256) || (confirmInstall !== undefined && typeof confirmInstall !== "boolean") || (confirmReplacement !== undefined && typeof confirmReplacement !== "boolean")) {
    return undefined;
  }
  return {
    threadId,
    content,
    expectedReviewSha256,
    ...(typeof confirmInstall === "boolean" ? { confirmInstall } : {}),
    ...(typeof confirmReplacement === "boolean" ? { confirmReplacement } : {}),
  };
}

export function parseQualifyPromptPackageRequest(input: unknown): QualifyPromptPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "agentId", "threadId"]);
  const threadId = record?.["threadId"];
  const agentId = record?.["agentId"];
  if (!record || record["envelope"] === undefined || (threadId !== undefined && !validThreadId(threadId)) || (agentId !== undefined && !validAgentId(agentId))) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof agentId === "string" ? { agentId } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseQualifyInspectorPackageRequest(input: unknown): QualifyInspectorPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "threadId"]);
  const threadId = record?.["threadId"];
  if (!record || record["envelope"] === undefined || (threadId !== undefined && !validThreadId(threadId))) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseVerifyExtensionPackageChannelIndexRequest(input: unknown): VerifyExtensionPackageChannelIndexRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseExportExtensionPackageLockfileRequest(input: unknown): ExportExtensionPackageLockfileRequest | undefined {
  const record = requestRecord(input, ["threadId", "extensionIds"]);
  const threadId = record?.["threadId"];
  const extensionIds = record?.["extensionIds"];
  if (!record || !validThreadId(threadId) || (extensionIds !== undefined && (!Array.isArray(extensionIds) || extensionIds.length < 1 || extensionIds.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES || extensionIds.some((id) => typeof id !== "string" || !/^ext_[a-z0-9]{8,80}$/.test(id)) || new Set(extensionIds).size !== extensionIds.length))) {
    return undefined;
  }
  return {
    threadId,
    ...(Array.isArray(extensionIds) ? { extensionIds } : {}),
  };
}

export function parseVerifyExtensionPackageLockfileRequest(input: unknown): VerifyExtensionPackageLockfileRequest | undefined {
  const record = requestRecord(input, ["lockfile"]);
  return record && record["lockfile"] !== undefined ? { lockfile: record["lockfile"] } : undefined;
}

export function parsePublishExtensionPackageRolloutChannelRequest(input: unknown): PublishExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, ["threadId", "name", "description", "extensionIds", "expectedRevision", "policy"]);
  const threadId = record?.["threadId"];
  const name = record?.["name"];
  const description = record?.["description"];
  const extensionIds = record?.["extensionIds"];
  const expectedRevision = record?.["expectedRevision"];
  const policy = parseExtensionPackageRolloutPolicy(record?.["policy"]);
  if (!record || !validThreadId(threadId) || !validRolloutChannelName(name) || !validOptionalRolloutDescription(description) || !validOptionalExtensionIds(extensionIds) || !validOptionalPositiveRevision(expectedRevision) || (record["policy"] !== undefined && policy === undefined)) {
    return undefined;
  }
  return {
    threadId,
    name,
    ...(typeof description === "string" ? { description } : {}),
    ...(Array.isArray(extensionIds) ? { extensionIds } : {}),
    ...(typeof expectedRevision === "number" ? { expectedRevision } : {}),
    ...(policy ? { policy } : {}),
  };
}

function validRolloutChannelName(value: unknown): value is string {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized.length >= 1 && normalized.length <= 80 && typeof value === "string" && !/[\u0000-\u001f\u007f<>]/.test(value);
}

function validOptionalRolloutDescription(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.replace(/\s+/g, " ").trim().length <= 240 && !/[\u0000-\u001f\u007f<>]/.test(value));
}

function validOptionalExtensionIds(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length >= 1 && value.length <= MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES && value.every((id) => typeof id === "string" && /^ext_[a-z0-9]{8,80}$/.test(id)) && new Set(value).size === value.length);
}

function validOptionalPositiveRevision(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1);
}

export function parseExtensionPackageRolloutPolicy(input: unknown): PublishExtensionPackageRolloutChannelRequest["policy"] | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, ["maxPackages", "allowedPublisherKeyIds", "allowedPackageNames"]);
  const maxPackages = record?.["maxPackages"];
  const allowedPublisherKeyIds = record?.["allowedPublisherKeyIds"];
  const allowedPackageNames = record?.["allowedPackageNames"];
  if (!record || (maxPackages !== undefined && (typeof maxPackages !== "number" || !Number.isSafeInteger(maxPackages) || maxPackages < 1 || maxPackages > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES)) || (allowedPublisherKeyIds !== undefined && (!Array.isArray(allowedPublisherKeyIds) || allowedPublisherKeyIds.length < 1 || allowedPublisherKeyIds.length > 32 || allowedPublisherKeyIds.some((keyId) => typeof keyId !== "string" || !/^[a-f0-9]{64}$/.test(keyId)) || new Set(allowedPublisherKeyIds).size !== allowedPublisherKeyIds.length)) || (allowedPackageNames !== undefined && (!Array.isArray(allowedPackageNames) || allowedPackageNames.length < 1 || allowedPackageNames.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES || allowedPackageNames.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(name)) || new Set(allowedPackageNames).size !== allowedPackageNames.length))) {
    return undefined;
  }
  return {
    ...(typeof maxPackages === "number" ? { maxPackages } : {}),
    ...(Array.isArray(allowedPublisherKeyIds) ? { allowedPublisherKeyIds } : {}),
    ...(Array.isArray(allowedPackageNames) ? { allowedPackageNames } : {}),
  };
}

export function parsePreviewExtensionPackageRolloutChannelRequest(input: unknown): PreviewExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, ["channelId"]);
  const channelId = record?.["channelId"];
  return record && typeof channelId === "string" && /^rollout_[a-z0-9]{8,80}$/.test(channelId) ? { channelId } : undefined;
}

export function parseApplyExtensionPackageRolloutChannelRequest(input: unknown): ApplyExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, ["threadId", "channelId", "expectedRolloutSha256", "expectedDeploymentSha256", "confirmPublisherChanges", "confirmVersionOverrides"]);
  const threadId = record?.["threadId"];
  const channelId = record?.["channelId"];
  const expectedRolloutSha256 = record?.["expectedRolloutSha256"];
  const expectedDeploymentSha256 = record?.["expectedDeploymentSha256"];
  const confirmPublisherChanges = record?.["confirmPublisherChanges"];
  const confirmVersionOverrides = record?.["confirmVersionOverrides"];
  if (!record || !validThreadId(threadId) || typeof channelId !== "string" || !/^rollout_[a-z0-9]{8,80}$/.test(channelId) || typeof expectedRolloutSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedRolloutSha256) || typeof expectedDeploymentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedDeploymentSha256) || (confirmPublisherChanges !== undefined && typeof confirmPublisherChanges !== "boolean") || (confirmVersionOverrides !== undefined && typeof confirmVersionOverrides !== "boolean")) {
    return undefined;
  }
  return {
    threadId,
    channelId,
    expectedRolloutSha256,
    expectedDeploymentSha256,
    ...(confirmPublisherChanges === true ? { confirmPublisherChanges: true } : {}),
    ...(confirmVersionOverrides === true ? { confirmVersionOverrides: true } : {}),
  };
}

export function parsePreviewExtensionPackageDeploymentRequest(input: unknown): PreviewExtensionPackageDeploymentRequest | undefined {
  const record = requestRecord(input, ["envelopes"]);
  const envelopes = record?.["envelopes"];
  return record && Array.isArray(envelopes) && envelopes.length >= 1 && envelopes.length <= MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ? { envelopes } : undefined;
}

export function parseApplyExtensionPackageDeploymentRequest(input: unknown): ApplyExtensionPackageDeploymentRequest | undefined {
  const record = requestRecord(input, ["threadId", "envelopes", "expectedDeploymentSha256", "confirmPublisherChanges", "confirmVersionOverrides"]);
  const threadId = record?.["threadId"];
  const envelopes = record?.["envelopes"];
  const expectedDeploymentSha256 = record?.["expectedDeploymentSha256"];
  const confirmPublisherChanges = record?.["confirmPublisherChanges"];
  const confirmVersionOverrides = record?.["confirmVersionOverrides"];
  if (!record || !validThreadId(threadId) || !Array.isArray(envelopes) || envelopes.length < 1 || envelopes.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES || typeof expectedDeploymentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedDeploymentSha256) || (confirmPublisherChanges !== undefined && typeof confirmPublisherChanges !== "boolean") || (confirmVersionOverrides !== undefined && typeof confirmVersionOverrides !== "boolean")) {
    return undefined;
  }
  return {
    threadId,
    envelopes,
    expectedDeploymentSha256,
    ...(confirmPublisherChanges === true ? { confirmPublisherChanges: true } : {}),
    ...(confirmVersionOverrides === true ? { confirmVersionOverrides: true } : {}),
  };
}

export function parsePreviewExtensionPackageUpdateRequest(input: unknown): PreviewExtensionPackageUpdateRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined ? { envelope: record["envelope"] } : undefined;
}

export function parseApplyExtensionPackageUpdateRequest(input: unknown): ApplyExtensionPackageUpdateRequest | undefined {
  const record = requestRecord(input, ["threadId", "envelope", "expectedPackageBindingSha256", "confirmPublisherChange", "confirmVersionOverride"]);
  const threadId = record?.["threadId"];
  const expectedPackageBindingSha256 = record?.["expectedPackageBindingSha256"];
  const confirmPublisherChange = record?.["confirmPublisherChange"];
  const confirmVersionOverride = record?.["confirmVersionOverride"];
  if (!record || !validThreadId(threadId) || record["envelope"] === undefined || typeof expectedPackageBindingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedPackageBindingSha256) || (confirmPublisherChange !== undefined && typeof confirmPublisherChange !== "boolean") || (confirmVersionOverride !== undefined && typeof confirmVersionOverride !== "boolean")) {
    return undefined;
  }
  return {
    threadId,
    envelope: record["envelope"],
    expectedPackageBindingSha256,
    ...(confirmPublisherChange === true ? { confirmPublisherChange: true } : {}),
    ...(confirmVersionOverride === true ? { confirmVersionOverride: true } : {}),
  };
}

export function parseImportSignedExtensionPackageRequest(input: unknown): ImportSignedExtensionPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "envelope"]);
  const threadId = record?.["threadId"];
  return record && validThreadId(threadId) && record["envelope"] !== undefined ? { threadId, envelope: record["envelope"] } : undefined;
}
