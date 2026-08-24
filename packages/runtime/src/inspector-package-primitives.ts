import {
  NAPIER_API_VERSION,
  NAPIER_INSPECTOR_PANELS,
  type InspectorPackageManifestPanel,
} from "@napier/contracts";

export const SHA256 = /^[a-f0-9]{64}$/;

export const CAPABILITY = /^[a-z][a-z0-9_-]{1,60}$/;

export const PANEL_IDS = new Set(
  NAPIER_INSPECTOR_PANELS.map((panel) => panel.id),
);

export interface InspectorPackageSignatureStatement {
  kind: "napier.inspector-package-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  manifestContentSha256: string;
  manifestArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export function createInspectorPackageSignatureStatement(
  manifestContentSha256: string,
  manifestArtifactSha256: string,
  keyId: string,
  signedAt: string,
): InspectorPackageSignatureStatement {
  return {
    kind: "napier.inspector-package-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    manifestContentSha256,
    manifestArtifactSha256,
    keyId,
    signedAt,
  };
}

export function validateInspectorPanels(
  value: unknown,
): InspectorPackageManifestPanel[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error("Inspector package panels are invalid");
  }
  const seen = new Set<string>();
  return value.map((panel) => {
    const normalized = normalizeInspectorPanel(panel);
    if (seen.has(normalized.id)) {
      throw new Error("Inspector package panel IDs must be unique");
    }
    seen.add(normalized.id);
    return normalized;
  });
}

export function normalizeInspectorPanel(
  value: unknown,
): InspectorPackageManifestPanel {
  const panel = assertExactRecord(value, "Inspector package panel", [
    "id",
    "label",
    "surface",
    "capabilities",
  ]) as unknown as InspectorPackageManifestPanel;
  if (
    !PANEL_IDS.has(panel.id) ||
    (panel.surface !== "core" && panel.surface !== "lazy")
  ) {
    throw new Error("Inspector package panel header is invalid");
  }
  const label = visibleText(panel.label, "Inspector package panel label", 80);
  if (
    !Array.isArray(panel.capabilities) ||
    panel.capabilities.length < 1 ||
    panel.capabilities.length > 32 ||
    panel.capabilities.some(
      (capability) =>
        typeof capability !== "string" || !CAPABILITY.test(capability),
    )
  ) {
    throw new Error("Inspector package panel capabilities are invalid");
  }
  const capabilities = [...new Set(panel.capabilities)].sort();
  if (capabilities.length !== panel.capabilities.length) {
    throw new Error("Inspector package panel capabilities must be unique");
  }
  return {
    id: panel.id,
    label,
    surface: panel.surface,
    capabilities,
  };
}

export function normalizePublisher(value: string): string {
  return visibleText(value, "Inspector package publisher", 120);
}

export function normalizeOptionalExpiry(
  value: string | undefined,
  createdAt: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!validTimestamp(value) || value <= createdAt) {
    throw new Error("Inspector package expiry is invalid");
  }
  return value;
}

export function visibleText(
  value: string,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
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
