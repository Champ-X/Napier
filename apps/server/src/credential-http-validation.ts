import type {
  CreateCredentialReferenceRequest,
  CreateMacOsKeychainCredentialRequest,
  SetCredentialReferenceStatusRequest,
} from "@napier/contracts";

import {
  normalizeBoundedText,
  requestRecord,
  validThreadId,
} from "./http-request-validation.js";

export function parseCreateCredentialReferenceRequest(
  input: unknown,
): CreateCredentialReferenceRequest | undefined {
  const record = requestRecord(input, [
    "providerId",
    "label",
    "source",
    "threadId",
  ]);
  const providerId = normalizeProviderId(record?.["providerId"]);
  const label = normalizeBoundedText(record?.["label"], 1, 100);
  const source = parseCredentialReferenceSource(record?.["source"]);
  const threadId = record?.["threadId"];
  if (
    !record ||
    !providerId ||
    !label ||
    !source ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    providerId,
    label,
    source,
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseCreateMacOsKeychainCredentialRequest(
  input: unknown,
): CreateMacOsKeychainCredentialRequest | undefined {
  const record = requestRecord(input, [
    "providerId",
    "label",
    "service",
    "account",
    "secret",
    "replaceExisting",
    "threadId",
  ]);
  const providerId = normalizeProviderId(record?.["providerId"]);
  const label = normalizeBoundedText(record?.["label"], 1, 100);
  const service = parseSingleLineText(record?.["service"], 1, 200);
  const account = parseSingleLineText(record?.["account"], 1, 200);
  const secret = parseCredentialSecret(record?.["secret"]);
  const replaceExisting = record?.["replaceExisting"];
  const threadId = record?.["threadId"];
  if (
    !record ||
    !providerId ||
    !label ||
    !service ||
    !account ||
    !secret ||
    (replaceExisting !== undefined && typeof replaceExisting !== "boolean") ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    providerId,
    label,
    service,
    account,
    secret,
    ...(typeof replaceExisting === "boolean" ? { replaceExisting } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseCredentialThreadContextRequest(
  input: unknown,
): { threadId?: string } | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && (threadId === undefined || validThreadId(threadId))
    ? {
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

export function parseSetCredentialReferenceStatusRequest(
  input: unknown,
): SetCredentialReferenceStatusRequest | undefined {
  const record = requestRecord(input, ["status", "threadId"]);
  const status = record?.["status"];
  const threadId = record?.["threadId"];
  return record &&
    (status === "active" || status === "disabled") &&
    (threadId === undefined || validThreadId(threadId))
    ? {
        status,
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

function parseCredentialReferenceSource(
  input: unknown,
): CreateCredentialReferenceRequest["source"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  if (type === "environment") {
    const record = requestRecord(input, ["type", "variable"]);
    const variable =
      typeof record?.["variable"] === "string"
        ? record["variable"].trim()
        : undefined;
    return variable && /^[A-Z_][A-Z0-9_]{1,127}$/u.test(variable)
      ? { type, variable }
      : undefined;
  }
  if (type === "macos_keychain") {
    const record = requestRecord(input, ["type", "service", "account"]);
    const service = parseSingleLineText(record?.["service"], 1, 200);
    const account = parseSingleLineText(record?.["account"], 1, 200);
    return record && service && account
      ? { type, service, account }
      : undefined;
  }
  return undefined;
}

function parseCredentialSecret(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const secret = input.trim();
  return secret.length >= 8 &&
    secret.length <= 4096 &&
    !/[\u0000]/u.test(secret)
    ? secret
    : undefined;
}

function normalizeProviderId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,63}$/u.test(normalized) ? normalized : undefined;
}

function parseSingleLineText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string" || /[\u0000\r\n]/u.test(input)) {
    return undefined;
  }
  const normalized = input.replace(/\s+/gu, " ").trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}
