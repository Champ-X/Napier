import { NAPIER_API_VERSION } from "@napier/contracts";

export interface PromptPackageSignatureStatement {
  kind: "napier.prompt-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export function createPromptPackageSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): PromptPackageSignatureStatement {
  return {
    kind: "napier.prompt-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

export function normalizePublisher(value: string): string {
  return visibleText(value, "Prompt package publisher", 120, true);
}

export function normalizeAgentName(value: string): string {
  return visibleText(value, "Prompt package Agent name", 80, true);
}

export function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!validTimestamp(value) || value <= createdAt) {
    throw new Error("Prompt package expiry is invalid");
  }
  return value;
}

export function visibleText(
  value: string,
  label: string,
  maxLength: number,
  required: boolean,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (required && !normalized) throw new Error(`${label} is required`);
  if (
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f<>]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export function validTimestamp(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function assertExactRecord(
  value: unknown,
  label: string,
  requiredKeys: string[],
  optionalKeys: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) {
    if (!(key in record)) throw new Error(`${label} is missing ${key}`);
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} has unsupported field`);
  }
  return record;
}
