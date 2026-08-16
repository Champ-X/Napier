import type { ThreadDetail } from "@napier/contracts";

export function isActivePlanProjection(
  value: unknown,
): value is NonNullable<ThreadDetail["activePlan"]> {
  if (!record(value)) return false;
  return (
    typeof value["planId"] === "string" &&
    integer(value["revision"], 1) &&
    typeof value["status"] === "string" &&
    ["active", "completed", "blocked", "cancelled"].includes(value["status"]) &&
    typeof value["objective"] === "string" &&
    integer(value["completedStepCount"], 0) &&
    integer(value["settledStepCount"], 0) &&
    integer(value["stepCount"], 0) &&
    integer(value["verifiedArtifactCount"], 0) &&
    integer(value["producedArtifactCount"], 0) &&
    integer(value["missingArtifactCount"], 0) &&
    Array.isArray(value["outputPaths"]) &&
    value["outputPaths"].every((path) => typeof path === "string") &&
    (value["activePhaseIndex"] === null ||
      integer(value["activePhaseIndex"], 0)) &&
    integer(value["phaseCount"], 0) &&
    integer(value["eventWatermark"], 0)
  );
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
