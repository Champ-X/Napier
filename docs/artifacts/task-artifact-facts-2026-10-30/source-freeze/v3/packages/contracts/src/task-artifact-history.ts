import type { RunEvent } from "./execution-core.js";
import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ArtifactManifestEntry } from "./execution-workflows.js";
import {
  hashed,
  exact,
  hex,
  integer,
  object,
  sha256,
} from "./skill-load-validation.js";
import type { TaskArtifactVersion } from "./task-artifact-facts.js";

export interface TaskArtifactHistoryEvent {
  planId: string;
  artifactId: string;
  threadId: string;
  eventId: string;
  eventSeq: number;
  createdAt: string;
  version?: TaskArtifactVersion;
  evidenceSha256?: string;
}

/** These events record caller metadata, not a native workspace observation. */
export function taskArtifactHistoryEvent(
  event: RunEvent,
): TaskArtifactHistoryEvent | undefined {
  if (!event.type.startsWith("plan.artifact.") || !object(event.payload))
    return;
  const p = event.payload;
  if (typeof p.planId !== "string" || typeof p.artifactId !== "string") return;
  const base = {
    planId: p.planId,
    artifactId: p.artifactId,
    threadId: event.threadId,
    eventId: event.id,
    eventSeq: event.seq,
    createdAt: event.createdAt,
  };
  const snapshot = p.runProgressSnapshot;
  if (
    !validMetadata(event, p) ||
    !validSnapshot(snapshot, p) ||
    !object(snapshot)
  )
    return base;
  return {
    ...base,
    evidenceSha256: p.evidenceSha256 as string,
    version: {
      planId: p.planId,
      artifactId: p.artifactId,
      planRevision: snapshot.revision as number,
      eventId: event.id,
      eventSeq: event.seq,
      path: p.path as string,
      status: p.status as ArtifactManifestEntry["status"],
      source: "recorded_assertion",
      ...(typeof p.sourceRunId === "string" ? { runId: p.sourceRunId } : {}),
      ...(hex(p.sha256) ? { sha256: p.sha256 } : {}),
      ...(typeof p.sizeBytes === "number" ? { sizeBytes: p.sizeBytes } : {}),
    },
  };
}

function validMetadata(event: RunEvent, p: Record<string, unknown>): boolean {
  return !(
    event.category !== "plan" ||
    event.visibility !== "user" ||
    !Number.isFinite(Date.parse(event.createdAt)) ||
    !integer(event.seq, 1, Number.MAX_SAFE_INTEGER) ||
    !["candidate", "produced", "verified", "missing", "superseded"].includes(
      String(p.status),
    ) ||
    event.type !== `plan.artifact.${String(p.status)}` ||
    typeof p.path !== "string" ||
    p.pathSha256 !== sha256(p.path) ||
    typeof p.evidence !== "string" ||
    p.evidenceSha256 !== sha256(p.evidence) ||
    (p.sha256 !== undefined && !hex(p.sha256)) ||
    (p.status === "verified" && !hex(p.sha256)) ||
    (p.sizeBytes !== undefined &&
      !integer(p.sizeBytes, 0, Number.MAX_SAFE_INTEGER)) ||
    (p.sourceRunId !== undefined && p.sourceRunId !== event.runId)
  );
}

function validSnapshot(snapshot: unknown, p: Record<string, unknown>): boolean {
  return !(
    !object(snapshot) ||
    !exact(snapshot, [
      "kind",
      "schemaVersion",
      "planIdSha256",
      "revision",
      "status",
      "steps",
      "artifacts",
      "contentSha256",
    ]) ||
    snapshot.kind !== "napier.run-plan-progress-snapshot" ||
    snapshot.schemaVersion !== 1 ||
    !hashed(snapshot, "contentSha256") ||
    snapshot.planIdSha256 !== sha256(p.planId as string) ||
    !integer(snapshot.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !["active", "blocked", "completed", "cancelled"].includes(
      String(snapshot.status),
    ) ||
    !snapshotEntries(snapshot.steps, [
      "pending",
      "ready",
      "running",
      "partial",
      "completed",
      "blocked",
      "skipped",
    ]) ||
    !snapshotEntries(snapshot.artifacts, [
      "expected",
      "candidate",
      "produced",
      "verified",
      "missing",
      "superseded",
    ]) ||
    !Array.isArray(snapshot.artifacts) ||
    snapshot.artifacts.filter(
      (a) =>
        object(a) &&
        a.idSha256 === sha256(p.artifactId as string) &&
        a.status === p.status,
    ).length !== 1
  );
}

function snapshotEntries(value: unknown, statuses: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry, index) =>
        object(entry) &&
        exact(entry, ["idSha256", "status"]) &&
        hex(entry.idSha256) &&
        statuses.includes(String(entry.status)) &&
        (index === 0 ||
          ((value[index - 1] as Record<string, unknown>).idSha256 as string) <
            entry.idSha256),
    )
  );
}

export function taskArtifactHistory(
  plan: ExecutionPlan,
  artifact: ArtifactManifestEntry,
  events: readonly TaskArtifactHistoryEvent[],
) {
  const related = events
    .filter(
      (entry) => entry.planId === plan.id && entry.artifactId === artifact.id,
    )
    .sort((a, b) => a.eventSeq - b.eventSeq);
  const valid: TaskArtifactHistoryEvent[] = [];
  for (const entry of related) {
    const prior = valid.at(-1);
    if (
      entry.version &&
      entry.threadId === plan.threadId &&
      entry.version.path === artifact.path &&
      entry.version.planRevision! <= plan.revision &&
      (!prior ||
        (entry.eventSeq > prior.eventSeq &&
          entry.version.planRevision! > prior.version!.planRevision!))
    )
      valid.push(entry);
  }
  const latest = related.at(-1);
  // Identical metadata can be reasserted in the same clock tick without its
  // event committing. Only the exact current plan revision binds this version.
  const current =
    latest &&
    valid.includes(latest) &&
    latest.version?.planRevision === plan.revision &&
    matches(latest, artifact)
      ? latest.version
      : undefined;
  return {
    ...(current
      ? { currentVersion: current, sourceEventId: current.eventId! }
      : {}),
    previousVersions: valid
      .filter((entry) => entry.version !== current)
      .map((entry) => entry.version!),
    history: {
      status: "incomplete" as const,
      reason:
        related.length !== valid.length
          ? ("invalid_event" as const)
          : !current
            ? ("missing_current_event" as const)
            : ("event_history_only" as const),
    },
  };
}

function matches(
  entry: TaskArtifactHistoryEvent,
  artifact: ArtifactManifestEntry,
): boolean {
  const v = entry.version!;
  return (
    v.status === artifact.status &&
    v.sha256 === artifact.sha256 &&
    v.sizeBytes === artifact.sizeBytes &&
    v.runId === artifact.sourceRunId &&
    Date.parse(entry.createdAt) >= Date.parse(artifact.updatedAt) &&
    entry.evidenceSha256 === sha256(artifact.evidence)
  );
}
