import type { ThreadDetail } from "@napier/contracts";

import { isArtifactManifestEntry } from "./conversation-artifacts-protocol";

type TaskNarrativeProjection = NonNullable<ThreadDetail["taskNarrative"]>;

const PHASES = new Set([
  "ready",
  "working",
  "waiting",
  "blocked",
  "completed",
  "ended",
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
    optionalString(value["blocker"]) &&
    (value["execution"] === undefined ||
      member(value["execution"], [
        "queued",
        "running",
        "waiting",
        "paused",
        "ended",
        "failed",
      ])) &&
    (value["objective"] === undefined || objective(value["objective"])) &&
    (value["processItems"] === undefined || strings(value["processItems"])) &&
    (value["remainingItems"] === undefined ||
      strings(value["remainingItems"])) &&
    (value["deliverables"] === undefined || deliverables(value["deliverables"]))
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function member(value: unknown, values: string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function objective(value: unknown): boolean {
  return (
    record(value) &&
    member(value["status"], [
      "unverified",
      "partial",
      "accepted",
      "rejected",
      "indeterminate",
    ]) &&
    typeof value["reason"] === "string" &&
    strings(value["evidence"])
  );
}

function deliverables(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item["path"] === "string" &&
        deliverableSource(item) &&
        isArtifactManifestEntry(item["artifact"]) &&
        member(item["accessibility"], [
          "unchecked",
          "available",
          "missing",
          "drifted",
        ]) &&
        member(item["verification"], ["unverified", "integrity_recorded"]) &&
        Array.isArray(item["previousVersions"]) &&
        item["previousVersions"].every(
          (version) =>
            record(version) &&
            typeof version["planId"] === "string" &&
            typeof version["artifactId"] === "string" &&
            optionalString(version["runId"]) &&
            optionalString(version["sha256"]),
        ),
    )
  );
}

function deliverableSource(item: Record<string, unknown>): boolean {
  if (item["source"] === "plan")
    return (
      typeof item["planId"] === "string" &&
      Number.isSafeInteger(item["planRevision"])
    );
  return (
    item["source"] === "final_reference" &&
    typeof item["sourceEventId"] === "string" &&
    item["verification"] === "unverified" &&
    record(item["artifact"]) &&
    item["artifact"]["status"] === "candidate" &&
    typeof item["artifact"]["sourceRunId"] === "string"
  );
}
