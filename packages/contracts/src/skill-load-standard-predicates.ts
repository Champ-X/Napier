import {
  STANDARD_SKILL_ROOT_KINDS,
  type StandardSkillManifestEntryV2,
  type StandardSkillRequestRecord,
  type StandardSkillRootKind,
} from "./skill-load-standard-types.js";
import {
  exact,
  hex,
  integer,
  name,
  object,
  sha256,
} from "./skill-load-validation.js";

export function requestRecord(
  value: unknown,
  position: number,
): value is StandardSkillRequestRecord {
  if (
    !object(value) ||
    value.position !== position ||
    !hex(value.requestedNameSha256)
  ) {
    return false;
  }
  if (value.state === "loadable") {
    return Boolean(
      exact(value, [
        "position",
        "requestedNameSha256",
        "state",
        "canonicalName",
        "source",
        "rootKind",
      ]) &&
      name(value.canonicalName) &&
      sha256(value.canonicalName) === value.requestedNameSha256 &&
      sourceRoot(value.source, value.rootKind),
    );
  }
  return Boolean(
    value.state === "unavailable" &&
    exact(
      value,
      ["position", "requestedNameSha256", "state", "failureContentSha256"],
      ["canonicalName"],
    ) &&
    hex(value.failureContentSha256) &&
    (value.canonicalName === undefined ||
      (name(value.canonicalName) &&
        sha256(value.canonicalName) === value.requestedNameSha256)),
  );
}

export function manifestEntry(
  value: unknown,
): value is StandardSkillManifestEntryV2 {
  return Boolean(
    object(value) &&
    exact(value, [
      "canonicalName",
      "requestedNameSha256",
      "source",
      "rootKind",
      "relativePath",
      "virtualPath",
      "directoryKind",
      "fileKind",
      "symlinkFree",
      "sizeBytes",
      "lineCount",
      "rawContentSha256",
      "metadataSha256",
      "invocationSha256",
    ]) &&
    name(value.canonicalName) &&
    value.requestedNameSha256 === sha256(value.canonicalName) &&
    sourceRoot(value.source, value.rootKind) &&
    value.relativePath === relativePath(value.rootKind, value.canonicalName) &&
    value.virtualPath === virtualPath(value.rootKind, value.canonicalName) &&
    value.directoryKind === "directory" &&
    value.fileKind === "regular_file" &&
    value.symlinkFree === true &&
    integer(value.sizeBytes, 1, 131_072) &&
    integer(value.lineCount, 1, 131_073) &&
    [
      value.rawContentSha256,
      value.metadataSha256,
      value.invocationSha256,
    ].every(hex),
  );
}

export function sourceRoot(source: unknown, rootKind: unknown): boolean {
  return (
    (source === "project" &&
      (rootKind === "project_legacy" || rootKind === "project_standard")) ||
    (source === "user" && rootKind === "user_standard") ||
    (source === "bundled" && rootKind === "bundled_standard")
  );
}

export function relativePath(rootKind: unknown, skillName: unknown): string {
  return rootKind === "project_legacy" || rootKind === "bundled_standard"
    ? `skills/${String(skillName)}/SKILL.md`
    : `.agents/skills/${String(skillName)}/SKILL.md`;
}

export function virtualPath(rootKind: unknown, skillName: unknown): string {
  const prefix =
    rootKind === "user_standard"
      ? "/user"
      : rootKind === "bundled_standard"
        ? "/bundled"
        : "/project";
  return `${prefix}/${relativePath(rootKind, skillName)}`;
}

export function rootKinds(value: unknown): value is StandardSkillRootKind[] {
  if (
    !Array.isArray(value) ||
    value.length > STANDARD_SKILL_ROOT_KINDS.length
  ) {
    return false;
  }
  const indexes = value.map((root) =>
    STANDARD_SKILL_ROOT_KINDS.indexOf(root as StandardSkillRootKind),
  );
  return indexes.every(
    (index, position) =>
      index >= 0 && (position === 0 || index > indexes[position - 1]!),
  );
}

export function sortedUnique(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}
