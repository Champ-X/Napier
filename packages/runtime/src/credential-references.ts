import type {
  CreateCredentialReferenceRequest,
  CredentialAvailability,
  CredentialReference,
  CredentialReferenceStatus,
} from "@napier/contracts";

import { createId, nowIso } from "./ids.js";

export function createCredentialReference(
  request: CreateCredentialReferenceRequest,
): CredentialReference {
  const providerId = normalizeId(request.providerId, "provider");
  const label = normalizeText(request.label, 100);
  if (!label) throw new Error("Credential reference label is required");
  const timestamp = nowIso();
  return {
    id: createId("credential"),
    providerId,
    label,
    source: normalizeCredentialSource(request.source),
    status: "active",
    availability: "unknown",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function setCredentialReferenceStatus(
  reference: CredentialReference,
  status: CredentialReferenceStatus,
): CredentialReference {
  if (reference.status === status) return structuredClone(reference);
  return {
    ...reference,
    status,
    availability: status === "disabled" ? "unknown" : reference.availability,
    revision: reference.revision + 1,
    updatedAt: nowIso(),
  };
}

export function recordCredentialAvailability(
  reference: CredentialReference,
  availability: CredentialAvailability,
  error?: string,
): CredentialReference {
  const timestamp = nowIso();
  const lastError = normalizeText(error, 500);
  const updated: CredentialReference = {
    ...reference,
    availability,
    lastCheckedAt: timestamp,
    revision: reference.revision + 1,
    updatedAt: timestamp,
  };
  if (lastError) updated.lastError = lastError;
  else delete updated.lastError;
  return updated;
}

export function credentialSourceKey(
  reference: Pick<CredentialReference, "providerId" | "source">,
): string {
  return reference.source.type === "environment"
    ? `${reference.providerId}:environment:${reference.source.variable}`
    : `${reference.providerId}:macos_keychain:${reference.source.service}:${reference.source.account}`;
}

function normalizeCredentialSource(
  source: CreateCredentialReferenceRequest["source"],
): CredentialReference["source"] {
  if (source.type === "environment") {
    const variable = source.variable.trim();
    if (!/^[A-Z_][A-Z0-9_]{1,127}$/.test(variable)) {
      throw new Error(`Invalid credential environment variable: ${variable}`);
    }
    return { type: "environment", variable };
  }
  const service = normalizeText(source.service, 200);
  const account = normalizeText(source.account, 200);
  if (!service || !account) {
    throw new Error("Keychain references require service and account");
  }
  if (/[\u0000\r\n]/.test(service) || /[\u0000\r\n]/.test(account)) {
    throw new Error("Keychain service and account must be single-line text");
  }
  return { type: "macos_keychain", service, account };
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`Invalid ${label} ID: ${value}`);
  }
  return normalized;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
