import type { ExtensionConnection, ExtensionRecord } from "@napier/contracts";
import { nowIso } from "./ids.js";

export function updateExtensionConnection(
  current: ExtensionRecord,
  connection: ExtensionConnection,
): ExtensionRecord {
  return {
    ...current,
    connection,
    updatedAt: nowIso(),
    revision: current.revision + 1,
  };
}

export function normalizeMcpName(value: string, maxLength = 28): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, maxLength);
  if (!normalized) throw new Error("Name must contain letters or numbers");
  return normalized;
}

export function sanitizeUntrustedText(
  value: string,
  maxLength: number,
): string {
  return normalizeText(
    value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[<>]/g, (character) => (character === "<" ? "[" : "]")),
    maxLength,
  );
}

export function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
