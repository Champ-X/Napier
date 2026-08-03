import type { ModelRef } from "@napier/contracts";

export function requestRecord(
  input: unknown,
  supportedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return Object.keys(record).every((key) => supportedKeys.includes(key))
    ? record
    : undefined;
}

export function validThreadId(value: unknown): value is string {
  return typeof value === "string" && /^thread_[a-z0-9]{8,80}$/u.test(value);
}

export function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isSha256String(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function normalizeBoundedText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/gu, " ").trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}

export function normalizeBoundedPrompt(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\r\n?/gu, "\n").trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

export function parseModelRef(input: unknown): ModelRef | undefined {
  const record = requestRecord(input, ["provider", "id"]);
  const provider =
    typeof record?.["provider"] === "string"
      ? record["provider"].trim().toLowerCase()
      : undefined;
  const id =
    typeof record?.["id"] === "string" ? record["id"].trim() : undefined;
  if (
    !provider ||
    !id ||
    !/^[a-z0-9][a-z0-9._-]{1,80}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    return undefined;
  }
  return { provider, id };
}
