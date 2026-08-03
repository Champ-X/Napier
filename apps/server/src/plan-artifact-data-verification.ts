import type { ExecutionPlan } from "@napier/contracts";
import { canonicalJson } from "@napier/runtime";

import { sha256Json, sha256Text } from "./http-response-evidence.js";
import {
  isSha256String,
  isStringArray,
  nonNegativeSafeInteger,
  requestRecord,
} from "./http-request-validation.js";

export type PlanArtifactDataProfilePayload = {
  kind: "napier.plan-artifact-data-profile";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  format: string;
  rowCount: number;
  columnCount: number;
  truncated: boolean;
  columnSetSha256: string;
  sampleSha256: string;
  columns: string[];
  sampleRows: Array<Record<string, string | number | boolean | null>>;
};

export function parsePlanArtifactDataProfileVerificationRequest(
  input: unknown,
): PlanArtifactDataProfilePayload | undefined {
  const record = requestRecord(input, ["profile"]);
  if (!record) return undefined;
  return planArtifactDataProfilePayload(record["profile"]);
}

export function verifyPlanArtifactDataProfileProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  declared: PlanArtifactDataProfilePayload,
  observed: {
    sha256: string;
    sizeBytes: number;
    format: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    columnSetSha256: string;
    sampleSha256: string;
  },
) {
  const pathSha256 = sha256Text(artifact.path);
  const recomputedDeclaredColumnSetSha256 = sha256Text(
    canonicalJson(declared.columns),
  );
  const recomputedDeclaredSampleSha256 = sha256Text(
    canonicalJson(declared.sampleRows),
  );
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
    ...(declared.sizeBytes === observed.sizeBytes ? [] : ["size_mismatch"]),
    ...(declared.format === observed.format ? [] : ["format_mismatch"]),
    ...(declared.rowCount === observed.rowCount ? [] : ["row_count_mismatch"]),
    ...(declared.columnCount === observed.columnCount
      ? []
      : ["column_count_mismatch"]),
    ...(declared.truncated === observed.truncated
      ? []
      : ["truncated_mismatch"]),
    ...(declared.columnSetSha256 === observed.columnSetSha256
      ? []
      : ["column_set_mismatch"]),
    ...(declared.sampleSha256 === observed.sampleSha256
      ? []
      : ["sample_mismatch"]),
    ...(declared.columnSetSha256 === recomputedDeclaredColumnSetSha256
      ? []
      : ["declared_column_set_hash_mismatch"]),
    ...(declared.sampleSha256 === recomputedDeclaredSampleSha256
      ? []
      : ["declared_sample_hash_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-data-profile-verification" as const,
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
    observedSha256: observed.sha256,
    declaredSizeBytes: declared.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
    declaredFormat: declared.format,
    observedFormat: observed.format,
    declaredRowCount: declared.rowCount,
    observedRowCount: observed.rowCount,
    declaredColumnCount: declared.columnCount,
    observedColumnCount: observed.columnCount,
    declaredTruncated: declared.truncated,
    observedTruncated: observed.truncated,
    declaredColumnSetSha256: declared.columnSetSha256,
    recomputedDeclaredColumnSetSha256,
    observedColumnSetSha256: observed.columnSetSha256,
    declaredSampleSha256: declared.sampleSha256,
    recomputedDeclaredSampleSha256,
    observedSampleSha256: observed.sampleSha256,
  };
}

export function createPlanArtifactDataProfileVerificationEventPayload(
  verification: ReturnType<typeof verifyPlanArtifactDataProfileProjection>,
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
    observedSha256: verification.observedSha256,
    declaredSizeBytes: verification.declaredSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
    declaredFormat: verification.declaredFormat,
    observedFormat: verification.observedFormat,
    declaredRowCount: verification.declaredRowCount,
    observedRowCount: verification.observedRowCount,
    declaredColumnCount: verification.declaredColumnCount,
    observedColumnCount: verification.observedColumnCount,
    declaredTruncated: verification.declaredTruncated,
    observedTruncated: verification.observedTruncated,
    declaredColumnSetSha256: verification.declaredColumnSetSha256,
    recomputedDeclaredColumnSetSha256:
      verification.recomputedDeclaredColumnSetSha256,
    observedColumnSetSha256: verification.observedColumnSetSha256,
    declaredSampleSha256: verification.declaredSampleSha256,
    recomputedDeclaredSampleSha256: verification.recomputedDeclaredSampleSha256,
    observedSampleSha256: verification.observedSampleSha256,
  };
}

function planArtifactDataProfilePayload(
  input: unknown,
): PlanArtifactDataProfilePayload | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    record["kind"] !== "napier.plan-artifact-data-profile" ||
    record["schemaVersion"] !== 1 ||
    typeof record["planId"] !== "string" ||
    typeof record["artifactId"] !== "string" ||
    !nonNegativeSafeInteger(record["planRevision"]) ||
    typeof record["status"] !== "string" ||
    typeof record["artifactKind"] !== "string" ||
    !isSha256String(record["pathSha256"]) ||
    !isSha256String(record["sha256"]) ||
    !nonNegativeSafeInteger(record["sizeBytes"]) ||
    !validPlanArtifactDataFormat(record["format"]) ||
    !nonNegativeSafeInteger(record["rowCount"]) ||
    !nonNegativeSafeInteger(record["columnCount"]) ||
    typeof record["truncated"] !== "boolean" ||
    !isSha256String(record["columnSetSha256"]) ||
    !isSha256String(record["sampleSha256"]) ||
    !isStringArray(record["columns"]) ||
    !isDataProfileSampleRows(record["sampleRows"])
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
    format: record["format"],
    rowCount: record["rowCount"],
    columnCount: record["columnCount"],
    truncated: record["truncated"],
    columnSetSha256: record["columnSetSha256"],
    sampleSha256: record["sampleSha256"],
    columns: record["columns"],
    sampleRows: record["sampleRows"],
  };
}

function validPlanArtifactDataFormat(value: unknown): value is string {
  return (
    value === "json" ||
    value === "jsonl" ||
    value === "csv" ||
    value === "tsv" ||
    value === "markdown_table"
  );
}

function isDataProfileSampleRows(
  value: unknown,
): value is Array<Record<string, string | number | boolean | null>> {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.values(row).every(
          (cell) =>
            cell === null ||
            typeof cell === "string" ||
            (typeof cell === "number" && Number.isFinite(cell)) ||
            typeof cell === "boolean",
        ),
    )
  );
}
