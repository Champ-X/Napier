import type { ThreadDetail } from "@napier/contracts";
import { taskArtifactBinding } from "@napier/contracts/task-narrative";

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
        member(item["verification"], [
          "unverified",
          "integrity_recorded",
          "integrity_observed",
        ]) &&
        (item["observation"] === undefined || observation(item)) &&
        (item["verification"] !== "integrity_observed" ||
          (record(item["observation"]) &&
            item["observation"]["status"] === "matched")) &&
        (item["currentVersion"] === undefined ||
          version(item["currentVersion"])) &&
        (item["history"] === undefined || history(item["history"])) &&
        Array.isArray(item["previousVersions"]) &&
        item["previousVersions"].every(version),
    )
  );
}

function version(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    typeof value["planId"] === "string" &&
    typeof value["artifactId"] === "string" &&
    optionalString(value["runId"]) &&
    optionalString(value["sha256"]) &&
    optionalString(value["path"]) &&
    optionalString(value["eventId"]) &&
    (value["planRevision"] === undefined ||
      positiveInteger(value["planRevision"])) &&
    (value["eventSeq"] === undefined || positiveInteger(value["eventSeq"])) &&
    (value["sizeBytes"] === undefined ||
      nonNegativeInteger(value["sizeBytes"])) &&
    (value["status"] === undefined ||
      member(value["status"], [
        "expected",
        "candidate",
        "produced",
        "verified",
        "missing",
        "superseded",
      ])) &&
    (value["source"] === undefined ||
      member(value["source"], ["manifest", "recorded_assertion"])) &&
    (value["source"] !== "recorded_assertion" ||
      (typeof value["eventId"] === "string" &&
        positiveInteger(value["eventSeq"]) &&
        positiveInteger(value["planRevision"])))
  );
}

function history(value: unknown): boolean {
  return (
    record(value) &&
    value["status"] === "incomplete" &&
    member(value["reason"], [
      "event_history_only",
      "missing_current_event",
      "invalid_event",
    ])
  );
}

function observation(entry: Record<string, unknown>): boolean {
  const value = entry["observation"];
  if (
    !record(value) ||
    value["source"] !== "workspace" ||
    value["bindingSha256"] !==
      taskArtifactBinding(
        entry as unknown as NonNullable<
          TaskNarrativeProjection["deliverables"]
        >[number],
      ) ||
    !member(value["status"], [
      "observed",
      "matched",
      "mismatched",
      "missing",
      "unchecked",
    ])
  )
    return false;
  if (value["status"] === "unchecked")
    return member(value["reason"], [
      "workspace_unavailable",
      "unsupported_kind",
      "unsafe_path",
      "symlink",
      "not_regular_file",
      "budget_exceeded",
      "unstable",
      "unreadable",
    ]);
  if (value["status"] === "missing") return true;
  if (
    typeof value["sha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["sha256"]) ||
    !nonNegativeInteger(value["sizeBytes"])
  )
    return false;
  return (
    value["status"] !== "matched" ||
    (record(entry["artifact"]) &&
      entry["artifact"]["status"] === "verified" &&
      entry["artifact"]["sha256"] === value["sha256"] &&
      entry["artifact"]["sizeBytes"] === value["sizeBytes"])
  );
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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
