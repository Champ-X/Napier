import { SKILL_LOAD_FAILURE_CODES } from "./skill-load.js";
import {
  STANDARD_SKILL_ROOT_KINDS,
  type StandardSkillCatalogBindingV2,
  type StandardSkillLoadFailureV2,
  type StandardSkillLoadReceiptV2,
  type StandardSkillLoadSelectionV2,
  type StandardSkillManifestEntryV2,
  type StandardSkillRequestRecord,
  type StandardSkillRootKind,
  type StandardSkillSnapshotManifestV2,
} from "./skill-load-standard-types.js";
import type { SkillLoadFailureCode } from "./skill-load.js";
import {
  canonical,
  codeUnit,
  exact,
  hashed,
  hex,
  integer,
  name,
  object,
  sha256,
} from "./skill-load-validation.js";
export {
  STANDARD_SKILL_ROOT_KINDS,
  type StandardSkillCatalogBindingV2,
  type StandardSkillLoadFailureV2,
  type StandardSkillLoadReceiptV2,
  type StandardSkillLoadSelectionV2,
  type StandardSkillManifestEntryV2,
  type StandardSkillRequestRecord,
  type StandardSkillRootKind,
  type StandardSkillSnapshotManifestV2,
  type StandardSkillSource,
} from "./skill-load-standard-types.js";

export function isStandardSkillLoadFailureV2(
  value: unknown,
): value is StandardSkillLoadFailureV2 {
  if (
    !object(value) ||
    !exact(
      value,
      [
        "kind",
        "schemaVersion",
        "operation",
        "agentToolName",
        "source",
        "subject",
        "state",
        "failureCode",
        "requestedNameSha256",
        "candidateRootKinds",
        "catalogSha256",
        "diagnosticSha256",
        "contentSha256",
      ],
      ["canonicalName", "snapshotManifestSha256"],
    ) ||
    value.kind !== "napier.skill-load-failure" ||
    value.schemaVersion !== 2 ||
    value.operation !== "skill.load" ||
    value.agentToolName !== "skill_load" ||
    value.source !== "composite" ||
    value.subject !== "skill_request" ||
    (value.state !== "failed" && value.state !== "unavailable") ||
    !SKILL_LOAD_FAILURE_CODES.includes(
      value.failureCode as SkillLoadFailureCode,
    ) ||
    !hex(value.requestedNameSha256) ||
    !rootKinds(value.candidateRootKinds) ||
    !hex(value.catalogSha256) ||
    !hex(value.diagnosticSha256) ||
    (value.snapshotManifestSha256 !== undefined &&
      !hex(value.snapshotManifestSha256))
  ) {
    return false;
  }
  if (
    value.canonicalName !== undefined &&
    (!name(value.canonicalName) ||
      sha256(value.canonicalName) !== value.requestedNameSha256)
  ) {
    return false;
  }
  return hashed(value, "contentSha256");
}

export function isStandardSkillCatalogBindingV2(
  value: unknown,
): value is StandardSkillCatalogBindingV2 {
  if (
    !object(value) ||
    !exact(value, [
      "kind",
      "schemaVersion",
      "operation",
      "agentToolName",
      "configuredSkillRequests",
      "loadableSkillNames",
      "unavailableSkills",
      "catalogSha256",
      "availabilitySetSha256",
      "snapshotManifestSha256",
      "contentSha256",
    ]) ||
    value.kind !== "napier.skill-catalog-binding" ||
    value.schemaVersion !== 2 ||
    value.operation !== "skill.load" ||
    value.agentToolName !== "skill_load" ||
    !Array.isArray(value.configuredSkillRequests) ||
    value.configuredSkillRequests.length > 64 ||
    !value.configuredSkillRequests.every(requestRecord) ||
    !Array.isArray(value.loadableSkillNames) ||
    !value.loadableSkillNames.every(name) ||
    !sortedUnique(value.loadableSkillNames) ||
    !Array.isArray(value.unavailableSkills) ||
    !value.unavailableSkills.every(isStandardSkillLoadFailureV2) ||
    !hex(value.catalogSha256) ||
    !hex(value.snapshotManifestSha256)
  ) {
    return false;
  }
  const requests =
    value.configuredSkillRequests as StandardSkillRequestRecord[];
  const failures = value.unavailableSkills as StandardSkillLoadFailureV2[];
  const loadable = requests
    .filter((item) => item.state === "loadable")
    .map((item) => item.canonicalName)
    .sort(codeUnit);
  const refs = [
    ...new Set(
      requests
        .filter((item) => item.state === "unavailable")
        .map((item) => item.failureContentSha256),
    ),
  ].sort(codeUnit);
  if (
    canonical(loadable) !== canonical(value.loadableSkillNames) ||
    canonical(refs) !== canonical(failures.map((item) => item.contentSha256)) ||
    !requests
      .filter((item) => item.state === "unavailable")
      .every((request) => {
        const failure = failures.find(
          (item) => item.contentSha256 === request.failureContentSha256,
        );
        return (
          failure?.requestedNameSha256 === request.requestedNameSha256 &&
          failure.canonicalName === request.canonicalName &&
          failure.catalogSha256 === value.catalogSha256 &&
          failure.state === "unavailable"
        );
      })
  ) {
    return false;
  }
  const availability = {
    configuredSkillRequests: requests,
    loadableSkillNames: value.loadableSkillNames,
    unavailableFailureContentSha256s: failures.map(
      (item) => item.contentSha256,
    ),
    catalogSha256: value.catalogSha256,
  };
  return (
    value.availabilitySetSha256 === sha256(canonical(availability)) &&
    hashed(value, "contentSha256")
  );
}

export function isStandardSkillLoadSelectionV2(
  value: unknown,
): value is StandardSkillLoadSelectionV2 {
  return Boolean(
    object(value) &&
    exact(value, [
      "kind",
      "schemaVersion",
      "operation",
      "agentToolName",
      "state",
      "name",
      "requestedNameSha256",
      "source",
      "rootKind",
      "catalogSha256",
      "availabilitySetSha256",
      "snapshotManifestSha256",
      "inputSha256",
      "contentSha256",
    ]) &&
    value.kind === "napier.skill-load-selection" &&
    value.schemaVersion === 2 &&
    value.operation === "skill.load" &&
    value.agentToolName === "skill_load" &&
    value.state === "selected" &&
    name(value.name) &&
    value.requestedNameSha256 === sha256(value.name) &&
    sourceRoot(value.source, value.rootKind) &&
    [
      value.catalogSha256,
      value.availabilitySetSha256,
      value.snapshotManifestSha256,
    ].every(hex) &&
    value.inputSha256 === sha256(canonical({ name: value.name })) &&
    hashed(value, "contentSha256"),
  );
}

export function isStandardSkillLoadReceiptV2(
  value: unknown,
): value is StandardSkillLoadReceiptV2 {
  return Boolean(
    object(value) &&
    exact(value, [
      "kind",
      "schemaVersion",
      "operation",
      "agentToolName",
      "state",
      "name",
      "requestedNameSha256",
      "source",
      "rootKind",
      "relativePath",
      "sizeBytes",
      "lineCount",
      "rawContentSha256",
      "invocationSha256",
      "catalogSha256",
      "snapshotManifestSha256",
      "contentSha256",
    ]) &&
    value.kind === "napier.skill-load-receipt" &&
    value.schemaVersion === 2 &&
    value.operation === "skill.load" &&
    value.agentToolName === "skill_load" &&
    value.state === "loaded" &&
    name(value.name) &&
    value.requestedNameSha256 === sha256(value.name) &&
    sourceRoot(value.source, value.rootKind) &&
    value.relativePath === relativePath(value.rootKind, value.name) &&
    integer(value.sizeBytes, 1, 131_072) &&
    integer(value.lineCount, 1, 131_073) &&
    [
      value.rawContentSha256,
      value.invocationSha256,
      value.catalogSha256,
      value.snapshotManifestSha256,
    ].every(hex) &&
    hashed(value, "contentSha256"),
  );
}

export function isStandardSkillSnapshotManifestV2(
  value: unknown,
): value is StandardSkillSnapshotManifestV2 {
  if (
    !object(value) ||
    !standardManifestHeader(value) ||
    !standardManifestSelection(value) ||
    !standardManifestCatalog(value)
  ) {
    return false;
  }
  return standardManifestRelations(
    value as unknown as StandardSkillSnapshotManifestV2,
  );
}

function standardManifestHeader(value: Record<string, unknown>): boolean {
  return Boolean(
    exact(value, [
      "kind",
      "schemaVersion",
      "source",
      "trustOrigins",
      "workspaceIdentitySha256",
      "trustPolicySha256",
      "configuredSkillRequests",
      "selectionSha256",
      "observedRootKinds",
      "rootIdentitySetSha256",
      "directDirectoryCount",
      "catalogSha256",
      "availabilitySetSha256",
      "entryCount",
      "aggregateRawBytes",
      "entries",
      "unavailableFailureContentSha256s",
      "snapshotContentSha256",
      "snapshotManifestSha256",
    ]) &&
    value.kind === "napier.standard-skill-snapshot-manifest" &&
    value.schemaVersion === 2 &&
    value.source === "composite" &&
    canonical(value.trustOrigins) ===
      canonical(["active_user_selected_project", "local_user_skill_store"]) &&
    hex(value.workspaceIdentitySha256) &&
    hex(value.trustPolicySha256),
  );
}

function standardManifestSelection(value: Record<string, unknown>): boolean {
  return Boolean(
    Array.isArray(value.configuredSkillRequests) &&
    value.configuredSkillRequests.length <= 64 &&
    value.configuredSkillRequests.every(requestRecord) &&
    value.selectionSha256 ===
      sha256(canonical(value.configuredSkillRequests)) &&
    rootKinds(value.observedRootKinds) &&
    hex(value.rootIdentitySetSha256) &&
    integer(value.directDirectoryCount, 0, 192),
  );
}

function standardManifestCatalog(value: Record<string, unknown>): boolean {
  return Boolean(
    integer(value.entryCount, 0, 64) &&
    integer(value.aggregateRawBytes, 0, 8 * 1024 * 1024) &&
    Array.isArray(value.entries) &&
    value.entries.length === value.entryCount &&
    value.entries.every(manifestEntry) &&
    Array.isArray(value.unavailableFailureContentSha256s) &&
    value.unavailableFailureContentSha256s.every(hex) &&
    sortedUnique(value.unavailableFailureContentSha256s) &&
    [
      value.catalogSha256,
      value.availabilitySetSha256,
      value.snapshotContentSha256,
    ].every(hex),
  );
}

function standardManifestRelations(
  value: StandardSkillSnapshotManifestV2,
): boolean {
  const entries = value.entries as StandardSkillManifestEntryV2[];
  const names = entries.map((entry) => entry.canonicalName);
  const loadable = (
    value.configuredSkillRequests as StandardSkillRequestRecord[]
  ).filter((item) => item.state === "loadable");
  const unavailable = [
    ...new Set(
      (value.configuredSkillRequests as StandardSkillRequestRecord[])
        .filter((item) => item.state === "unavailable")
        .map((item) => item.failureContentSha256),
    ),
  ].sort(codeUnit);
  const catalog = {
    observedRootKinds: value.observedRootKinds,
    rootIdentitySetSha256: value.rootIdentitySetSha256,
    directDirectoryCount: value.directDirectoryCount,
    entries,
  };
  const availability = {
    configuredSkillRequests: value.configuredSkillRequests,
    loadableSkillNames: names,
    unavailableFailureContentSha256s: unavailable,
    catalogSha256: value.catalogSha256,
  };
  return Boolean(
    sortedUnique(names) &&
    entries.reduce((sum, entry) => sum + entry.sizeBytes, 0) ===
      value.aggregateRawBytes &&
    canonical(loadable.map((item) => item.canonicalName).sort(codeUnit)) ===
      canonical(names) &&
    loadable.every((item) =>
      entries.some(
        (entry) =>
          entry.canonicalName === item.canonicalName &&
          entry.source === item.source &&
          entry.rootKind === item.rootKind,
      ),
    ) &&
    canonical(unavailable) ===
      canonical(value.unavailableFailureContentSha256s) &&
    value.catalogSha256 === sha256(canonical(catalog)) &&
    value.availabilitySetSha256 === sha256(canonical(availability)) &&
    hashed(
      value as unknown as Record<string, unknown>,
      "snapshotManifestSha256",
    ),
  );
}

function requestRecord(
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

function manifestEntry(value: unknown): value is StandardSkillManifestEntryV2 {
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

function sourceRoot(source: unknown, rootKind: unknown): boolean {
  return (
    (source === "project" &&
      (rootKind === "project_legacy" || rootKind === "project_standard")) ||
    (source === "user" && rootKind === "user_standard")
  );
}

function relativePath(rootKind: unknown, skillName: unknown): string {
  return rootKind === "project_legacy"
    ? `skills/${String(skillName)}/SKILL.md`
    : `.agents/skills/${String(skillName)}/SKILL.md`;
}

function virtualPath(rootKind: unknown, skillName: unknown): string {
  const prefix = rootKind === "user_standard" ? "/user" : "/project";
  return `${prefix}/${relativePath(rootKind, skillName)}`;
}

function rootKinds(value: unknown): value is StandardSkillRootKind[] {
  return Boolean(
    Array.isArray(value) &&
    value.every((item) =>
      STANDARD_SKILL_ROOT_KINDS.includes(item as StandardSkillRootKind),
    ) &&
    sortedUnique(value as string[]),
  );
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}
