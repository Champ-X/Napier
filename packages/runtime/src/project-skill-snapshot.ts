import { constants } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { SkillLoadFailureV1 } from "@napier/contracts/skill-load";
import {
  isProjectSkillSnapshotManifestV1,
  isSkillCatalogBindingV1,
  isSkillLoadFailureV1,
} from "@napier/contracts/skill-load";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  acquireProjectSkillEntries,
  inspectProjectSkillDirectories,
} from "./project-skill-snapshot-acquisition.js";
import {
  assertProjectSkillAnchorCurrent,
  checkProjectSkillSignal,
  openProjectSkillRoot,
} from "./project-skill-snapshot-anchor.js";
export { resolveProjectSkillTraversalStrategy } from "./project-skill-snapshot-anchor.js";
import {
  ProjectSkillSnapshotError,
  compareProjectSkillText,
  publicProjectSkillEntry,
  validProjectSkillName,
  type ProjectSkillSnapshot,
  type ProjectSkillSnapshotHooks,
  type ProjectSkillSnapshotV1,
} from "./project-skill-snapshot-model.js";
export {
  ProjectSkillSnapshotError,
  type ProjectSkillSnapshot,
  type ProjectSkillSnapshotEntry,
  type ProjectSkillSnapshotHooks,
  type ProjectSkillSnapshotV1,
} from "./project-skill-snapshot-model.js";
import {
  loadProjectSkillResource,
  type ProjectSkillResourceHooks,
} from "./project-skill-resource.js";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DIRECTORY_SCAN_ENTRIES = 4096;
const TRUST_POLICY = {
  authorization: "same_canonical_active_user_selected_project",
  discovery: "configured_direct_skill_md_only",
  filesystem: "platform_probed_fd_or_darwin_held_parent_identity_checks",
  resources: "on_demand_text_only_nofollow_64k",
  shell: "denied",
  writes: "denied",
  maxConfiguredRequests: 64,
  maxDirectDirectories: 64,
  maxDirectoryScanEntries: MAX_DIRECTORY_SCAN_ENTRIES,
  maxFileBytes: MAX_FILE_BYTES,
  maxAggregateBytes: MAX_TOTAL_BYTES,
} as const;

export async function buildProjectSkillSnapshot(
  workspaceRoot: string,
  configuredNames: readonly string[],
  signal?: AbortSignal,
  hooks: ProjectSkillSnapshotHooks = {},
): Promise<ProjectSkillSnapshot> {
  checkProjectSkillSignal(signal);
  if (configuredNames.length > 64)
    throw new ProjectSkillSnapshotError("configured_request_limit");
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_DIRECTORY !== "number"
  ) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  const canonicalWorkspace = await realpath(workspaceRoot).catch(
    () => undefined,
  );
  checkProjectSkillSignal(signal);
  if (!canonicalWorkspace)
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  const workspaceInfo = await lstat(canonicalWorkspace).catch(() => undefined);
  if (!workspaceInfo?.isDirectory() || workspaceInfo.isSymbolicLink()) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  checkProjectSkillSignal(signal);
  const skillsRoot = path.join(canonicalWorkspace, "skills");
  const anchor = await openProjectSkillRoot(
    canonicalWorkspace,
    skillsRoot,
    signal,
  );
  try {
    await hooks.afterRootOpen?.();
    checkProjectSkillSignal(signal);
    const requestedNames = new Set(
      configuredNames.filter(validProjectSkillName),
    );
    const directories = await inspectProjectSkillDirectories(
      anchor,
      requestedNames,
      signal,
      hooks,
    );
    const directoryIdentitySetSha256 = sha256(
      canonicalJson(directories.identityHashes),
    );
    if (directories.count === 65) {
      const core = {
        kind: "napier.skill-load-failure" as const,
        schemaVersion: 1 as const,
        operation: "skill.load" as const,
        agentToolName: "skill_load" as const,
        source: "project" as const,
        subject: "project_catalog" as const,
        state: "unavailable" as const,
        failureCode: "skill_limit_exceeded" as const,
        observedDirectoryCount: 65 as const,
        directoryIdentitySetSha256,
        catalogSha256: sha256(
          canonicalJson({
            directDirectoryCount: 65,
            directoryIdentitySetSha256,
          }),
        ),
        diagnosticSha256: sha256("project_skill_direct_directory_limit"),
      };
      const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
      if (!isSkillLoadFailureV1(failure))
        throw new Error("Skill overflow invariant failed");
      throw new ProjectSkillSnapshotError("project_catalog_overflow", failure);
    }

    const acquired = await acquireProjectSkillEntries(
      anchor,
      configuredNames,
      directories,
      signal,
      hooks,
    );
    const { failures, entries, skills, aggregateRawBytes } = acquired;
    checkProjectSkillSignal(signal);
    entries.sort((left, right) =>
      compareProjectSkillText(left.canonicalName, right.canonicalName),
    );
    skills.sort((left, right) =>
      compareProjectSkillText(left.name, right.name),
    );
    const catalogSha256 = sha256(
      canonicalJson({
        directDirectoryCount: directories.count,
        directoryIdentitySetSha256,
        entries: entries.map(publicProjectSkillEntry),
      }),
    );
    const unavailableByPosition = new Map<number, SkillLoadFailureV1>();
    for (const draft of failures) {
      const core = {
        kind: "napier.skill-load-failure" as const,
        schemaVersion: 1 as const,
        operation: "skill.load" as const,
        agentToolName: "skill_load" as const,
        source: "project" as const,
        subject: "skill_request" as const,
        state: "unavailable" as const,
        failureCode: draft.code,
        requestedNameSha256: sha256(draft.raw),
        ...(validProjectSkillName(draft.raw)
          ? { canonicalName: draft.raw }
          : {}),
        catalogSha256,
        diagnosticSha256: sha256(`snapshot:${draft.diagnostic}`),
      };
      const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
      if (!isSkillLoadFailureV1(failure))
        throw new Error("Skill failure invariant failed");
      unavailableByPosition.set(draft.position, failure);
    }
    const unavailableSkills = [
      ...new Map(
        [...unavailableByPosition.values()].map((item) => [
          item.contentSha256,
          item,
        ]),
      ).values(),
    ].sort((left, right) =>
      compareProjectSkillText(left.contentSha256, right.contentSha256),
    );
    const configuredSkillRequests = configuredNames.map((raw, position) => {
      const failure = unavailableByPosition.get(position);
      return failure
        ? {
            position,
            requestedNameSha256: sha256(raw),
            state: "unavailable" as const,
            failureContentSha256: failure.contentSha256,
            ...(validProjectSkillName(raw) ? { canonicalName: raw } : {}),
          }
        : {
            position,
            requestedNameSha256: sha256(raw),
            state: "loadable" as const,
            canonicalName: raw,
          };
    });
    const loadableSkillNames = entries.map((entry) => entry.canonicalName);
    const unavailableFailureContentSha256s = unavailableSkills.map(
      (item) => item.contentSha256,
    );
    const availabilitySetSha256 = sha256(
      canonicalJson({
        configuredSkillRequests,
        loadableSkillNames,
        unavailableFailureContentSha256s,
        catalogSha256,
      }),
    );
    const privateCore = {
      kind: "napier.project-skill-snapshot" as const,
      schemaVersion: 1 as const,
      storage: "local_only" as const,
      source: "project" as const,
      trustOrigin: "active_user_selected_project" as const,
      workspaceIdentitySha256: sha256(canonicalWorkspace),
      trustPolicySha256: sha256(canonicalJson(TRUST_POLICY)),
      configuredSkillRequests,
      selectionSha256: sha256(canonicalJson(configuredSkillRequests)),
      directDirectoryCount: directories.count,
      directoryIdentitySetSha256,
      directoryIdentitySha256s: directories.identityHashes,
      catalogSha256,
      availabilitySetSha256,
      entryCount: entries.length,
      aggregateRawBytes,
      entries,
      unavailableSkills,
    };
    const content: ProjectSkillSnapshotV1 = {
      ...privateCore,
      snapshotContentSha256: sha256(canonicalJson(privateCore)),
    };
    const manifestCore = {
      kind: "napier.project-skill-snapshot-manifest" as const,
      schemaVersion: 1 as const,
      source: "project" as const,
      trustOrigin: "active_user_selected_project" as const,
      workspaceIdentitySha256: content.workspaceIdentitySha256,
      trustPolicySha256: content.trustPolicySha256,
      configuredSkillRequests,
      selectionSha256: content.selectionSha256,
      directDirectoryCount: directories.count,
      directoryIdentitySetSha256,
      catalogSha256,
      availabilitySetSha256,
      entryCount: entries.length,
      aggregateRawBytes,
      entries: entries.map(publicProjectSkillEntry),
      unavailableFailureContentSha256s,
      snapshotContentSha256: content.snapshotContentSha256,
    };
    const manifest = {
      ...manifestCore,
      snapshotManifestSha256: sha256(canonicalJson(manifestCore)),
    };
    const bindingCore = {
      kind: "napier.skill-catalog-binding" as const,
      schemaVersion: 1 as const,
      operation: "skill.load" as const,
      agentToolName: "skill_load" as const,
      configuredSkillRequests,
      loadableSkillNames,
      unavailableSkills,
      catalogSha256,
      availabilitySetSha256,
      snapshotManifestSha256: manifest.snapshotManifestSha256,
    };
    const binding = {
      ...bindingCore,
      contentSha256: sha256(canonicalJson(bindingCore)),
    };
    if (!isProjectSkillSnapshotManifestV1(manifest))
      throw new Error("Project Skill manifest invariant failed");
    if (!isSkillCatalogBindingV1(binding))
      throw new Error("Project Skill binding invariant failed");
    await assertProjectSkillAnchorCurrent(anchor, signal);
    checkProjectSkillSignal(signal);
    const byName = new Map(
      entries.map((entry) => [entry.canonicalName, entry]),
    );
    return deepFreeze({
      content,
      manifest,
      binding,
      skills,
      entry: (skillName: string) => byName.get(skillName),
      loadResource: (
        skillName: string,
        resourcePath: string,
        resourceSignal?: AbortSignal,
        resourceHooks?: ProjectSkillResourceHooks,
      ) => {
        const entry = byName.get(skillName);
        if (!entry)
          throw new Error("Skill resource request is not snapshot-bound");
        return loadProjectSkillResource(
          canonicalWorkspace,
          entry,
          resourcePath,
          resourceSignal,
          resourceHooks,
        );
      },
    });
  } finally {
    await Promise.all([anchor.handle.close(), anchor.workspaceHandle.close()]);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>))
      deepFreeze(item);
  }
  return value;
}
