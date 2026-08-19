import type { ExtensionPackageDependency } from "@napier/contracts";

export function parsePackageDependencies(
  value: string,
): ExtensionPackageDependency[] | undefined {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > 32) return undefined;
  const dependencies: ExtensionPackageDependency[] = [];
  const names = new Set<string>();
  for (const line of lines) {
    const separator = line.indexOf("@");
    const normalizedName = line.slice(0, separator);
    const versionRange = line.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(normalizedName) ||
      !versionRange ||
      versionRange.length > 120 ||
      names.has(normalizedName)
    ) {
      return undefined;
    }
    names.add(normalizedName);
    dependencies.push({ normalizedName, versionRange });
  }
  return dependencies.sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName),
  );
}
