import type { Skill } from "@earendil-works/pi-agent-core";
import type { RunConfigurationFingerprint } from "@napier/contracts";

import type { FrozenToolResultReplayController } from "./agent-message-tool-result-replay.js";
import {
  isSkillCatalogBinding,
  type SkillCatalogBinding,
} from "./skill-load-contracts.js";
import {
  resolveRunSkillSnapshot,
  type SkillContinuationSnapshot,
} from "./skill-load-replay.js";
import { loadWorkspaceSkills } from "./skills.js";
import {
  StandardSkillSnapshotError,
  type SkillSnapshot,
} from "./standard-skill-snapshot.js";

export interface SkillRunContext {
  readonly snapshot: SkillSnapshot;
  readonly context: Readonly<SkillCatalogBinding>;
  readonly configurationSkillCatalogSha256: string;
}

export async function resolveAgentRunSkillContext(input: {
  workspaceRoot: string;
  enabledSkills: readonly string[];
  firstClassSkillLoading: boolean;
  continuationSnapshot: SkillContinuationSnapshot | undefined;
  signal: AbortSignal | undefined;
  toolResultReplay: FrozenToolResultReplayController | undefined;
}) {
  let projectSkillSnapshot: SkillSnapshot | undefined;
  if (input.firstClassSkillLoading) {
    try {
      projectSkillSnapshot = await resolveRunSkillSnapshot(
        input.workspaceRoot,
        input.enabledSkills,
        input.continuationSnapshot,
        input.signal?.aborted ? undefined : input.signal,
      );
    } catch (error) {
      let snapshotFailure: unknown = error;
      if (
        input.signal?.aborted &&
        !(error instanceof StandardSkillSnapshotError)
      ) {
        try {
          projectSkillSnapshot = await resolveRunSkillSnapshot(
            input.workspaceRoot,
            input.enabledSkills,
            input.continuationSnapshot,
            undefined,
          );
          snapshotFailure = undefined;
        } catch (retryError) {
          snapshotFailure = retryError;
        }
      }
      if (snapshotFailure !== undefined) {
        throw snapshotFailure;
      }
    }
  }
  const legacySkillCatalog = projectSkillSnapshot
    ? undefined
    : await loadWorkspaceSkills(input.workspaceRoot, input.enabledSkills);
  input.toolResultReplay?.validateTargetSkillSnapshot(projectSkillSnapshot);
  const skillRunContext = projectSkillSnapshot
    ? createSkillRunContext(projectSkillSnapshot)
    : undefined;
  const catalogSkills = (projectSkillSnapshot?.skills ??
    legacySkillCatalog?.skills ??
    []) as readonly Skill[];
  const skillCatalogSha256 = skillRunContext
    ? skillRunContext.configurationSkillCatalogSha256
    : legacySkillCatalog!.fingerprint.contentSha256;
  const skillContext = skillRunContext?.context ?? {
    schemaVersion: legacySkillCatalog!.fingerprint.schemaVersion,
    skillCatalogSha256: legacySkillCatalog!.fingerprint.contentSha256,
    requestedSkillNames: legacySkillCatalog!.fingerprint.requestedSkillNames,
    loadedSkillNames: legacySkillCatalog!.fingerprint.loadedSkillNames,
    missingSkillNames: legacySkillCatalog!.fingerprint.missingSkillNames,
    diagnosticsSha256: legacySkillCatalog!.fingerprint.diagnosticsSha256,
    skills: legacySkillCatalog!.fingerprint.skills,
  };
  return {
    projectSkillSnapshot,
    skillRunContext,
    catalogSkills,
    skillCatalogSha256,
    skillContext,
  };
}

export function createSkillRunContext(
  snapshot: SkillSnapshot,
): SkillRunContext {
  if (
    !Object.isFrozen(snapshot) ||
    !isSkillCatalogBinding(snapshot.binding) ||
    snapshot.binding.catalogSha256 !== snapshot.manifest.catalogSha256 ||
    snapshot.binding.availabilitySetSha256 !==
      snapshot.manifest.availabilitySetSha256 ||
    snapshot.binding.snapshotManifestSha256 !==
      snapshot.manifest.snapshotManifestSha256
  ) {
    throw new Error("Skill Run context is inconsistent");
  }
  return Object.freeze({
    snapshot,
    context: snapshot.binding,
    configurationSkillCatalogSha256: snapshot.manifest.catalogSha256,
  });
}

export function assertRunConfigurationSkillContext(
  configuration: RunConfigurationFingerprint | undefined,
  context: SkillRunContext,
): void {
  if (
    !configuration ||
    !("skillCatalogSha256" in configuration) ||
    configuration.skillCatalogSha256 !==
      context.configurationSkillCatalogSha256 ||
    context.context.catalogSha256 !== configuration.skillCatalogSha256 ||
    context.context.availabilitySetSha256 !==
      context.snapshot.manifest.availabilitySetSha256 ||
    context.context.snapshotManifestSha256 !==
      context.snapshot.manifest.snapshotManifestSha256
  ) {
    throw new Error("Run configuration Skill binding is inconsistent");
  }
}
