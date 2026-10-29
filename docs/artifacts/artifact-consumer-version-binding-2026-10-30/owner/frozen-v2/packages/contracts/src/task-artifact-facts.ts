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
  eventRunId?: string;
  eventCreatedAt?: string;
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

/** Interpret only the observation bound to this exact manifest snapshot. */
export function taskArtifactCurrentFact(entry: TaskDeliverable) {
  const observed = entry.observation;
  if (
    observed?.source !== "workspace" ||
    observed.bindingSha256 !== taskArtifactBinding(entry)
  )
    return "unchecked" as const;
  if (observed.status === "missing") return "missing" as const;
  if (observed.status === "mismatched") return "drifted" as const;
  if (
    observed.status === "matched" &&
    entry.artifact.status === "verified" &&
    /^[a-f0-9]{64}$/u.test(observed.sha256 ?? "") &&
    Number.isSafeInteger(observed.sizeBytes) &&
    (observed.sizeBytes ?? -1) >= 0 &&
    observed.sha256 === entry.artifact.sha256 &&
    observed.sizeBytes === entry.artifact.sizeBytes
  )
    return "integrity_observed" as const;
  if (observed.status === "observed") return "available" as const;
  return "unchecked" as const;
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
    const currentFact = entry ? taskArtifactCurrentFact(entry) : "unchecked";
    if (currentFact === "drifted") {
      driftedArtifactCount += 1;
    } else if (currentFact === "missing") {
      missingArtifactCount += 1;
    } else if (currentFact === "integrity_observed") {
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

export interface TaskArtifactSelection {
  artifact: ArtifactManifestEntry;
  planId: string;
  planRevision?: number;
  threadId?: string;
}

export interface TaskArtifactReceipt {
  kind?: string;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind?: string;
  pathSha256: string;
  threadId?: string;
  sha256?: string;
  sizeBytes?: number;
  expectedSha256?: string;
  expectedSizeBytes?: number;
}

export type TaskArtifactReceiptMode = "content" | "expected" | "identity";

function receiptMode(receipt: TaskArtifactReceipt): TaskArtifactReceiptMode {
  if (
    [
      "napier.plan-artifact-text-preview",
      "napier.plan-artifact-text-peek",
      "napier.plan-artifact-file-preview",
      "napier.plan-artifact-data-profile",
      "napier.plan-artifact-directory-manifest",
    ].includes(receipt.kind ?? "")
  )
    return "content";
  if (
    [
      "napier.plan-artifact-file-verification",
      "napier.plan-artifact-drift-check",
    ].includes(receipt.kind ?? "")
  )
    return "expected";
  return "identity";
}

export function taskArtifactReceiptMatches(
  selection: TaskArtifactSelection,
  receipt: TaskArtifactReceipt,
  mode?: TaskArtifactReceiptMode,
): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  const { artifact } = selection;
  const required = mode ?? receiptMode(receipt);
  return !(
    (required === "content" &&
      (!/^[a-f0-9]{64}$/u.test(receipt.sha256 ?? "") ||
        !Number.isSafeInteger(receipt.sizeBytes) ||
        (receipt.sizeBytes ?? -1) < 0)) ||
    (required === "expected" &&
      !/^[a-f0-9]{64}$/u.test(receipt.expectedSha256 ?? "")) ||
    receipt.planId !== selection.planId ||
    receipt.artifactId !== artifact.id ||
    (selection.planRevision !== undefined &&
      receipt.planRevision !== selection.planRevision) ||
    !Number.isSafeInteger(receipt.planRevision) ||
    receipt.planRevision < 1 ||
    receipt.status !== artifact.status ||
    (receipt.artifactKind !== undefined &&
      receipt.artifactKind !== artifact.kind) ||
    (receipt.threadId !== undefined &&
      selection.threadId !== undefined &&
      receipt.threadId !== selection.threadId) ||
    receipt.pathSha256 !== sha256(artifact.path) ||
    (artifact.sha256 !== undefined &&
      ((receipt.sha256 !== undefined && receipt.sha256 !== artifact.sha256) ||
        (receipt.expectedSha256 !== undefined &&
          receipt.expectedSha256 !== artifact.sha256))) ||
    (artifact.sizeBytes !== undefined &&
      ((receipt.sha256 !== undefined &&
        receipt.sizeBytes !== artifact.sizeBytes) ||
        (receipt.expectedSizeBytes !== undefined &&
          receipt.expectedSizeBytes !== artifact.sizeBytes)))
  );
}
