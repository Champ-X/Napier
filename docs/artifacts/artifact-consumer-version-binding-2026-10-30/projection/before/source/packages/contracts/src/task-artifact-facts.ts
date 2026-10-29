import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ArtifactManifestEntry } from "./execution-workflows.js";
import { canonical, sha256 } from "./skill-load-validation.js";

export interface TaskArtifactVersion {
  planId: string;
  artifactId: string;
  runId?: string;
  sha256?: string;
  planRevision?: number;
  eventId?: string;
  eventSeq?: number;
  path?: string;
  sizeBytes?: number;
  status?: ArtifactManifestEntry["status"];
  source?: "manifest" | "recorded_assertion";
}

/** Observed only while producing this response, never proof of who created bytes. */
export interface TaskArtifactObservation {
  source: "workspace";
  bindingSha256: string;
  status: "observed" | "matched" | "mismatched" | "missing" | "unchecked";
  sha256?: string;
  sizeBytes?: number;
  reason?:
    | "workspace_unavailable"
    | "unsupported_kind"
    | "unsafe_path"
    | "symlink"
    | "not_regular_file"
    | "budget_exceeded"
    | "unstable"
    | "unreadable";
}

export interface TaskDeliverable {
  path: string;
  planId?: string;
  planRevision?: number;
  artifact: ArtifactManifestEntry;
  source: "plan" | "final_reference";
  sourceEventId?: string;
  accessibility: "unchecked" | "available" | "missing" | "drifted";
  verification: "unverified" | "integrity_recorded" | "integrity_observed";
  observation?: TaskArtifactObservation;
  currentVersion?: TaskArtifactVersion;
  previousVersions: TaskArtifactVersion[];
  /** Legacy state writes and event appends are not atomic. No full history claim. */
  history?: {
    status: "incomplete";
    reason: "event_history_only" | "missing_current_event" | "invalid_event";
  };
}

export function taskArtifactBinding(entry: TaskDeliverable): string {
  return sha256(
    canonical({
      planId: entry.planId,
      planRevision: entry.planRevision,
      path: entry.path,
      artifact: entry.artifact,
    }),
  );
}

/** Shared interpretation: manifest assertions alone never pass current integrity. */
export function taskArtifactFacts(
  plans: readonly ExecutionPlan[],
  deliverables: readonly TaskDeliverable[] = [],
) {
  const plan =
    plans.findLast(
      (candidate) =>
        candidate.status === "active" || candidate.status === "blocked",
    ) ?? plans.at(-1);
  const artifacts = plan?.artifacts ?? [];
  let verifiedArtifactCount = 0,
    producedArtifactCount = 0,
    missingArtifactCount = 0,
    driftedArtifactCount = 0;
  for (const artifact of artifacts) {
    const entry = deliverables.find(
      (candidate) =>
        candidate.source === "plan" &&
        candidate.planId === plan?.id &&
        candidate.planRevision === plan?.revision &&
        candidate.artifact.id === artifact.id &&
        candidate.path === artifact.path &&
        canonical(candidate.artifact) === canonical(artifact),
    );
    const observed = entry?.observation;
    const bound =
      entry &&
      observed?.source === "workspace" &&
      observed.bindingSha256 === taskArtifactBinding(entry);
    if (bound && observed.status === "mismatched") {
      driftedArtifactCount += 1;
    } else if (bound && observed.status === "missing") {
      missingArtifactCount += 1;
    } else if (
      bound &&
      observed.status === "matched" &&
      artifact.status === "verified" &&
      observed.sha256 === artifact.sha256 &&
      observed.sizeBytes === artifact.sizeBytes
    ) {
      verifiedArtifactCount += 1;
    } else if (artifact.status === "produced") {
      producedArtifactCount += 1;
    }
  }
  const artifactCount = artifacts.length;
  const status =
    missingArtifactCount + driftedArtifactCount > 0
      ? "failed"
      : artifactCount > 0 && verifiedArtifactCount === artifactCount
        ? "passed"
        : verifiedArtifactCount + producedArtifactCount > 0
          ? "warning"
          : "unknown";
  return {
    status,
    artifactCount,
    verifiedArtifactCount,
    producedArtifactCount,
    missingArtifactCount,
    driftedArtifactCount,
  } as const;
}
