import type { EditFormatPreference } from "@napier/contracts/harness-experiments";

export function validEditFormatPreference(
  value: unknown,
): value is EditFormatPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).sort().join() ===
      "api,dialect,model,provider,taskPhase" &&
    ["api", "model", "provider"].every(
      (key) =>
        typeof entry[key] === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/u.test(entry[key]),
    ) &&
    ["coding", "research", "browser", "data", "general"].includes(
      String(entry.taskPhase),
    ) &&
    ["structured_patch", "hashline", "unified_diff"].includes(
      String(entry.dialect),
    )
  );
}

/** Preferences are model/task guidance, never permission or edit conversion. */
export function matchedEditFormatPreference(
  preference: EditFormatPreference,
  model: { provider?: string; id?: string; api: string },
  phases: readonly string[],
): EditFormatPreference["dialect"] | undefined {
  if (!validEditFormatPreference(preference))
    throw new Error("Invalid edit format preference");
  return model.provider === preference.provider &&
    model.id === preference.model &&
    model.api === preference.api &&
    phases.length === 1 &&
    phases[0] === preference.taskPhase
    ? preference.dialect
    : undefined;
}
