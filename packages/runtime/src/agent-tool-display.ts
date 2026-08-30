import type { JsonValue } from "@napier/contracts";

const REDACTED = "[redacted]";
const SECRET_KEY =
  /(?:api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|credential|private[-_]?key)/iu;
const SECRET_ASSIGNMENT =
  /\b([A-Z][A-Z0-9_]*(?:KEY|KRY|TOKEN|PASSWORD|PASSWD|SECRET|COOKIE|CREDENTIAL))=(?:'[^']*'|"[^"]*"|[^\s]+)/gu;
const SECRET_FLAG =
  /(--?(?:api[-_]?key|token|password|passwd|secret|cookie|credential))(?:=|\s+)(?:'[^']*'|"[^"]*"|[^\s]+)/giu;
const INLINE_SECRET_ASSIGNMENT =
  /\b((?:api[-_]?key|auth(?:orization)?|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|cookie|credential))=(?:'[^']*'|"[^"]*"|[^\s&#]+)/giu;
const URL_QUERY_SECRET =
  /([?&](?:api[-_]?key|auth(?:orization)?|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|cookie|credential)=)[^&#\s"']*/giu;
const AUTHORIZATION = /\b(Bearer|Basic)\s+[^\s,;]+/giu;
const SECRET_HEADER =
  /\b(Authorization|Cookie|Set-Cookie|X-Api-Key)\s*:\s*[^\r\n]+/giu;
const JSON_SECRET =
  /(["'](?:api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|credential|private[-_]?key)["']\s*:\s*)(["'][^"']*["']|[^,}\s]+)/giu;
const PRIVATE_KEY =
  /-----BEGIN [^-]*(?:PRIVATE KEY|SECRET)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|SECRET)-----/gu;
const CREDENTIAL_PREFIX =
  /\b(?:sk|ghp|gho|github_pat|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{12,}\b/gu;

/** Produces a redacted local-only input surface; it must never enter Ledger events. */
export function formatAgentToolDisplayInput(
  toolName: string,
  input: unknown,
): string {
  const safe = sanitizeDisplayValue(input, toolName === "browser");
  return JSON.stringify(safe, null, 2);
}

/** Produces a redacted local-only output surface; it must never enter Ledger events. */
export function formatAgentToolDisplayOutput(output: string): string {
  return sanitizeDisplayText(output);
}

export function sanitizeDisplayText(value: string): string {
  return value
    .replace(PRIVATE_KEY, REDACTED)
    .replace(SECRET_HEADER, (_match, key: string) => `${key}: ${REDACTED}`)
    .replace(JSON_SECRET, (_match, prefix: string) => `${prefix}"${REDACTED}"`)
    .replace(AUTHORIZATION, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(SECRET_FLAG, (_match, flag: string) => `${flag}=${REDACTED}`)
    .replace(
      INLINE_SECRET_ASSIGNMENT,
      (_match, key: string) => `${key}=${REDACTED}`,
    )
    .replace(
      URL_QUERY_SECRET,
      (_match, prefix: string) => `${prefix}${REDACTED}`,
    )
    .replace(CREDENTIAL_PREFIX, REDACTED);
}

function sanitizeDisplayValue(
  value: unknown,
  browserInput: boolean,
): JsonValue {
  return sanitizeValue(value, browserInput, undefined, new WeakSet<object>());
}

function sanitizeValue(
  value: unknown,
  browserInput: boolean,
  key: string | undefined,
  seen: WeakSet<object>,
): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (key && SECRET_KEY.test(key)) return REDACTED;
    if (browserInput && key === "text") return REDACTED;
    return sanitizeDisplayText(sanitizeUrl(value));
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value !== "object") return sanitizeDisplayText(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry, index) => {
      const previous = value[index - 1];
      if (
        typeof previous === "string" &&
        /^--?(?:api[-_]?key|token|password|passwd|secret|cookie|credential)$/iu.test(
          previous,
        )
      ) {
        return REDACTED;
      }
      return sanitizeValue(entry, browserInput, key, seen);
    });
    seen.delete(value);
    return result;
  }
  const result: Record<string, JsonValue> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeValue(entryValue, browserInput, entryKey, seen);
  }
  seen.delete(value);
  return result;
}

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//iu.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.href;
  } catch {
    return value;
  }
}
