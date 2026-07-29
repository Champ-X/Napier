import type {
  ExecutionPlanArchive,
  ExecutionPlanBlueprint,
} from "@napier/contracts";

export function executionPlanArchiveFilename(
  archive: Pick<ExecutionPlanArchive, "contentSha256"> & {
    plan: Pick<ExecutionPlanArchive["plan"], "id" | "revision">;
  },
): string {
  const safePlanId = safeFilenameSegment(archive.plan.id, "plan");
  return `napier-plan-${safePlanId}-r${archive.plan.revision}-${archive.contentSha256.slice(0, 12)}.json`;
}

export function executionPlanBlueprintFilename(
  blueprint: Pick<ExecutionPlanBlueprint, "contentSha256"> & {
    source: Pick<ExecutionPlanBlueprint["source"], "planId" | "planRevision">;
  },
): string {
  const safePlanId = safeFilenameSegment(blueprint.source.planId, "plan");
  return `napier-plan-blueprint-${safePlanId}-r${blueprint.source.planRevision}-${blueprint.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}
