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
