import type { ThreadDetail } from "@napier/contracts";

type TaskNarrativeProjection = NonNullable<ThreadDetail["taskNarrative"]>;

const PHASES = new Set([
  "ready",
  "working",
  "waiting",
  "blocked",
  "completed",
  "failed",
]);

export function isTaskNarrativeProjection(
  value: unknown,
): value is TaskNarrativeProjection {
  if (!record(value)) return false;
  return (
    typeof value["phase"] === "string" &&
    PHASES.has(value["phase"]) &&
    typeof value["phaseLabel"] === "string" &&
    typeof value["currentAction"] === "string" &&
    Array.isArray(value["completedItems"]) &&
    value["completedItems"].every((item) => typeof item === "string") &&
    optionalString(value["metricRunId"]) &&
    optionalString(value["nextStep"]) &&
    optionalString(value["blocker"])
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
