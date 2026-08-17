export type Locale = "en" | "zh";

const STORAGE_KEY = "napier.locale";
const DEFAULT_LOCALE: Locale = "zh";

export function getLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // localStorage may be unavailable; fall through to the default.
  }
  return DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore persistence failures; the reload below still applies the choice
    // for this session via the in-memory default path.
  }
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  window.location.reload();
}

export function applyDocumentLocale(locale: Locale = getLocale()): void {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

type DeepStringly<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepStringly<T[K]>
      : T[K];
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type LocaleOverride<T> = DeepPartial<DeepStringly<T>>;

/**
 * Merge a locale override onto the English base. Missing keys in the override
 * fall back to English, so a partial (core-first) translation stays type-safe
 * and never renders an empty string.
 */
export function deepMergeCopy<T>(base: T, override: LocaleOverride<T>): T {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== "object" ||
    override === null
  ) {
    return (override as T) ?? base;
  }
  const result: Record<string, unknown> = { ...(base as object) };
  for (const key of Object.keys(override) as Array<keyof typeof override>) {
    const overrideValue = (override as Record<string, unknown>)[key as string];
    if (overrideValue === undefined) continue;
    result[key as string] = deepMergeCopy(
      (base as Record<string, unknown>)[key as string],
      overrideValue as never,
    );
  }
  return result as T;
}
