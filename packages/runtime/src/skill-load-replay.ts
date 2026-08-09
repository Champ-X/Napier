import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import {
  isSkillCatalogBinding,
  isSkillLoadReceipt,
  isSkillSnapshotManifest,
  type SkillCatalogBinding,
  type SkillLoadReceipt,
} from "./skill-load-contracts.js";
import {
  buildStandardSkillSnapshot,
  type SkillSnapshot,
} from "./standard-skill-snapshot.js";

export const SKILL_CONTINUATION_SNAPSHOT: unique symbol = Symbol(
  "napier.skill-continuation-snapshot",
);
export type SkillContinuationSnapshot = SkillSnapshot;

export function skillSnapshotSignalForCapability(
  enabled: boolean,
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  return enabled ? signal : undefined;
}

export async function resolveRunSkillSnapshot(
  workspaceRoot: string,
  enabledSkills: readonly string[],
  provided: SkillSnapshot | undefined,
  signal?: AbortSignal,
): Promise<SkillSnapshot> {
  const snapshot =
    provided ??
    (await buildStandardSkillSnapshot(workspaceRoot, enabledSkills, signal));
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
): Promise<{ bound: boolean; snapshot?: SkillSnapshot }> {
  const candidates = events.filter((event) => event.type === "context.skills");
  if (candidates.length === 0) return { bound: false };
  if (
    candidates.length !== 1 ||
    !isSkillCatalogBinding(candidates[0]?.payload)
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
  const snapshot = await buildStandardSkillSnapshot(
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
  targetSnapshot: SkillSnapshot,
): Readonly<SkillCatalogBinding> {
  if (
    !isSkillCatalogBinding(sourceBinding) ||
    !Object.isFrozen(targetSnapshot) ||
    !isSkillCatalogBinding(targetSnapshot.binding) ||
    !isSkillSnapshotManifest(targetSnapshot.manifest) ||
    sourceBinding.schemaVersion !== targetSnapshot.binding.schemaVersion
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
  targetSnapshot: SkillSnapshot,
  capsule: SkillLoadReplayCapsuleProjection,
): SkillLoadReceipt {
  const binding = validateSkillSnapshotForContinuation(
    sourceBinding,
    targetSnapshot,
  );
  if (
    capsule.toolName !== "skill_load" ||
    capsule.isError ||
    !isSkillLoadReceipt(capsule.result.details) ||
    capsule.result.details.schemaVersion !== binding.schemaVersion
  ) {
    throw new Error(
      "Frozen Skill load result is not a reusable success receipt",
    );
  }
  const receipt = capsule.result.details;
  const entry = targetSnapshot.entry(receipt.name);
  const originMatches =
    receipt.schemaVersion === 1
      ? Boolean(entry)
      : Boolean(
          entry &&
          "source" in entry &&
          "rootKind" in entry &&
          receipt.source === entry.source &&
          receipt.rootKind === entry.rootKind,
        );
  if (
    !entry ||
    !originMatches ||
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
