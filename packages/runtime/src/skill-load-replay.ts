import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import type {
  SkillCatalogBindingV1,
  SkillLoadReceiptV1,
} from "@napier/contracts/skill-load";
import {
  isProjectSkillSnapshotManifestV1,
  isSkillCatalogBindingV1,
  isSkillLoadReceiptV1,
} from "@napier/contracts/skill-load";

import {
  buildProjectSkillSnapshot,
  type ProjectSkillSnapshot,
} from "./project-skill-snapshot.js";

export const SKILL_CONTINUATION_SNAPSHOT: unique symbol = Symbol(
  "napier.skill-continuation-snapshot",
);
export type SkillContinuationSnapshot = ProjectSkillSnapshot;

export function skillSnapshotSignalForCapability(
  enabled: boolean,
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  return enabled ? signal : undefined;
}

export async function resolveRunSkillSnapshot(
  workspaceRoot: string,
  enabledSkills: readonly string[],
  provided: ProjectSkillSnapshot | undefined,
  signal?: AbortSignal,
): Promise<ProjectSkillSnapshot> {
  const snapshot =
    provided ??
    (await buildProjectSkillSnapshot(workspaceRoot, enabledSkills, signal));
  const requests = snapshot.binding.configuredSkillRequests;
  if (
    requests.length !== enabledSkills.length ||
    requests.some(
      (request, index) => request.canonicalName !== enabledSkills[index],
    )
  ) {
    throw new Error(
      "Project Skill snapshot selection changed before Run creation",
    );
  }
  return snapshot;
}

export async function prepareSkillContinuationSnapshot(
  workspaceRoot: string,
  interrupted: RunRecord,
  events: readonly RunEvent[],
  signal?: AbortSignal,
): Promise<{ bound: boolean; snapshot?: ProjectSkillSnapshot }> {
  const candidates = events.filter((event) => event.type === "context.skills");
  if (candidates.length === 0) return { bound: false };
  if (
    candidates.length !== 1 ||
    !isSkillCatalogBindingV1(candidates[0]?.payload)
  ) {
    throw new Error("Source Run Project Skill binding evidence is invalid");
  }
  const sourceBinding = candidates[0].payload;
  const configuration = interrupted.configuration;
  if (
    !configuration ||
    !("skillCatalogSha256" in configuration) ||
    configuration.skillCatalogSha256 !== sourceBinding.catalogSha256
  ) {
    throw new Error("Source Run Project Skill configuration is invalid");
  }
  const selectedNames = sourceBinding.configuredSkillRequests.map(
    (request) => request.canonicalName,
  );
  if (
    selectedNames.some((name) => name === undefined) ||
    [...selectedNames].sort().join("\0") !==
      [...configuration.enabledSkills].sort().join("\0")
  ) {
    throw new Error("Source Run Project Skill selection evidence is invalid");
  }
  const snapshot = await buildProjectSkillSnapshot(
    workspaceRoot,
    selectedNames as string[],
    signal,
  );
  validateSkillSnapshotForContinuation(sourceBinding, snapshot);
  return { bound: true, snapshot };
}

export interface SkillLoadReplayCapsuleProjection {
  toolName: string;
  isError: boolean;
  result: { details: JsonValue };
}

export function validateSkillSnapshotForContinuation(
  sourceBinding: unknown,
  targetSnapshot: ProjectSkillSnapshot,
): Readonly<SkillCatalogBindingV1> {
  if (
    !isSkillCatalogBindingV1(sourceBinding) ||
    !Object.isFrozen(targetSnapshot) ||
    !isSkillCatalogBindingV1(targetSnapshot.binding) ||
    !isProjectSkillSnapshotManifestV1(targetSnapshot.manifest)
  ) {
    throw new Error("Project Skill continuation binding is invalid");
  }
  if (sourceBinding.catalogSha256 !== targetSnapshot.binding.catalogSha256) {
    throw new Error("Project Skill catalog changed since the source Run");
  }
  if (
    sourceBinding.availabilitySetSha256 !==
    targetSnapshot.binding.availabilitySetSha256
  ) {
    throw new Error("Project Skill availability changed since the source Run");
  }
  if (
    sourceBinding.snapshotManifestSha256 !==
    targetSnapshot.manifest.snapshotManifestSha256
  ) {
    throw new Error(
      "Project Skill snapshot manifest changed since the source Run",
    );
  }
  if (sourceBinding.contentSha256 !== targetSnapshot.binding.contentSha256) {
    throw new Error("Project Skill binding changed since the source Run");
  }
  return sourceBinding;
}

export function validateSkillLoadFrozenReplay(
  sourceBinding: unknown,
  targetSnapshot: ProjectSkillSnapshot,
  capsule: SkillLoadReplayCapsuleProjection,
): SkillLoadReceiptV1 {
  const binding = validateSkillSnapshotForContinuation(
    sourceBinding,
    targetSnapshot,
  );
  if (
    capsule.toolName !== "skill_load" ||
    capsule.isError ||
    !isSkillLoadReceiptV1(capsule.result.details)
  ) {
    throw new Error(
      "Frozen Skill load result is not a reusable success receipt",
    );
  }
  const receipt = capsule.result.details;
  const entry = targetSnapshot.entry(receipt.name);
  if (
    !entry ||
    receipt.requestedNameSha256 !== entry.requestedNameSha256 ||
    receipt.relativePath !== entry.relativePath ||
    receipt.sizeBytes !== entry.sizeBytes ||
    receipt.lineCount !== entry.lineCount ||
    receipt.rawContentSha256 !== entry.rawContentSha256 ||
    receipt.invocationSha256 !== entry.invocationSha256 ||
    receipt.catalogSha256 !== binding.catalogSha256 ||
    receipt.snapshotManifestSha256 !== binding.snapshotManifestSha256
  ) {
    throw new Error(
      "Frozen Skill load result does not match the target snapshot entry",
    );
  }
  return receipt;
}
