import type { ExecutionPlan } from "@napier/contracts";
import { canonicalJson } from "@napier/runtime";

import { sha256Json, sha256Text } from "./http-response-evidence.js";
import {
  isSha256String,
  nonNegativeSafeInteger,
  requestRecord,
} from "./http-request-validation.js";

type PlanArtifactDirectoryManifestEntryPayload =
  | {
      kind: "directory";
      path: string;
    }
  | {
      kind: "file";
      path: string;
      sha256: string;
      sizeBytes: number;
    };

export type PlanArtifactDirectoryManifestPayload = {
  kind: "napier.plan-artifact-directory-manifest";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  entries: PlanArtifactDirectoryManifestEntryPayload[];
};

export function parsePlanArtifactDirectoryManifestVerificationRequest(
  input: unknown,
): PlanArtifactDirectoryManifestPayload | undefined {
  const record = requestRecord(input, ["manifest"]);
  if (!record) return undefined;
  return planArtifactDirectoryManifestPayload(record["manifest"]);
}

export function verifyPlanArtifactDirectoryManifestProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  declared: PlanArtifactDirectoryManifestPayload,
  observed: {
    sha256: string;
    sizeBytes: number;
    entryCount: number;
    fileCount: number;
    directoryCount: number;
    entries: Array<{
      kind: "directory" | "file";
      path: string;
      sha256?: string;
      sizeBytes?: number;
    }>;
  },
) {
  const pathSha256 = sha256Text(artifact.path);
  const recomputedDeclaredSha256 = directoryManifestDigestSha256(
    declared.entries,
  );
  const declaredEntrySetSha256 = directoryManifestEntrySetSha256(
    declared.entries,
  );
  const observedEntrySetSha256 = directoryManifestEntrySetSha256(
    observed.entries,
  );
  const declaredFileCount = declared.entries.filter(
    (entry) => entry.kind === "file",
  ).length;
  const declaredDirectoryCount = declared.entries.filter(
    (entry) => entry.kind === "directory",
  ).length;
  const diagnostics = [
    ...(declared.planId === plan.id ? [] : ["plan_id_mismatch"]),
    ...(declared.artifactId === artifact.id ? [] : ["artifact_id_mismatch"]),
    ...(declared.planRevision === plan.revision
      ? []
      : ["plan_revision_mismatch"]),
    ...(declared.status === artifact.status ? [] : ["status_mismatch"]),
    ...(declared.artifactKind === artifact.kind ? [] : ["kind_mismatch"]),
    ...(declared.pathSha256 === pathSha256 ? [] : ["path_hash_mismatch"]),
    ...(declared.sha256 === observed.sha256 ? [] : ["artifact_hash_mismatch"]),
    ...(declared.sha256 === recomputedDeclaredSha256
      ? []
      : ["declared_manifest_hash_mismatch"]),
    ...(declared.sizeBytes === observed.sizeBytes ? [] : ["size_mismatch"]),
    ...(declared.entryCount === declared.entries.length
      ? []
      : ["declared_entry_count_mismatch"]),
    ...(declared.fileCount === declaredFileCount
      ? []
      : ["declared_file_count_mismatch"]),
    ...(declared.directoryCount === declaredDirectoryCount
      ? []
      : ["declared_directory_count_mismatch"]),
    ...(declared.entryCount === observed.entryCount
      ? []
      : ["entry_count_mismatch"]),
    ...(declared.fileCount === observed.fileCount
      ? []
      : ["file_count_mismatch"]),
    ...(declared.directoryCount === observed.directoryCount
      ? []
      : ["directory_count_mismatch"]),
    ...(declaredEntrySetSha256 === observedEntrySetSha256
      ? []
      : ["entry_set_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-directory-manifest-verification" as const,
    schemaVersion: 1 as const,
    threadId: plan.threadId,
    planId: plan.id,
    artifactId: artifact.id,
    planRevision: plan.revision,
    status: artifact.status,
    artifactKind: artifact.kind,
    verificationStatus:
      diagnostics.length === 0 ? ("valid" as const) : ("drifted" as const),
    diagnostics,
    pathSha256,
    declaredSha256: declared.sha256,
    recomputedDeclaredSha256,
    observedSha256: observed.sha256,
    declaredSizeBytes: declared.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
    declaredEntryCount: declared.entryCount,
    observedEntryCount: observed.entryCount,
    declaredFileCount: declared.fileCount,
    observedFileCount: observed.fileCount,
    declaredDirectoryCount: declared.directoryCount,
    observedDirectoryCount: observed.directoryCount,
    declaredEntrySetSha256,
    observedEntrySetSha256,
  };
}

export function createPlanArtifactDirectoryManifestVerificationEventPayload(
  verification: ReturnType<
    typeof verifyPlanArtifactDirectoryManifestProjection
  >,
) {
  return {
    planId: verification.planId,
    artifactId: verification.artifactId,
    planRevision: verification.planRevision,
    status: verification.status,
    kind: verification.artifactKind,
    pathSha256: verification.pathSha256,
    verificationStatus: verification.verificationStatus,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsSha256: sha256Json(verification.diagnostics),
    declaredSha256: verification.declaredSha256,
    recomputedDeclaredSha256: verification.recomputedDeclaredSha256,
    observedSha256: verification.observedSha256,
    declaredSizeBytes: verification.declaredSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
    declaredEntryCount: verification.declaredEntryCount,
    observedEntryCount: verification.observedEntryCount,
    declaredFileCount: verification.declaredFileCount,
    observedFileCount: verification.observedFileCount,
    declaredDirectoryCount: verification.declaredDirectoryCount,
    observedDirectoryCount: verification.observedDirectoryCount,
    declaredEntrySetSha256: verification.declaredEntrySetSha256,
    observedEntrySetSha256: verification.observedEntrySetSha256,
  };
}

function planArtifactDirectoryManifestPayload(
  input: unknown,
): PlanArtifactDirectoryManifestPayload | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const entries = directoryManifestEntries(record["entries"]);
  if (
    record["kind"] !== "napier.plan-artifact-directory-manifest" ||
    record["schemaVersion"] !== 1 ||
    typeof record["planId"] !== "string" ||
    typeof record["artifactId"] !== "string" ||
    !nonNegativeSafeInteger(record["planRevision"]) ||
    typeof record["status"] !== "string" ||
    typeof record["artifactKind"] !== "string" ||
    !isSha256String(record["pathSha256"]) ||
    !isSha256String(record["sha256"]) ||
    !nonNegativeSafeInteger(record["sizeBytes"]) ||
    !nonNegativeSafeInteger(record["entryCount"]) ||
    !nonNegativeSafeInteger(record["fileCount"]) ||
    !nonNegativeSafeInteger(record["directoryCount"]) ||
    !entries
  ) {
    return undefined;
  }
  return {
    kind: record["kind"],
    schemaVersion: 1,
    planId: record["planId"],
    artifactId: record["artifactId"],
    planRevision: record["planRevision"],
    status: record["status"],
    artifactKind: record["artifactKind"],
    pathSha256: record["pathSha256"],
    sha256: record["sha256"],
    sizeBytes: record["sizeBytes"],
    entryCount: record["entryCount"],
    fileCount: record["fileCount"],
    directoryCount: record["directoryCount"],
    entries,
  };
}

function directoryManifestEntries(
  input: unknown,
): PlanArtifactDirectoryManifestEntryPayload[] | undefined {
  if (!Array.isArray(input) || input.length > 5_000) return undefined;
  const entries: PlanArtifactDirectoryManifestEntryPayload[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (!validDirectoryManifestEntryPath(record["path"])) return undefined;
    if (record["kind"] === "directory") {
      if (
        Object.keys(record).length !== 2 ||
        !("kind" in record) ||
        !("path" in record)
      ) {
        return undefined;
      }
      entries.push({ kind: "directory", path: record["path"] });
      continue;
    }
    if (
      record["kind"] === "file" &&
      Object.keys(record).length === 4 &&
      "kind" in record &&
      "path" in record &&
      isSha256String(record["sha256"]) &&
      nonNegativeSafeInteger(record["sizeBytes"])
    ) {
      entries.push({
        kind: "file",
        path: record["path"],
        sha256: record["sha256"],
        sizeBytes: record["sizeBytes"],
      });
      continue;
    }
    return undefined;
  }
  return entries;
}

function validDirectoryManifestEntryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_000 &&
    !value.includes("\0")
  );
}

function directoryManifestDigestSha256(
  entries: Array<{
    kind: "directory" | "file";
    path: string;
    sha256?: string;
    sizeBytes?: number;
  }>,
): string {
  return sha256Text(
    canonicalJson({
      kind: "napier.plan-directory-digest",
      schemaVersion: 1,
      entries,
    }),
  );
}

function directoryManifestEntrySetSha256(
  entries: Array<{
    kind: "directory" | "file";
    path: string;
    sha256?: string;
    sizeBytes?: number;
  }>,
): string {
  return sha256Text(canonicalJson(entries));
}
